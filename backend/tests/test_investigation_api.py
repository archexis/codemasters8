from copy import deepcopy
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader

from backend.app.main import app, fetch_workspace

client = TestClient(app)


@pytest.fixture
def workspace():
    z = {"id": "z1", "name": "Демонстрационный ЖК", "address": "Учебная улица", "developer": "DEMO", "bin": None, "demo": True, "origin": "demo", "stage": "Строительство", "lat": 43.2, "lng": 76.9, "legalBasis": {"type": "unknown", "status": "unknown"}, "factors": [{"code": "R1", "status": "confirmed"}]}
    assertion = {"id": "fact1", "caseId": "c1", "claimId": "cl1", "code": "R2", "status": "verified", "actor": "Аналитик", "at": "2026-10-19T01:00:00Z", "evidence": {"source": "Публикация", "quote": "Платное бронирование", "date": "2026-10-19"}}
    snapshot = {"id": "snap1", "caseId": "c1", "complexId": "z1", "revision": 1, "status": "confirmed", "actor": "Аналитик", "at": "2026-10-19T01:00:00Z", "comment": "Проверить", "complex": deepcopy(z), "score": 25, "zone": "yellow", "weightsVersion": 1, "assertions": [assertion], "artifacts": [{"id": "a1", "source": "Источник", "text": "Платное бронирование", "kind": "publication", "capturedAt": "2026-10-19T01:00:00Z"}], "limitations": ["Применимое основание неизвестно"], "demo": True}
    snapshot['artifacts'][0]['complexId'] = 'z1'
    w = {"version": 8, "data": {"complexes": [z], "ads": [{"id": f"ad{i}", "text": f"Публикация {i}", "zkId": "z1", "analysis": {"large": "private"}} for i in range(3)], "cases": [{"id": "c1", "complexId": "z1", "status": "confirmed", "artifactIds": ["a1"], "updatedAt": "2026-10-19"}], "assertions": [assertion], "caseSnapshots": [snapshot], "artifacts": snapshot["artifacts"]}}
    app.dependency_overrides[fetch_workspace] = lambda: w
    yield w
    app.dependency_overrides.clear()


def test_new_routes_require_authenticated_workspace():
    for route in ("/api/map-summary", "/api/publications", "/api/registry", "/api/cases/c1", "/api/cases/c1/snapshots/s1/pdf"):
        assert client.get(route).status_code == 401
    assert client.post("/api/import/pdf", content=b"%PDF-1.4").status_code == 401


def test_bounded_projections_and_new_assertion_summary(workspace):
    assert client.get("/api/summary").json()["zones"] == {"red": 0, "yellow": 1, "green": 0}
    page1 = client.get("/api/publications?limit=2").json()
    assert len(page1["items"]) == 2
    assert "analysis" not in page1["items"][0]
    page2 = client.get(f"/api/publications?cursor={page1['nextCursor']}&limit=2").json()
    assert len(page2["items"]) == 1 and page2["nextCursor"] is None
    assert client.get("/api/publications?limit=10000").status_code == 422
    assert client.get("/api/map-summary?west=0&east=1").json()["items"] == []
    assert client.get("/api/map-summary").json()["items"][0]["score"] == 25
    assert client.get("/api/cases/missing").status_code == 404
    assert client.get("/api/cases/c1").json()["snapshots"][0]["id"] == "snap1"
    assert "complex" not in client.get("/api/cases/c1").json()["snapshots"][0]
    assert client.get("/api/complexes/z1/dossier").json()["caseCount"] == 1
    assert client.get("/api/complexes/z1/dossier?phase_id=foreign").status_code == 404
    assert client.get("/api/complexes/z1/verification?phase_id=foreign").status_code == 404
    assert client.get("/api/complexes/z1/verification").json()["caseId"] == "c1"
    timeline = client.get("/api/complexes/z1/timeline?limit=1").json()
    assert len(timeline["items"]) == 1 and timeline["nextCursor"]
    assert len(client.get('/api/complexes/z1/timeline', params={'cursor': timeline['nextCursor'], 'limit': 1}).json()["items"]) == 1
    relations = client.get("/api/complexes/z1/relations").json()
    assert relations["hops"] == 1 and len(relations["nodes"]) <= 80 and len(relations["edges"]) <= 160
    assert relations["edges"][0]["status"] == "registry-identity"
    assert client.get("/api/complexes/z1/timeline?limit=10000").status_code == 422
    workspace['data']['relations'] = [{'id': 'rel1', 'complexId': 'z1', 'fromId': 'complex:z1', 'toId': 'document:a1', 'relationType': 'mentions', 'verificationStatus': 'verified', 'sourceArtifactIds': ['a1'], 'matchMethod': 'manual'}]
    persisted_graph = client.get('/api/complexes/z1/relations').json()
    assert persisted_graph['edges'][0]['kind'] == 'mentions'
    assert persisted_graph['edges'][0]['status'] == 'verified'
    assert persisted_graph['evidence'][0]['id'] == 'a1'
    workspace['data']['phases'] = [{'id': 'p1', 'complexId': 'z1', 'name': 'Очередь', 'readinessClaimed': 60, 'readinessConfirmed': 30}]
    phase_preview = client.get('/api/complexes/z1/dossier?phase_id=p1').json()['complex']
    assert phase_preview['readinessClaimed'] == 60 and phase_preview['readinessConfirmed'] == 30


