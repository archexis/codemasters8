"""Durable, owner-scoped discovery. Never writes workspace decisions or stores JWTs."""
import asyncio
import logging
from contextlib import closing
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
from hashlib import sha256
import ipaddress
import json
from pathlib import Path
import re
import sqlite3
import time
from urllib.parse import urlparse, urlunparse
from uuid import uuid4

import httpx

LEASE_SECONDS = 600
MAX_HISTORY = 20

logger = logging.getLogger(__name__)


def normalize(value):
    return ' '.join(re.findall(r'[\w]+', str(value or '').casefold().replace('ё', 'е')))


def obvious_match(target, text, phase=None):
    """Conservative record-shaped identity, never a whole-page substring match.

    Multiple property headings, negation, multiple phases and unstructured prose
    all require a person. This deliberately prefers false negatives.
    """
    if not isinstance(text, str) or len(text) > 30_000:
        return False
    values = [normalize(target.get(k)) for k in ('name', 'address', 'developer')]
    if any(len(v) < 5 for v in values):
        return False
    fields = {}
    for line in text.splitlines():
        match = re.fullmatch(r'\s*(?:[-*]\s*)?(ЖК|Объект|Адрес|Застройщик|Очередь)\s*:\s*(.{1,250})\s*', line, re.I)
        if match:
            key = normalize(match[1])
            if key in fields:
                return False
            fields[key] = normalize(match[2])
    if 'жк' in fields and 'объект' in fields:
        return False
    if [fields.get('жк', fields.get('объект')), fields.get('адрес'), fields.get('застройщик')] != values:
        return False
    # Any other property/phase mention or contradiction defeats automatic binding.
    remainder = '\n'.join(line for line in text.splitlines() if not re.match(r'^\s*(?:[-*]\s*)?(ЖК|Объект|Адрес|Застройщик|Очередь)\s*:', line, re.I))
    if re.search(r'\b(?:ЖК|очеред[ьи]|корпус|другой объект|не относится|не принадлежит|не является|каталог|сравнение)\b', remainder, re.I):
        return False
    if phase:
        return fields.get('очередь') == normalize(phase.get('name'))
    return 'очередь' not in fields


def canonical_url(value):
    if not isinstance(value, str) or len(value) > 2000:
        return None
    try:
        parts = urlparse(value)
        host = parts.hostname
        if parts.scheme != 'https' or not host or parts.username or parts.password or parts.port not in (None, 443):
            return None
        if host.lower() == 'localhost' or host.lower().endswith(('.local', '.localhost')):
            return None
        try:
            if not ipaddress.ip_address(host).is_global:
                return None
        except ValueError:
            if '.' not in host:
                return None
        return urlunparse((parts.scheme, parts.netloc.lower(), parts.path, '', parts.query, ''))
    except ValueError:
        return None


def publication_date(value):
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10]).isoformat()
    except ValueError:
        try:
            return parsedate_to_datetime(value).date().isoformat()
        except (ValueError, TypeError, OverflowError):
            return None


def within_period(value, period):
    return not period or bool(value and value >= period['from'] and (not period.get('to') or value <= period['to']))


def preliminary_claims(text):
    """Real deterministic extraction; explicitly not an LLM or a legal conclusion."""
    claims = []
    for sentence in re.split(r'[.!?\n]', text):
        quote = sentence.strip()
        if not quote or len(quote) > 2000:
            continue
        if re.search(r'\b(?:не|нет|без|никак)|отсутств|бесплат|тегін|жоқ|емес', quote, re.I):
            continue
        if re.search(r'платн\w*\s+брон|депозит|предоплат|первоначальн\w*\s+взнос|задаток|алғашқы\s+жарна', quote, re.I):
            claims.append({'code': 'R2', 'quote': quote, 'reason': 'Локальные правила: платёжный маркер; требуется проверка контекста человеком.'})
        if len(claims) == 3:
            break
    return claims


