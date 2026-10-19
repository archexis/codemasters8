import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app, get_settings, Settings
from backend.app.document_jobs import run_job, extract_pdf


def test_job_creation_and_poll_use_verified_actor_and_owner_scope(monkeypatch):
    calls = []
    launched = []
    def handler(request):
        calls.append(request)
        assert request.headers['authorization'] == 'Bearer operator-token'
        if request.url.path == '/auth/v1/user':
            return httpx.Response(200, json={'id': 'owner-123'})
        if request.url.path == '/rest/v1/workspaces':
            return httpx.Response(200, json=[{'version': 1, 'data': {'complexes': [{'id': 'z1'}], 'ads': []}}])
        if request.method == 'POST' and request.url.path == '/rest/v1/document_jobs':
            saved = json.loads(request.content)
            assert saved['owner_id'] == 'owner-123' and saved['input_path'].startswith('owner-123/z1/')
            assert 'token' not in json.dumps(saved)
            return httpx.Response(201, json=None)
        if request.method == 'GET' and request.url.path == '/rest/v1/document_jobs':
            assert request.url.params['owner_id'] == 'eq.owner-123'
            return httpx.Response(200, json=[])
        assert request.url.path.startswith('/storage/v1/object/evidence/owner-123/z1/')
        assert request.content == b'%PDF-1.4\nexample'
        return httpx.Response(200, json={})
    original = httpx.AsyncClient
    monkeypatch.setattr('backend.app.main.httpx.AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    monkeypatch.setattr('backend.app.document_jobs.launch_job', lambda *args: launched.append(args))
    app.dependency_overrides[get_settings] = lambda: Settings(supabase_url='http://supabase.test', supabase_anon_key='public-key')
    try:
        client = TestClient(app)
        result = client.post('/api/document-jobs?complex_id=z1', content=b'%PDF-1.4\nexample', headers={'authorization': 'Bearer operator-token', 'content-type': 'application/pdf'})
        assert result.status_code == 202 and result.json()['status'] == 'queued'
        assert len(launched) == 1
        assert client.get(result.json()['pollUrl'], headers={'authorization': 'Bearer operator-token'}).status_code == 404
        assert client.post('/api/document-jobs?complex_id=z1', content=b'pdf').status_code == 401
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize('kind,expected', [('pdf-text', 'PDF_PARSE_FAILED'), ('ocr', 'OCR_UNAVAILABLE')])
def test_worker_records_failure_without_creating_verified_facts(monkeypatch, kind, expected):
    monkeypatch.setattr('backend.app.ocr.shutil.which', lambda _: None)
    patches = []
    def handler(request):
        assert request.method == 'PATCH'
        assert request.url.params['owner_id'] == 'eq.user-1'
        patches.append(json.loads(request.content))
        return httpx.Response(204)
    original = httpx.AsyncClient
    monkeypatch.setattr('backend.app.document_jobs.httpx.AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    asyncio.run(run_job('http://supabase.test', {'Authorization': 'Bearer secret'}, {'id': 'job-1', 'owner_id': 'user-1', 'kind': kind}, b'%PDF-1.4\ncorrupt'))
    assert [p['status'] for p in patches] == ['running', 'failed']
    assert expected in patches[-1]['error']
    assert 'secret' not in json.dumps(patches)


def test_worker_success_persists_only_extraction_candidate(monkeypatch):
    from io import BytesIO
    from reportlab.pdfgen.canvas import Canvas
    output = BytesIO()
    canvas = Canvas(output)
    canvas.drawString(30, 30, 'Source quote')
    canvas.save()
    patches = []
    def handler(request):
        patches.append(json.loads(request.content))
        return httpx.Response(204)
    original = httpx.AsyncClient
    monkeypatch.setattr('backend.app.document_jobs.httpx.AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    asyncio.run(run_job('http://supabase.test', {'Authorization': 'Bearer secret'}, {'id': 'job-1', 'owner_id': 'user-1', 'kind': 'pdf-text'}, output.getvalue()))
    assert [p['status'] for p in patches] == ['running', 'succeeded']
    assert patches[-1]['result']['status'] == 'candidate'
    assert 'Source quote' in patches[-1]['result']['pages'][0]['text']