def test_untouched_draft_preserves_existing_assessment_in_map_registry_and_dossier(workspace):
    data = workspace['data']
    data['cases'].append({'id': 'empty', 'complexId': 'z1', 'status': 'draft', 'artifactIds': [], 'updatedAt': '2026-10-20'})
    assert client.get('/api/map-summary').json()['items'][0]['score'] == 25
    assert client.get('/api/registry').json()['items'][0]['score'] == 25
    assert client.get('/api/complexes/z1/dossier').json()['complex']['score'] == 25
    assert client.get('/api/summary').json()['zones'] == {'red': 0, 'yellow': 1, 'green': 0}
    data['cases'] = [data['cases'][-1]]
    data['assertions'] = []
    data['caseSnapshots'] = []
    assert client.get('/api/map-summary').json()['items'][0]['score'] == 35
    data['phases'] = [{'id': 'p1', 'complexId': 'z1', 'name': 'Очередь'}]
    data['cases'][0]['phaseId'] = 'p1'
    assert client.get('/api/complexes/z1/dossier?phase_id=p1').json()['complex']['score'] == 0


def test_zero_after_rejection_is_not_replaced_by_legacy_factors(workspace):
    data = workspace['data']
    data['cases'][0]['status'] = 'draft'
    data['assertions'].append({**data['assertions'][0], 'id': 'rejected', 'status': 'rejected'})
    assert client.get('/api/map-summary').json()['items'][0]['score'] == 0
    assert client.get('/api/complexes/z1/dossier').json()['complex']['score'] == 0


def test_snapshot_pdf_is_reproducible_unicode_and_independent_of_current_state(workspace):
    path = "/api/cases/c1/snapshots/snap1/pdf"
    before = client.get(path)
    assert before.status_code == 200 and before.content.startswith(b"%PDF-")
    assert before.headers["cache-control"] == "no-store"
    text = "\n".join(p.extract_text() for p in PdfReader(BytesIO(before.content)).pages)
    assert "Демонстрационный ЖК" in text and "DEMO" in text and "Платное бронирование" in text
    assert 'Автор решения: Аналитик' in text and 'Зона риска: Жёлтая' in text
    assert 'Версия весов: 1' in text and 'Тип основания: Не установлено' in text
    assert 'Время решения (UTC)' in text
    for internal in ('weightsVersion:', 'actor:', 'zone:', 'unknown / unknown'):
        assert internal not in text
    workspace["data"]["complexes"][0]["name"] = "Нынешнее имя"
    assert client.get(path).content == before.content
    assert client.get("/api/cases/foreign/snapshots/snap1/pdf").status_code == 404
    imported = client.post("/api/import/pdf", content=before.content, headers={"content-type": "application/pdf"})
    assert imported.status_code == 200
    assert imported.json()["status"] == "candidate" and len(imported.json()["sha256"]) == 64
    assert len(workspace["data"]["assertions"]) == 1


def test_pdf_import_rejects_wrong_type_and_corrupt_pdf(workspace):
    assert client.post("/api/import/pdf", content=b"%PDF-1.4").status_code == 415
    assert client.post("/api/import/pdf", content=b"not a pdf", headers={"content-type": "application/pdf"}).status_code == 422
    assert client.post("/api/import/pdf", content=b"%PDF-1.4\ncorrupt", headers={"content-type": "application/pdf"}).status_code == 422


def test_pdf_null_phase_and_long_unicode_source(workspace):
    snapshot = workspace['data']['caseSnapshots'][0]
    snapshot['phase'] = None
    snapshot['artifacts'][0]['text'] = 'Құрылыс жүріп жатыр. Проверка длинного материала. ' * 160
    snapshot['artifacts'][0]['url'] = 'https://example.test/' + 'long-source-' * 80
    result = client.get('/api/cases/c1/snapshots/snap1/pdf')
    assert result.status_code == 200
    pdf = PdfReader(BytesIO(result.content))
    assert len(pdf.pages) > 1
    text = '\n'.join(page.extract_text() for page in pdf.pages)
    assert 'Құрылыс жүріп жатыр' in text and 'Весь объект' in text
    assert ''.join(text.split()).count('Проверкадлинногоматериала.') == 160


def test_pdf_only_assigns_weight_to_unique_verified_codes(workspace):
    snapshot = workspace['data']['caseSnapshots'][0]
    assertion = snapshot['assertions'][0]
    snapshot['assertions'] = [
        {**assertion, 'status': 'rejected'},
        {**assertion, 'status': 'candidate'},
        assertion,
        {**assertion, 'id': 'same-code'},
    ]
    result = client.get('/api/cases/c1/snapshots/snap1/pdf')
    assert result.status_code == 200
    text = '\n'.join(page.extract_text() for page in PdfReader(BytesIO(result.content)).pages)
    assert 'R2 +0 — Отклонено' in text
    assert 'R2 +0 — Требует проверки' in text
    assert text.count('R2 +25') == 1
