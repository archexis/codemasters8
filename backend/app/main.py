"""Authenticated reporting API. Supabase validates JWTs; PostgREST enforces RLS."""
from functools import lru_cache
from typing import Annotated, Literal
from contextlib import asynccontextmanager, suppress
import asyncio

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import BaseModel, Field
from backend.app.projections import complex_factors, risk, preview, page, case_model, scope_model, timeline_items, latest_assertions
from backend.app import registry_import


class Settings(BaseSettings):
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    tavily_api_key: str = ""
    research_db_path: str = "backend/.data/research.sqlite3"
    research_domains: str = "gov.kz,homeportal.kz,krisha.kz"
    import_db_path: str = "backend/.data/imports.sqlite3"
    egov_api_key: str = ""
    egov_dataset: str = ""
    egov_field_map: str = ""
    egov_city_query: str = "Усть-Каменогорск"
    geoapify_api_key: str = ""
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()


WEIGHTS = {"R1": 35, "R2": 25, "R3": 10, "R4": 15, "R5": 10, "R6": 5}


def score_for(confirmed: set[str]) -> int:
    """Deterministic score: sum of confirmed weights, capped at 100. Mirrors src/lib/scoring.ts."""
    return min(100, sum(WEIGHTS.get(code, 0) for code in set(confirmed)))


def zone_for(score: int, confirmed: set[str]) -> str:
    """Red = score>=60 AND R1+R2 both confirmed; else score>=25 -> yellow; else green."""
    has = set(confirmed)
    return "red" if score >= 60 and {"R1", "R2"} <= has else "yellow" if score >= 25 else "green"


@asynccontextmanager
async def lifespan(app):
    from backend.app.research import research_worker
    task = asyncio.create_task(research_worker(get_settings()))
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="SAQ QURYLYS API", version="2.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins.split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


async def fetch_workspace(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    settings: Settings = Depends(get_settings),
) -> dict:
    if not authorization or not authorization.startswith("Bearer ") or not authorization[7:].strip():
        raise HTTPException(401, "Bearer token required")
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(503, "Supabase is not configured")
    headers = {"Authorization": authorization, "apikey": settings.supabase_anon_key}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            user = await client.get(f"{settings.supabase_url.rstrip('/')}/auth/v1/user", headers=headers)
            if user.status_code in (400, 401, 403):
                raise HTTPException(401, "Invalid or expired token")
            if not user.is_success:
                raise HTTPException(502, "Auth service unavailable")
            uid = user.json()["id"]
            request.state.user_id = uid
            response = await client.get(
                f"{settings.supabase_url.rstrip('/')}/rest/v1/workspaces",
                params={"owner_id": f"eq.{uid}", "select": "data,version"}, headers=headers,
            )
            if not response.is_success:
                raise HTTPException(502, "Workspace service unavailable")
            rows = response.json()
            if not rows:
                raise HTTPException(404, "Workspace not initialized")
            return rows[0]
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise HTTPException(502, "Supabase service unavailable") from exc


@app.get("/health")
async def health(settings: Settings = Depends(get_settings)) -> dict:
    return {"status": "ok", "supabase_configured": bool(settings.supabase_url and settings.supabase_anon_key)}


@app.post('/api/imports/preview')
async def import_preview(options: registry_import.PreviewOptions, request: Request, workspace: dict = Depends(fetch_workspace), settings: Settings = Depends(get_settings)):
    if len(registry_import.encoded(options.records).encode()) > 2 * 1024 * 1024:
        raise HTTPException(413, 'Выгрузка превышает 2 МБ.')
    return await registry_import.create_preview(options, workspace, request.state.user_id, settings)


@app.post('/api/imports/commit')
async def import_commit(options: registry_import.CommitOptions, request: Request, workspace: dict = Depends(fetch_workspace), settings: Settings = Depends(get_settings)):
    return await registry_import.commit_import(options, workspace, request.state.user_id, request.headers.get('authorization'), settings)


@app.get('/api/imports/{job_id}')
async def import_status(job_id: str, request: Request, workspace: dict = Depends(fetch_workspace), settings: Settings = Depends(get_settings)):
    return registry_import.job_status(job_id, request.state.user_id, settings)


