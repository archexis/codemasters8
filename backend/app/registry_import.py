"""Owner-scoped registry previews. Remote discovery never establishes legal facts."""
import asyncio
import json
import re
import sqlite3
import unicodedata
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
from typing import Literal
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, Field

SOURCES = {
    'egov': ('data.egov.kz', 'official_open_data'),
    'equrylys': ('reestr.equrylys.kz', 'official_registry'),
    'homeportal': ('homeportal.kz', 'official_registry'),
    'krisha': ('krisha.kz', 'commercial_catalog'),
    'developers': ('developers.kz', 'commercial_catalog'),
}
STAGES = {'unknown': 'Стадия неизвестна', 'planned': 'Планируется', 'under_construction': 'Строится', 'commissioned': 'Введён в эксплуатацию', 'on_hold': 'Приостановлен'}
SourceId = Literal['egov', 'equrylys', 'homeportal', 'krisha', 'developers']


class PreviewOptions(BaseModel):
    sources: list[SourceId] = Field(default_factory=lambda: list(SOURCES), min_length=1, max_length=5)
    records: list[dict] = Field(default_factory=list, max_length=100)


class CommitOptions(BaseModel):
    job_id: str = Field(pattern=r'^[a-f0-9-]{36}$')
    selected_ids: list[str] = Field(min_length=1, max_length=100)