class ResearchStore:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS research_jobs (
                  id TEXT PRIMARY KEY, owner TEXT NOT NULL, case_id TEXT NOT NULL,
                  target TEXT NOT NULL, status TEXT NOT NULL, result TEXT, error TEXT,
                  created REAL NOT NULL, touched REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS research_owner ON research_jobs(owner, case_id, created);
                CREATE TABLE IF NOT EXISTS research_monitors (
                  owner TEXT NOT NULL, case_id TEXT NOT NULL, target TEXT NOT NULL,
                  hours INTEGER NOT NULL, due REAL NOT NULL, PRIMARY KEY(owner, case_id));
            ''')
            # Lease token prevents a worker that lost its lease overwriting a newer result.
            if 'lease' not in {row[1] for row in db.execute('PRAGMA table_info(research_jobs)')}:
                db.execute('ALTER TABLE research_jobs ADD COLUMN lease TEXT')
            db.commit()

    def connect(self):
        return closing(sqlite3.connect(self.path, timeout=10))

    def enqueue(self, owner, case_id, target, now=None):
        now = time.time() if now is None else now
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            active = db.execute("SELECT id FROM research_jobs WHERE owner=? AND case_id=? AND status IN ('queued','running')", (owner, case_id)).fetchone()
            if active:
                return active[0]
            latest = db.execute('SELECT id,created FROM research_jobs WHERE owner=? AND case_id=? ORDER BY created DESC LIMIT 1', (owner, case_id)).fetchone()
            if latest and now - latest[1] < 60:
                return latest[0]
            if db.execute("SELECT count(*) FROM research_jobs WHERE status IN ('queued','running')").fetchone()[0] >= 32:
                raise ValueError('Очередь поиска заполнена. Повторите позже.')
            job_id = str(uuid4())
            db.execute('INSERT INTO research_jobs(id,owner,case_id,target,status,created,touched) VALUES(?,?,?,?,?,?,?)', (job_id, owner, case_id, json.dumps(target, ensure_ascii=False), 'queued', now, now))
            db.execute("DELETE FROM research_jobs WHERE owner=? AND case_id=? AND status NOT IN ('queued','running') AND id NOT IN (SELECT id FROM research_jobs WHERE owner=? AND case_id=? ORDER BY created DESC LIMIT ?)", (owner, case_id, owner, case_id, MAX_HISTORY))
            db.commit()
            return job_id

    def latest(self, owner, case_id):
        with self.connect() as db:
            rows = db.execute('SELECT id,status,result,error,created FROM research_jobs WHERE owner=? AND case_id=? ORDER BY created DESC LIMIT ?', (owner, case_id, MAX_HISTORY)).fetchall()
            monitor = db.execute('SELECT hours,due,target FROM research_monitors WHERE owner=? AND case_id=?', (owner, case_id)).fetchone()
        jobs = [{'id': row[0], 'status': row[1], 'result': json.loads(row[2]) if row[2] else None, 'error': row[3], 'createdAt': row[4]} for row in rows]
        return {'job': jobs[0] if jobs else None, 'history': jobs[1:], 'monitor': None if not monitor else {'hours': monitor[0], 'nextRunAt': monitor[1], 'domains': json.loads(monitor[2]).get('domains')}}

    def monitor(self, owner, case_id, target, hours):
        if hours not in (0, 6, 24, 168):
            raise ValueError('Недопустимый интервал')
        with self.connect() as db:
            if hours:
                db.execute('INSERT INTO research_monitors VALUES(?,?,?,?,?) ON CONFLICT(owner,case_id) DO UPDATE SET target=excluded.target,hours=excluded.hours,due=excluded.due', (owner, case_id, json.dumps(target, ensure_ascii=False), hours, time.time() + hours * 3600))
            else:
                db.execute('DELETE FROM research_monitors WHERE owner=? AND case_id=?', (owner, case_id))
            db.commit()

    async def schedule(self, resolve, now=None):
        now = time.time() if now is None else now
        with self.connect() as db:
            due = db.execute('SELECT owner,case_id,hours,target FROM research_monitors WHERE due<=? LIMIT 32', (now,)).fetchall()
        for owner, case_id, hours, previous in due:
            # Always refresh ownership, identity and period. Never search deleted/stale targets.
            target = await resolve(owner, case_id)
            if target is None:
                self.monitor(owner, case_id, {}, 0)
                continue
            try:
                saved = json.loads(previous)
            except (ValueError, TypeError):
                saved = {}
            if isinstance(saved.get('domains'), list):
                target['domains'] = saved['domains']
            try:
                self.enqueue(owner, case_id, target, now)
            except ValueError:
                continue
            with self.connect() as db:
                db.execute('UPDATE research_monitors SET due=?,target=? WHERE owner=? AND case_id=? AND due<=?', (now + hours * 3600, json.dumps(target, ensure_ascii=False), owner, case_id, now))
                db.commit()

    def claim(self, now=None):
        now = time.time() if now is None else now
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute("UPDATE research_jobs SET status='queued' WHERE status='running' AND touched<?", (now - LEASE_SECONDS,))
            row = db.execute("SELECT id,owner,case_id,target FROM research_jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
            lease = str(uuid4())
            if row:
                db.execute("UPDATE research_jobs SET status='running',touched=?,lease=? WHERE id=?", (now, lease, row[0]))
            db.commit()
        return None if not row else (row[0], row[1], row[2], json.loads(row[3]), lease)

    def finish(self, job_id, lease, result=None, error=None):
        with self.connect() as db:
            db.execute("UPDATE research_jobs SET status=?,result=?,error=?,touched=? WHERE id=? AND lease=? AND status='running'", ('failed' if error else 'succeeded', json.dumps(result, ensure_ascii=False) if result is not None else None, error, time.time(), job_id, lease))
            db.commit()


async def provider_search(client, api_key, payload):
    # Stream into a bounded buffer before JSON parsing (provider data is untrusted).
    async with client.stream('POST', 'https://api.tavily.com/search', headers={'Authorization': f'Bearer {api_key}'}, json=payload) as response:
        response.raise_for_status()
        chunks, size = [], 0
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > 2_000_000:
                raise ValueError('Search response too large')
            chunks.append(chunk)
    data = json.loads(b''.join(chunks))
    if not isinstance(data, dict) or not isinstance(data.get('results'), list):
        raise ValueError('Invalid search response')
    return data['results'][:6]


async def collect_sources(target, api_key, domains, client):
    building, phase, period = target['complex'], target.get('phase'), target.get('period')
    query = f'"{building["name"]}" "{building.get("address", "")}" {building.get("developer", "")} строительство квартиры документы'
    if phase:
        query += f' "{phase["name"]}"'
    if period:
        query += f' период {period["from"]} {period.get("to", "")}'
    sources, seen, searches, limitations = [], set(), [], []
    for stage, allowed in [('priority', domains), ('web', [])]:
        if stage == 'priority' and not allowed:
            continue
        payload = {'query': query[:600], 'search_depth': 'basic', 'max_results': 6, 'include_raw_content': 'text', 'include_answer': False, 'include_published_date': True,
                   **({'include_domains': allowed} if allowed else {}),
                   **({'start_date': period['from'], **({'end_date': period['to']} if period.get('to') else {})} if period else {})}
        try:
            items = await provider_search(client, api_key, payload)
            searches.append({'stage': stage, 'domains': allowed, 'status': 'succeeded'})
        except (httpx.HTTPError, ValueError, TimeoutError):
            searches.append({'stage': stage, 'domains': allowed, 'status': 'failed'})
            limitations.append(f'{"Приоритетный" if stage == "priority" else "Общий"} поиск недоступен. Частичные результаты сохранены.')
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            url = canonical_url(item.get('url'))
            if not url or url in seen:
                continue
            seen.add(url)
            raw = item.get('raw_content') if isinstance(item.get('raw_content'), str) else ''
            snippet = item.get('content') if isinstance(item.get('content'), str) else ''
            original = bool(raw.strip()) and len(raw) <= 30_000
            text = raw[:30_000] if raw.strip() else snippet[:4000]
            published = publication_date(item.get('published_date'))
            in_period = within_period(published, period)
            matched = original and bool(published) and obvious_match(building, text, phase) and in_period
            reason = 'Точно совпали отдельные поля объекта, адреса, застройщика и области проверки' if matched else 'Требуется сверка объекта, очереди, даты и оригинала'
            sources.append({'id': sha256((url + '\n' + text).encode()).hexdigest(), 'url': url,
                            'title': item.get('title', url)[:500] if isinstance(item.get('title', url), str) else url,
                            'text': text, 'date': published, 'capturedAt': time.time(), 'stage': stage,
                            'originalCaptured': original, 'inPeriod': in_period,
                            'match': 'obvious' if matched else 'uncertain', 'matchReason': reason,
                            'engine': 'local-rules-v1', 'candidates': preliminary_claims(text) if original and in_period else []})
    if not sources:
        limitations.append('Материалы не найдены. Это не подтверждает отсутствие разрешений или нарушения.')
    limitations.append('Серверный первичный разбор: локальные правила, без LLM. Подтверждение фактов выполняет человек.')
    return {'sources': sources, 'searches': searches, 'limitations': limitations, 'target': target}


async def resolve_monitor_target(settings, owner, case_id, client):
    # Optional server-only credential, strictly scoped read, no workspace writes.
    response = await client.get(f'{settings.supabase_url.rstrip("/")}/rest/v1/workspaces',
        params={'owner_id': f'eq.{owner}', 'select': 'data,version'},
        headers={'apikey': settings.supabase_service_role_key, 'Authorization': f'Bearer {settings.supabase_service_role_key}'})
    response.raise_for_status()
    rows = response.json()
    if not rows:
        return None
    from backend.app.main import research_target
    from fastapi import HTTPException
    try:
        target = research_target(rows[0], case_id)
        if target['complex'].get('demo') or target['complex'].get('origin') == 'demo':
            return None
        return target
    except HTTPException as exc:
        if exc.status_code == 404:
            return None
        raise


async def research_worker(settings):
    while True:
        try:
            store = ResearchStore(settings.research_db_path)
            if settings.tavily_api_key:
                async with httpx.AsyncClient(timeout=35, follow_redirects=False) as client:
                    async def resolve(owner, case_id):
                        return await resolve_monitor_target(settings, owner, case_id, client)
                    if settings.supabase_service_role_key and settings.supabase_url:
                        await store.schedule(resolve)
                    job = store.claim()
                    if job:
                        job_id, owner, case_id, target, lease = job
                        try:
                            selected = target.get('domains')
                            if settings.supabase_service_role_key and settings.supabase_url:
                                target = await resolve(owner, case_id)
                            if target is None:
                                store.finish(job_id, lease, error='Дело удалено или объект недоступен.')
                            else:
                                configured = [d.strip() for d in settings.research_domains.split(',') if d.strip()]
                                target['domains'] = configured if selected is None else [d for d in selected if d in configured]
                                async with asyncio.timeout(100):
                                    result = await collect_sources(target, settings.tavily_api_key, target['domains'], client)
                                failed = all(s['status'] == 'failed' for s in result['searches'])
                                store.finish(job_id, lease, result, 'Внешний поиск недоступен; повторите позже.' if failed else None)
                        except Exception as exc:
                            # Generic user-facing error only; log the failure type
                            # without payloads, keys, targets or content.
                            logger.warning("research job %s failed: %s", job_id, type(exc).__name__)
                            store.finish(job_id, lease, error='Не удалось обработать поиск. Повторите позже.')
        except Exception as exc:
            # Initialization/network/provider failures do not kill the worker.
            # Log only the exception type: messages may echo URLs, credentials
            # or provider content, which must never reach the logs.
            logger.warning("research worker iteration failed: %s", type(exc).__name__)
        await asyncio.sleep(3)