@app.get("/api/summary")
async def summary(workspace: dict = Depends(fetch_workspace)) -> dict:
    zones = {"red": 0, "yellow": 0, "green": 0}
    for building in workspace["data"]["complexes"]:
        confirmed = {f["code"] for f in complex_factors(workspace["data"], building) if f["status"] == "confirmed"}
        zones[zone_for(score_for(confirmed), confirmed)] += 1
    return {"version": workspace["version"], "complexes": len(workspace["data"]["complexes"]), "ads": len(workspace["data"]["ads"]), "zones": zones}


@app.get("/api/export")
async def export(workspace: dict = Depends(fetch_workspace)) -> JSONResponse:
    # S2.5 (C3). Обычный /api/export — это экспорт ДАННЫХ, а не полный backup:
    # без байтов media и manifest он для restore непригоден. Метки ниже делают
    # это различие явным для клиентов и отчётов; поведение и тело неизменны.
    # S4.4. X-Export-Template фиксирует версию шаблона: workspace-data/v1 —
    # сырой экспорт данных; сигнальные карточки (signal-card/v1,
    # src/lib/export.ts) скачиваются клиентской кнопкой экспорта отдельно.
    return JSONResponse(
        workspace,
        headers={
            "Content-Disposition": 'attachment; filename="saq-workspace-data-export.json"',
            "Cache-Control": "no-store",
            "X-Export-Kind": "data-only",
            "X-Export-Template": "workspace-data/v1",
            "X-Export-Note": "Data export only, not a full backup: no media bytes or manifest. Use the backup ZIP (manifest.json + workspace.json + files/) for restore.",
        },
    )


@app.get("/api/map-summary")
async def map_summary(
    west: float = Query(-180, ge=-180, le=180), south: float = Query(-90, ge=-90, le=90),
    east: float = Query(180, ge=-180, le=180), north: float = Query(90, ge=-90, le=90),
    cursor: str | None = Query(None, max_length=80), limit: int = Query(100, ge=1, le=250),
    workspace: dict = Depends(fetch_workspace),
) -> dict:
    if south > north:
        raise HTTPException(422, "Invalid viewport")
    data = workspace["data"]
    def visible(z):
        lat, lng = z.get("lat"), z.get("lng")
        return isinstance(lat, (float, int)) and isinstance(lng, (float, int)) and south <= lat <= north and (west <= lng <= east if west <= east else lng >= west or lng <= east)
    return {"version": workspace["version"], **page([preview(data, z) for z in data["complexes"] if visible(z)], cursor, limit)}


@app.get("/api/publications")
async def publications(q: str = Query("", max_length=200), cursor: str | None = Query(None, max_length=80), limit: int = Query(25, ge=1, le=100), workspace: dict = Depends(fetch_workspace)) -> dict:
    items = [{k: a.get(k) for k in ("id", "zkId", "platform", "account", "date", "url", "captureAt", "text", "decision")} for a in workspace["data"]["ads"]]
    return {"version": workspace["version"], **page(items, cursor, limit, q)}


@app.get("/api/registry")
async def registry(q: str = Query("", max_length=200), kind: str = Query("complexes", pattern="^(complexes|organizations|documents)$"), cursor: str | None = Query(None, max_length=80), limit: int = Query(25, ge=1, le=100), workspace: dict = Depends(fetch_workspace)) -> dict:
    data = workspace["data"]
    if kind == "complexes":
        items = [preview(data, z) for z in data["complexes"]]
    elif kind == "organizations":
        organizations = {}
        for z in data["complexes"]:
            key = z.get("bin") or z.get("developer", "")
            organizations.setdefault(key, {"id": key, "name": z.get("developer"), "bin": z.get("bin"), "complexIds": []})["complexIds"].append(z["id"])
        items = list(organizations.values())
    else:
        items = [{k: a.get(k) for k in ("id", "complexId", "phaseId", "source", "kind", "date", "capturedAt", "mediaId", "url")} for a in data.get("artifacts", []) if a["kind"] != "publication"]
    return {"version": workspace["version"], **page(items, cursor, limit, q)}


@app.get("/api/complexes/{complex_id}/preview")
async def complex_preview(complex_id: str, workspace: dict = Depends(fetch_workspace)) -> dict:
    data = workspace["data"]
    z = next((z for z in data["complexes"] if z["id"] == complex_id), None)
    if z is None:
        raise HTTPException(404, "Complex not found")
    return {"version": workspace["version"], "complex": preview(data, z), "phases": [p for p in data.get("phases", []) if p["complexId"] == complex_id]}