def encoded(value):
    def integers(v):
        if isinstance(v, float) and v.is_integer():
            return int(v)
        if isinstance(v, list):
            return [integers(x) for x in v]
        if isinstance(v, dict):
            return {k: integers(x) for k, x in v.items()}
        return v
    return json.dumps(integers(value), ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def digest(value):
    return sha256(value.encode()).hexdigest()


def normalized(value):
    value = unicodedata.normalize('NFKC', value).lower().replace('ё', 'е')
    return ' '.join(re.sub(r'[^\w]+', ' ', value, flags=re.UNICODE).replace('_', ' ').split())


def city_name(value):
    return 'Өскемен' if normalized(value) in ('өскемен', 'оскемен', 'усть каменогорск', 'ust kamenogorsk', 'oskemen') else value.strip()


def name_key(value):
    return re.sub(r'^жк\s+', '', normalized(value))


def identity(r):
    return encoded([city_name(r['city']), name_key(r['name']), normalized(r['address'])])


def fingerprint(r):
    return encoded([r.get(k) for k in ('name', 'city', 'address', 'developer', 'developer_bin', 'construction_status', 'source_url', 'observed_at', 'lat', 'lng')])


def artifact_id(r):
    return 'IMP-' + digest(fingerprint(r))[:48]


def clean_record(raw):
    def text(key, limit, required=False):
        v = raw.get(key)
        if v is None or v == '':
            if required:
                raise ValueError(f'Не заполнено поле {key}')
            return None
        if not isinstance(v, str) or not v.strip() or len(v) > limit:
            raise ValueError(f'Некорректное поле {key}')
        return v.strip()
    r = {k: text(k, limit, True) for k, limit in [('name', 300), ('city', 100), ('address', 500), ('source_url', 2000)]}
    r['city'] = city_name(r['city'])
    if r['city'] != 'Өскемен':
        raise ValueError('Город вне выбранного региона')
    r.update({k: text(k, 500) for k in ('developer', 'developer_bin', 'observed_at')})
    if r['developer_bin'] and not re.fullmatch(r'[0-9]{12}', r['developer_bin']):
        raise ValueError('БИН должен содержать 12 цифр')
    if r['observed_at'] and (not re.fullmatch(r'\d{4}-\d{2}-\d{2}', r['observed_at']) or date.fromisoformat(r['observed_at']).isoformat() != r['observed_at']):
        raise ValueError('Дата источника: YYYY-MM-DD или пустое значение')
    u = urlparse(r['source_url'])
    source_id = next((k for k, (host, _) in SOURCES.items() if u.hostname == host or (u.hostname or '').endswith('.' + host)), None)
    if u.scheme != 'https' or u.username or u.password or u.port not in (None, 443) or 'apiKey' in parse_qs(u.query) or not source_id:
        raise ValueError('Нужна HTTPS-ссылка на один из пяти источников без ключа API')
    r['source_id'] = source_id
    r['source_type'] = SOURCES[source_id][1]
    r['verification_status'] = 'unverified'
    r['construction_status'] = raw.get('construction_status') or 'unknown'
    if r['construction_status'] not in STAGES:
        raise ValueError('Неизвестная стадия строительства')
    for k, limit in [('lat', 85.051129), ('lng', 180)]:
        v = raw.get(k)
        r[k] = None if v in ('', None) else float(v)
        if isinstance(v, bool) or (r[k] is not None and not -limit <= r[k] <= limit):
            raise ValueError('Некорректные координаты')
    if (r['lat'] is None) != (r['lng'] is None):
        raise ValueError('Укажите обе координаты или оставьте обе пустыми')
    return r


def make_candidates(records, workspace):
    groups = {}
    for r in records:
        group = groups.setdefault(identity(r), [])
        if not any(fingerprint(s) == fingerprint(r) for s in group):
            group.append(r)
    candidates = []
    buildings = [z for z in workspace.get('complexes', []) if not z.get('demo') and z.get('origin') != 'demo']
    for key, sources in groups.items():
        r = sources[0].copy()
        matches = [z for z in buildings if identity(z) == key]
        existing = matches[0] if len(matches) == 1 else None
        warnings = []
        for field in ('developer_bin', 'developer', 'construction_status'):
            if len({normalized(s[field]) for s in sources if s.get(field) and s[field] != 'unknown'}) > 1:
                warnings.append(f'Источники расходятся: {field}')
        if len({(s['lat'], s['lng']) for s in sources if s['lat'] is not None}) > 1:
            warnings.append('Источники расходятся: координаты')
        if len(matches) > 1:
            warnings.append('Несколько совпадений в рабочем пространстве')
        if existing and existing.get('bin') and any(s['developer_bin'] and s['developer_bin'] != existing['bin'] for s in sources):
            warnings.append('БИН отличается от сохранённого')
        if any(city_name(z['city']) == r['city'] and (name_key(z['name']) == name_key(r['name']) or normalized(z['address']) == normalized(r['address'])) and identity(z) != key for z in buildings):
            warnings.append('Частичное совпадение названия или адреса: требуется ручное сопоставление')
        if any(other != key and (name_key(items[0]['name']) == name_key(r['name']) or normalized(items[0]['address']) == normalized(r['address'])) for other, items in groups.items()):
            warnings.append('Частичное совпадение внутри выгрузки: требуется ручное сопоставление')
        for field in ('developer', 'developer_bin', 'lat', 'lng'):
            r[field] = next((s[field] for s in sources if s[field] is not None), None)
        r['construction_status'] = next((s['construction_status'] for s in sources if s['construction_status'] != 'unknown'), 'unknown')
        action = 'review' if warnings else 'enrich' if existing else 'create'
        if existing and action != 'review' and all(any(a['id'] == artifact_id(s) and a['complexId'] == existing['id'] for a in workspace.get('artifacts', [])) for s in sources):
            action = 'duplicate'
        if r['lat'] is None:
            warnings.append('Без координат: адрес ожидает ручной проверки; точка на карте не создаётся')
        candidates.append({'id': 'IMP-' + digest(key)[:32], 'record': r, 'sources': sources, 'existing_id': existing['id'] if existing else None, 'action': action, 'warnings': warnings})
    return candidates


async def egov_records(settings):
    """Only the operator-configured dataset; no arbitrary URLs, redirects or keys in lineage."""
    if not settings.egov_api_key or not settings.egov_dataset or not settings.egov_field_map:
        return [], 'not_configured', 'Нужны ключ API, набор ВКО и соответствие полей на сервере.'
    if not re.fullmatch(r'[A-Za-z0-9_-]+/[A-Za-z0-9_-]+', settings.egov_dataset):
        return [], 'error', 'Некорректная настройка набора data.egov.kz.'
    try:
        mapping = json.loads(settings.egov_field_map)
        if not isinstance(mapping, dict) or not all(mapping.get(k) for k in ('name', 'address', 'city')):
            raise ValueError()
        query = {'size': 101, 'query': {'match': {mapping['city']: settings.egov_city_query}}}
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            async with client.stream('GET', f'https://data.egov.kz/api/v4/{settings.egov_dataset}', params={'apiKey': settings.egov_api_key, 'source': encoded(query)}) as response:
                response.raise_for_status()
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > 2 * 1024 * 1024:
                        raise ValueError()
                rows = json.loads(data)
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise ValueError()
        # Fail explicitly rather than presenting an unlabelled partial catalog.
        if len(rows) > 100:
            return [], 'error', 'Более 100 результатов. Уточните выборку или импортируйте выгрузку частями.'
        records = [{k: row.get(v) for k, v in mapping.items()} for row in rows]
        url = f'https://data.egov.kz/datasets/view?index={settings.egov_dataset.split("/")[0]}'
        for r in records:
            r['source_url'] = url
        return records, 'available', 'Ответ API получен; сведения требуют проверки.'
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        return [], 'error', 'Источник недоступен или ответ не соответствует настройке. Это не нарушение.'


async def geocode_candidates(candidates, settings):
    """Geocoding enriches the candidate, never rewrites the source's coordinates."""
    summary = {'configured': bool(settings.geoapify_api_key), 'attempted': 0, 'matched': 0, 'limit': 20}
    if not settings.geoapify_api_key:
        return summary
    pending = [c for c in candidates if c['action'] == 'create' and c['record']['lat'] is None][:20]
    semaphore = asyncio.Semaphore(4)
    async with httpx.AsyncClient(timeout=4, follow_redirects=False) as client:
        async def locate(c):
            r = c['record']
            query = f"{r['address']}, {r['city']}, Казахстан"
            info = {'status': 'manual_review', 'provider': 'Geoapify', 'query': query, 'retrieved_at': datetime.now(timezone.utc).isoformat()}
            c['geocoding'] = info
            async with semaphore:
                summary['attempted'] += 1
                try:
                    async with client.stream('GET', 'https://api.geoapify.com/v1/geocode/search', params={'text': query, 'filter': 'countrycode:kz', 'format': 'json', 'lang': 'ru', 'limit': 2, 'apiKey': settings.geoapify_api_key}) as response:
                        response.raise_for_status()
                        body = bytearray()
                        async for chunk in response.aiter_bytes():
                            body.extend(chunk)
                            if len(body) > 100_000:
                                raise ValueError()
                        results = json.loads(body).get('results', [])
                    # Multiple suggestions, a street centroid or low confidence
                    # all remain on the manual review list.
                    matches = [p for p in results if p.get('result_type') == 'building' and p.get('country_code') == 'kz' and city_name(p.get('city', '')) == 'Өскемен' and p.get('housenumber') and p.get('rank', {}).get('confidence', 0) >= .95 and p.get('rank', {}).get('match_type') in ('full_match', 'match_by_building')]
                    if len(matches) != 1:
                        return
                    p = matches[0]
                    house = re.search(r'([0-9]+[\w]*(?:[/-][0-9]+[\w]*)?)\s*$', r['address'])
                    if not house or normalized(str(p['housenumber'])) != normalized(house[1]):
                        return
                    def street_key(value):
                        return re.sub(r'^(?:ул|улица|проспект|пр|переулок|пер)\s+', '', normalized(value))
                    if street_key(r['address'][:house.start()]) != street_key(p.get('street', '')):
                        return
                    lat, lng = float(p['lat']), float(p['lon'])
                    if not (-85.051129 <= lat <= 85.051129 and -180 <= lng <= 180):
                        return
                    # Record provider attribution and the returned address for audit.
                    info.update({'status': 'matched', 'lat': lat, 'lng': lng, 'confidence': p['rank']['confidence'], 'formatted': p.get('formatted'), 'datasource': p.get('datasource')})
                    r.update({'lat': lat, 'lng': lng})
                    c['warnings'] = [w for w in c['warnings'] if not w.startswith('Без координат:')]
                    c['warnings'].append('Координаты найдены Geoapify; результат геокодирования сохранён с источниками.')
                    summary['matched'] += 1
                except (httpx.HTTPError, ValueError, TypeError, KeyError, AttributeError):
                    return
        try:
            await asyncio.wait_for(asyncio.gather(*(locate(c) for c in pending)), timeout=15)
        except TimeoutError:
            pass
    return summary


def connect(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('CREATE TABLE IF NOT EXISTS registry_imports (id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires REAL NOT NULL, version INTEGER NOT NULL, preview TEXT NOT NULL, selection TEXT, commands TEXT, result TEXT)')
    db.execute('CREATE INDEX IF NOT EXISTS registry_import_owner ON registry_imports(owner, expires)')
    return db


async def create_preview(options, workspace, owner, settings):
    records, errors, statuses = [], [], []
    raw = list(options.records)
    remote = []
    if 'egov' in options.sources:
        remote, status, message = await egov_records(settings)
        if len(raw) + len(remote) > 100:
            remote, status, message = [], 'error', 'Общий предел — 100 строк. Импортируйте выгрузку и набор API отдельными пакетами.'
    for i, row in enumerate(raw + remote):
        try:
            r = clean_record(row)
            r['access_method'] = 'prepared_export' if i < len(raw) else 'egov_api'
            if r['source_id'] in options.sources:
                records.append(r)
        except (ValueError, TypeError, OverflowError) as exc:
            errors.append(f'Строка {i+1}: {exc}')
    for source in dict.fromkeys(options.sources):
        count = sum(r['source_id'] == source for r in records)
        statuses.append({'id': source, 'count': count, 'status': status if source == 'egov' and remote else 'export' if count else status if source == 'egov' else 'not_configured', 'message': message if source == 'egov' else 'Подготовленная выгрузка; подлинность требует проверки.' if count else 'Прямой доступ не настроен. Загрузите разрешённую выгрузку.'})
    now = datetime.now(timezone.utc)
    candidates = make_candidates(records, workspace['data'])
    geocoding = await geocode_candidates(candidates, settings)
    result = {'id': str(uuid4()), 'status': 'preview', 'created_at': now.isoformat(), 'expires_at': (now + timedelta(days=1)).isoformat(), 'candidates': candidates, 'errors': errors, 'sources': statuses, 'geocoding': geocoding}
    with closing(connect(settings.import_db_path)) as db, db:
        db.execute('DELETE FROM registry_imports WHERE expires < ?', (now.timestamp(),))
        count = db.execute('SELECT count(*) FROM registry_imports WHERE owner=?', (owner,)).fetchone()[0]
        if count >= 30:
            raise HTTPException(429, 'Не более 30 предпросмотров в сутки.')
        db.execute('INSERT INTO registry_imports(id,owner,expires,version,preview) VALUES(?,?,?,?,?)', (result['id'], owner, (now + timedelta(days=1)).timestamp(), workspace['version'], encoded(result)))
    return result


def load_job(db, job_id, owner):
    row = db.execute('SELECT * FROM registry_imports WHERE id=? AND owner=? AND expires>?', (job_id, owner, datetime.now(timezone.utc).timestamp())).fetchone()
    if not row:
        raise HTTPException(404, 'Импорт не найден или срок предпросмотра истёк.')
    return row


def job_status(job_id, owner, settings):
    with closing(connect(settings.import_db_path)) as db:
        row = load_job(db, job_id, owner)
        preview = json.loads(row['preview'])
        preview['status'] = 'committed' if row['result'] else 'committing' if row['selection'] else 'preview'
        preview['result'] = json.loads(row['result']) if row['result'] else None
        return preview


def build_commands(preview, selected, workspace):
    commands = []
    candidates = [c for c in preview['candidates'] if c['id'] in selected]
    if len(candidates) != len(selected) or any(c['action'] not in ('create', 'enrich') for c in candidates):
        raise HTTPException(422, 'Выберите доступные записи без конфликтов.')
    for c in candidates:
        r = c['record']
        complex_id = c['existing_id'] or c['id']
        if not c['existing_id']:
            complex_record = {'id': complex_id, 'name': r['name'], 'city': r['city'], 'address': r['address'], 'developer': r['developer'] or '', 'bin': r['developer_bin'], 'lat': r['lat'], 'lng': r['lng'], 'demo': False, 'origin': 'import', 'stage': STAGES[r['construction_status']], 'readinessClaimed': None, 'readinessConfirmed': None, 'readinessClaimedSource': None, 'readinessSources': [], 'legalBasis': {'type': 'unknown', 'status': 'unknown', 'source': '', 'checkedAt': '', 'reviewText': ''}, 'note': 'Импорт внешних данных. Сведения и роль застройщика требуют проверки.', 'factors': [], 'events': [], 'sources': []}
            commands.append({'type': 'complex', 'complex': complex_record})
        for s in c['sources']:
            aid = artifact_id(s)
            if any(a['id'] == aid and a['complexId'] == complex_id for a in workspace.get('artifacts', [])):
                continue
            provenance = {'schema': 'saq-registry-source/v1', **s, 'retrieved_at': preview['created_at'], 'access_method': s.get('access_method', 'prepared_export')}
            if c.get('geocoding'):
                provenance['geocoding'] = c['geocoding']
            artifact = {'id': aid, 'complexId': complex_id, 'kind': 'document', 'origin': 'import', 'availability': 'ok', 'source': SOURCES[s['source_id']][0] + ' · непроверенные сведения', 'url': s['source_url'], 'text': json.dumps(provenance, ensure_ascii=False, indent=2)}
            if s['observed_at']:
                artifact['date'] = s['observed_at']
            commands.append({'type': 'artifact.register', 'artifact': artifact})
    return commands


async def commit_import(options, workspace, owner, authorization, settings):
    # Auth enforced by fetch_workspace in main.py; coerce None -> '' to avoid httpx TypeError.
    authorization = authorization or ''
    selected = sorted(set(options.selected_ids))
    with closing(connect(settings.import_db_path)) as db, db:
        db.execute('BEGIN IMMEDIATE')
        row = load_job(db, options.job_id, owner)
        if row['selection'] and json.loads(row['selection']) != selected:
            raise HTTPException(409, 'Набор записей уже зафиксирован. Повторите исходный запрос.')
        if row['result']:
            return json.loads(row['result'])
        if not row['selection']:
            if workspace['version'] != row['version']:
                raise HTTPException(409, 'Данные изменились после предпросмотра. Получите данные заново.')
            commands = build_commands(json.loads(row['preview']), selected, workspace['data'])
            db.execute('UPDATE registry_imports SET selection=?,commands=? WHERE id=?', (encoded(selected), encoded(commands), options.job_id))
        else:
            commands = json.loads(row['commands'])
    payload = {'commands': commands, 'expected_version': row['version'], 'batch_id': 'registry-' + options.job_id}
    try:
        async with httpx.AsyncClient(timeout=35) as client:
            response = await client.post(f"{settings.supabase_url.rstrip('/')}/rest/v1/rpc/apply_registry_import", headers={'Authorization': authorization, 'apikey': settings.supabase_anon_key}, json=payload)
        if not response.is_success:
            if 'STALE_VERSION' in response.text:
                raise HTTPException(409, 'Рабочее пространство изменилось. Импорт не записан; получите новый предпросмотр.')
            raise HTTPException(502, 'Запись не подтверждена. Проверьте миграцию импорта и повторите тот же выбор.')
        result = response.json()
        if not isinstance(result, dict) or not isinstance(result.get('version'), int):
            raise ValueError('Invalid commit response')
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, 'Ответ не получен. Повторите тот же выбор: повторная запись защищена квитанцией.') from exc
    saved = {'job_id': options.job_id, 'status': 'committed', 'selected': len(selected), 'created': sum(c['type'] == 'complex' for c in commands), 'sources_added': sum(c['type'] == 'artifact.register' for c in commands), 'version': result['version']}
    with closing(connect(settings.import_db_path)) as db, db:
        db.execute('UPDATE registry_imports SET result=? WHERE id=? AND owner=?', (encoded(saved), options.job_id, owner))
    return saved