@app.get("/api/cases/{case_id}")
async def case_state(case_id: str, workspace: dict = Depends(fetch_workspace)) -> dict:
    model = case_model(workspace["data"], case_id)
    if model is None:
        raise HTTPException(404, "Case not found")
    return {"version": workspace["version"], **model}


class ResearchOptions(BaseModel):
    monitor_hours: Literal[0, 6, 24, 168] = 0
    domains: list[str] | None = Field(default=None, max_length=10)


def research_domains(options, settings):
    allowed = [d.strip() for d in settings.research_domains.split(',') if d.strip()]
    chosen = options.domains if options.domains is not None else allowed
    if any(d not in allowed for d in chosen):
        raise HTTPException(422, 'Выберите приоритетные источники из настроенных сервером доменов.')
    return list(dict.fromkeys(chosen))


def research_target(workspace, case_id):
    data = workspace['data']
    case = next((item for item in data.get('cases', []) if item['id'] == case_id), None)
    if not case:
        raise HTTPException(404, 'Дело не найдено')
    building = next((item for item in data['complexes'] if item['id'] == case['complexId']), None)
    if not building:
        raise HTTPException(404, 'Объект не найден')
    phase = next(({'id': p['id'], 'name': p['name']} for p in data.get('phases', []) if p['id'] == case.get('phaseId') and p['complexId'] == building['id']), None)
    if case.get('phaseId') and not phase:
        raise HTTPException(404, 'Очередь дела не найдена')
    return {'complex': {key: building.get(key) for key in ('id', 'name', 'address', 'developer', 'bin', 'demo', 'origin')},
            'phase': phase,
            'period': case.get('period')}


@app.get('/api/cases/{case_id}/research')
async def research_status(case_id: str, request: Request, workspace: dict = Depends(fetch_workspace), settings: Settings = Depends(get_settings)):
    from backend.app.research import ResearchStore
    research_target(workspace, case_id)
    return {'configured': bool(settings.tavily_api_key),
            'monitorConfigured': bool(settings.tavily_api_key and settings.supabase_service_role_key and settings.supabase_url),
            'domains': [d.strip() for d in settings.research_domains.split(',') if d.strip()],
            **ResearchStore(settings.research_db_path).latest(request.state.user_id, case_id)}


@app.post('/api/cases/{case_id}/research', status_code=202)
async def start_research(case_id: str, request: Request, options: ResearchOptions = ResearchOptions(), workspace: dict = Depends(fetch_workspace), settings: Settings = Depends(get_settings)):
    from backend.app.research import ResearchStore
    target = research_target(workspace, case_id)
    target['domains'] = research_domains(options, settings)
    if not settings.tavily_api_key:
        raise HTTPException(503, 'Внешний поиск не подключён. Настройте TAVILY_API_KEY на сервере.')
    if target['complex'].get('demo') or target['complex'].get('origin') == 'demo':
        raise HTTPException(422, 'Для вымышленного DEMO-объекта обрабатываются только сохранённые материалы.')
    try:
        store = ResearchStore(settings.research_db_path)
        job_id = store.enqueue(request.state.user_id, case_id, target)
    except ValueError as exc:
        raise HTTPException(429, str(exc)) from exc
    return {'id': job_id, 'status': store.latest(request.state.user_id, case_id)['job']['status']}


@app.post('/api/cases/{case_id}/research/monitor')
async def set_research_monitor(case_id: str, options: ResearchOptions, request: Request, workspace: dict = Depends(fetch_workspace), settings: Settings = Depends(get_settings)):
    from backend.app.research import ResearchStore
    target = research_target(workspace, case_id)
    target['domains'] = research_domains(options, settings) if options.monitor_hours else []
    if options.monitor_hours and not (settings.tavily_api_key and settings.supabase_service_role_key and settings.supabase_url):
        raise HTTPException(503, 'Мониторинг недоступен: нужны внешний поиск и серверный доступ для сверки актуального дела.')
    if options.monitor_hours and (target['complex'].get('demo') or target['complex'].get('origin') == 'demo'):
        raise HTTPException(422, 'Мониторинг вымышленных объектов недоступен.')
    store = ResearchStore(settings.research_db_path)
    store.monitor(request.state.user_id, case_id, target, options.monitor_hours)
    return store.latest(request.state.user_id, case_id)


@app.get("/api/complexes/{complex_id}/dossier")
async def dossier_summary(complex_id: str, phase_id: str | None = Query(None, max_length=80), workspace: dict = Depends(fetch_workspace)) -> dict:
    model = scope_model(workspace["data"], complex_id, phase_id)
    if model is None:
        raise HTTPException(404, "Complex or applicable phase not found")
    return {"version": workspace["version"], **model}


@app.get("/api/complexes/{complex_id}/verification")
async def verification_facts(complex_id: str, phase_id: str | None = Query(None, max_length=80), cursor: str | None = Query(None, max_length=80), limit: int = Query(25, ge=1, le=100), workspace: dict = Depends(fetch_workspace)) -> dict:
    data = workspace["data"]
    model = scope_model(data, complex_id, phase_id)
    if model is None:
        raise HTTPException(404, "Complex or applicable phase not found")
    assertions = latest_assertions(data, model["cases"][0]["id"]) if model["cases"] else []
    claim_page = page([c for c in data.get("claims", []) if c["complexId"] == complex_id and c.get("phaseId") == phase_id], cursor, limit)
    visible = {c["id"] for c in claim_page["items"]}
    return {"version": workspace["version"], "caseId": model["cases"][0]["id"] if model["cases"] else None, **claim_page, "assertions": [a for a in assertions if a["claimId"] in visible]}


@app.get("/api/complexes/{complex_id}/timeline")
async def timeline_page(complex_id: str, phase_id: str | None = Query(None, max_length=80), cursor: str | None = Query(None, max_length=200), limit: int = Query(25, ge=1, le=50), workspace: dict = Depends(fetch_workspace)) -> dict:
    data = workspace["data"]
    if scope_model(data, complex_id, phase_id) is None:
        raise HTTPException(404, "Complex or applicable phase not found")
    items = timeline_items(data, complex_id, phase_id)
    for item in items:
        item["cursorKey"] = f"{item.get('date') or '0000-00-00'}:{item['id']}"
    items.sort(key=lambda item: item["cursorKey"], reverse=True)
    if cursor:
        items = [i for i in items if i["cursorKey"] < cursor]
    visible = items[:limit]
    return {"version": workspace["version"], "items": visible, "nextCursor": visible[-1]["cursorKey"] if len(items) > limit else None}


@app.get("/api/complexes/{complex_id}/relations")
async def graph_neighborhood(complex_id: str, phase_id: str | None = Query(None, max_length=80), cursor: str | None = Query(None, max_length=80), limit: int = Query(40, ge=3, le=80), workspace: dict = Depends(fetch_workspace)) -> dict:
    data = workspace["data"]
    if scope_model(data, complex_id, phase_id) is None:
        raise HTTPException(404, "Complex or applicable phase not found")
    z = next(z for z in data["complexes"] if z["id"] == complex_id)
    persisted = [r for r in data.get('relations', []) if r['complexId'] == complex_id and r.get('phaseId') == phase_id]
    if persisted:
        selected = page(persisted, cursor, min(160, limit - 1))
        root_id = f'phase:{phase_id}' if phase_id else f'complex:{complex_id}'
        node_map = {root_id: {'id': root_id, 'kind': 'phase' if phase_id else 'complex', 'label': z['name']}}
        edges = []
        for relation in selected['items']:
            missing = {relation['fromId'], relation['toId']} - node_map.keys()
            if len(node_map) + len(missing) > limit:
                break
            for endpoint in missing:
                kind, _, identifier = endpoint.partition(':')
                label = identifier
                if kind == 'complex':
                    label = next((c['name'] for c in data['complexes'] if c['id'] == identifier), identifier)
                elif kind == 'phase':
                    label = next((p['name'] for p in data.get('phases', []) if p['id'] == identifier), identifier)
                elif kind == 'organization':
                    label = next((c['developer'] for c in data['complexes'] if c.get('bin') == identifier), identifier)
                node_map[endpoint] = {'id': endpoint, 'kind': kind, 'label': label}
            edges.append({'id': relation['id'], 'source': relation['fromId'], 'target': relation['toId'], 'kind': relation['relationType'], 'status': relation['verificationStatus'], 'sourceArtifactIds': relation['sourceArtifactIds'], 'matchMethod': relation['matchMethod'], 'reviewedBy': relation.get('reviewedBy'), 'reviewedAt': relation.get('reviewedAt')})
        evidence_ids = {aid for e in edges for aid in e['sourceArtifactIds']}
        evidence = [{k: a.get(k) for k in ('id', 'source', 'kind', 'date', 'url', 'sha256')} for a in data.get('artifacts', []) if a['id'] in evidence_ids]
        return {'version': workspace['version'], 'hops': 1, 'nodes': list(node_map.values()), 'edges': edges, 'evidence': evidence, 'nextCursor': edges[-1]['id'] if edges and len(edges) < len(selected['items']) else selected['nextCursor']}
    # This is a registry identity link, not evidence of illegal conduct.
    related = [other for other in data["complexes"] if other["id"] != complex_id and ((z.get("bin") and other.get("bin") == z["bin"]) or (not z.get("bin") and z.get("developer") and other.get("developer") == z["developer"]))]
    related_page = page([preview(data, other) for other in related], cursor, max(1, limit - 2))
    organization_id = f"org:{z.get('bin') or z.get('developer', '')}"
    nodes = [{"id": complex_id, "kind": "complex", "label": z["name"]}, {"id": organization_id, "kind": "organization", "label": z.get("developer"), "bin": z.get("bin")}]
    nodes += [{"id": other["id"], "kind": "complex", "label": other["name"]} for other in related_page["items"]]
    edges = [{"id": f"developer:{node['id']}", "source": organization_id, "target": node["id"], "kind": "developer", "status": "registry-identity", "sourceLabel": "Карточка внутреннего реестра"} for node in nodes if node["kind"] == "complex"]
    evidence = [{k: a.get(k) for k in ("id", "kind", "source", "date", "url", "sha256")} for a in data.get("artifacts", []) if a["complexId"] == complex_id and a.get("phaseId") == phase_id and a["kind"] == "relationship"][:80]
    return {"version": workspace["version"], "hops": 1, "nodes": nodes, "edges": edges[:160], "evidence": evidence, "nextCursor": related_page["nextCursor"]}


@app.get("/api/cases/{case_id}/snapshots/{snapshot_id}/pdf")
async def signal_pdf(case_id: str, snapshot_id: str, workspace: dict = Depends(fetch_workspace)) -> Response:
    snapshot = next((s for s in workspace["data"].get("caseSnapshots", []) if s["id"] == snapshot_id and s["caseId"] == case_id), None)
    if snapshot is None:
        raise HTTPException(404, "Saved snapshot not found")
    from backend.app.pdf import render_signal
    try:
        content = await run_in_threadpool(render_signal, snapshot)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    return Response(content, media_type="application/pdf", headers={"Cache-Control": "no-store", "Content-Disposition": 'attachment; filename="saq-signal.pdf"', "X-Export-Template": "case-signal/v1"})


@app.post("/api/import/pdf")
async def import_pdf(request: Request, workspace: dict = Depends(fetch_workspace)) -> dict:
    """Parse a locally supplied original into an unsaved extraction candidate."""
    if request.headers.get("content-type", "").split(";", 1)[0] != "application/pdf":
        raise HTTPException(415, "application/pdf required")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 20 * 1024 * 1024:
            raise HTTPException(413, "PDF exceeds 20 MB")
    if not body.startswith(b"%PDF-"):
        raise HTTPException(422, "Invalid PDF")
    from backend.app.document_jobs import bounded_extract
    try:
        result = await bounded_extract(bytes(body))
    except Exception as exc:
        raise HTTPException(422, "PDF could not be parsed") from exc
    return {"version": workspace["version"], **result}


@app.post("/api/import/image")
async def import_image(request: Request, workspace: dict = Depends(fetch_workspace)) -> dict:
    from backend.app.ocr import extract_image, OCRUnavailable
    from backend.app.document_jobs import _slots
    import subprocess
    if request.headers.get("content-type", "").split(";", 1)[0] not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(415, "JPG, PNG or WebP required")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 20 * 1024 * 1024:
            raise HTTPException(413, "Image exceeds 20 MB")
    try:
        async with _slots:
            result = await run_in_threadpool(extract_image, bytes(body))
    except OCRUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    except (subprocess.TimeoutExpired, TimeoutError) as exc:
        raise HTTPException(504, "OCR time limit exceeded") from exc
    except (ValueError, subprocess.CalledProcessError) as exc:
        raise HTTPException(422, "Image could not be recognized; use manual text") from exc
    return {"version": workspace["version"], **result}


@app.post("/api/document-jobs", status_code=202)
async def create_document_job(request: Request, complex_id: str = Query(..., pattern="^[A-Za-z0-9-]{1,80}$"), kind: str = Query("pdf-text", pattern="^(pdf-text|ocr)$"), workspace: dict = Depends(fetch_workspace), settings: Settings = Depends(get_settings)) -> dict:
    """Persist the original and job, then process with at most two concurrent workers."""
    from uuid import uuid4
    from backend.app.document_jobs import launch_job, queue_has_capacity
    if not queue_has_capacity():
        raise HTTPException(429, "Document queue is full; retry later")
    if not any(z["id"] == complex_id for z in workspace["data"]["complexes"]):
        raise HTTPException(404, "Complex not found")
    if request.headers.get("content-type", "").split(";", 1)[0] != "application/pdf":
        raise HTTPException(415, "application/pdf required")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 20 * 1024 * 1024:
            raise HTTPException(413, "PDF exceeds 20 MB")
    if not body.startswith(b"%PDF-"):
        raise HTTPException(422, "Invalid PDF")
    uid = request.state.user_id
    job_id = str(uuid4())
    path = f"{uid}/{complex_id}/{job_id}.pdf"
    headers = {"Authorization": request.headers["authorization"], "apikey": settings.supabase_anon_key}
    job = {"id": job_id, "owner_id": uid, "complex_id": complex_id, "kind": kind, "status": "queued", "input_path": path}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            uploaded = await client.post(f"{settings.supabase_url.rstrip('/')}/storage/v1/object/evidence/{path}", headers={**headers, "content-type": "application/pdf"}, content=bytes(body))
            uploaded.raise_for_status()
            saved = await client.post(f"{settings.supabase_url.rstrip('/')}/rest/v1/document_jobs", headers=headers, json=job)
            saved.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Document job could not be persisted") from exc
    launch_job(settings.supabase_url, headers, job, bytes(body))
    return {"id": job_id, "status": "queued", "kind": kind, "inputPath": path, "pollUrl": f"/api/document-jobs/{job_id}"}


@app.get("/api/document-jobs/{job_id}")
async def document_job(job_id: str, request: Request, workspace: dict = Depends(fetch_workspace), settings: Settings = Depends(get_settings)) -> dict:
    from uuid import UUID
    try:
        UUID(job_id)
    except ValueError as exc:
        raise HTTPException(404, "Job not found") from exc
    headers = {"Authorization": request.headers["authorization"], "apikey": settings.supabase_anon_key}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(f"{settings.supabase_url.rstrip('/')}/rest/v1/document_jobs", headers=headers, params={"id": f"eq.{job_id}", "owner_id": f"eq.{request.state.user_id}", "select": "id,complex_id,kind,status,result,error,created_at,input_path"})
            response.raise_for_status()
            rows = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, "Job service unavailable") from exc
    if not rows:
        raise HTTPException(404, "Job not found")
    return rows[0]


@app.post("/api/document-jobs/{job_id}/retry", status_code=202)
async def retry_document_job(job_id: str, request: Request, workspace: dict = Depends(fetch_workspace), settings: Settings = Depends(get_settings)) -> dict:
    """An authenticated retry also recovers jobs interrupted by process restart."""
    from backend.app.document_jobs import launch_job, queue_has_capacity
    if not queue_has_capacity():
        raise HTTPException(429, "Document queue is full; retry later")
    job = await document_job(job_id, request, workspace, settings)
    if job["status"] == "succeeded":
        return {"id": job_id, "status": "succeeded"}
    uid = request.state.user_id
    if job["input_path"] != f"{uid}/{job['complex_id']}/{job_id}.pdf" or not any(z['id'] == job['complex_id'] for z in workspace['data']['complexes']):
        raise HTTPException(409, "Job original is not available in this workspace")
    headers = {"Authorization": request.headers["authorization"], "apikey": settings.supabase_anon_key}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            original = await client.get(f"{settings.supabase_url.rstrip('/')}/storage/v1/object/authenticated/evidence/{job['input_path']}", headers=headers)
            original.raise_for_status()
            if len(original.content) > 20 * 1024 * 1024:
                raise HTTPException(413, "PDF exceeds 20 MB")
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Saved original unavailable") from exc
    launch_job(settings.supabase_url, headers, {**job, "owner_id": uid}, original.content)
    return {"id": job_id, "status": "queued"}
