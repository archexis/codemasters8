import json

import httpx
import pytest
from fastapi.testclient import TestClient
from backend.app import registry_import as imports
from backend.app.main import app, fetch_workspace, get_settings, Settings

ROW = {'name': 'Тест импорта', 'city': 'Усть-Каменогорск', 'address': 'Тестовая, 1/2', 'developer_bin': '001234567890', 'source_url': 'https://krisha.kz/complex/import-test/'}


@pytest.fixture
def setup(tmp_path):
    settings = Settings(import_db_path=str(tmp_path / 'imports.sqlite3'), supabase_url='https://supabase.test', supabase_anon_key='public-key', egov_api_key='', egov_dataset='', egov_field_map='', geoapify_api_key='')
    workspace = {'version': 7, 'data': {'complexes': [], 'artifacts': []}}
    def owned(request):
        request.state.user_id = request.headers.get('x-test-owner', 'owner-a')
        return workspace
    # A typed request parameter is needed for FastAPI dependency injection.
    from fastapi import Request
    owned.__annotations__['request'] = Request
    app.dependency_overrides[fetch_workspace] = owned
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        yield TestClient(app), settings, workspace
    finally:
        app.dependency_overrides.clear()


def test_routes_require_auth():
    client = TestClient(app)
    assert client.post('/api/imports/preview', json={'sources': ['krisha']}).status_code == 401
    assert client.get('/api/imports/anything').status_code == 401
    assert client.post('/api/imports/commit', json={'job_id': '12345678-1234-4234-8234-123456789abc', 'selected_ids': ['x']}).status_code == 401


def test_preview_never_invents_objects_and_jobs_are_owner_scoped(setup):
    client, settings, workspace = setup
    result = client.post('/api/imports/preview', json={}).json()
    assert result['candidates'] == []
    assert all(s['status'] == 'not_configured' for s in result['sources'])
    result = client.post('/api/imports/preview', json={'records': [ROW, {**ROW, 'source_url': 'https://developers.kz/import-test/'}]}).json()
    assert len(result['candidates']) == 1
    assert len(result['candidates'][0]['sources']) == 2
    assert result['candidates'][0]['record']['lat'] is None
    assert result['candidates'][0]['record']['observed_at'] is None
    assert client.get('/api/imports/' + result['id']).json()['status'] == 'preview'
    assert client.get('/api/imports/' + result['id'], headers={'x-test-owner': 'other'}).status_code == 404
    assert client.post('/api/imports/commit', headers={'x-test-owner': 'other'}, json={'job_id': result['id'], 'selected_ids': [result['candidates'][0]['id']]}).status_code == 404
    with imports.closing(imports.connect(settings.import_db_path)) as db, db:
        db.execute('UPDATE registry_imports SET expires=0 WHERE id=?', (result['id'],))
    assert client.get('/api/imports/' + result['id']).status_code == 404


@pytest.mark.parametrize('bad', [
    {'city': 'Алматы'}, {'developer_bin': '123'}, {'observed_at': '2026-02-30'}, {'lat': 49},
    {'lat': True, 'lng': 82}, {'source_url': 'http://krisha.kz/a'}, {'source_url': 'https://krisha.kz.evil.test/a'},
    {'source_url': 'https://data.egov.kz/a?apiKey=secret'},
])
def test_invalid_rows_are_reported(bad, setup):
    client, _, _ = setup
    result = client.post('/api/imports/preview', json={'records': [{**ROW, **bad}]}).json()
    assert result['candidates'] == []
    assert len(result['errors']) == 1


def test_conflicts_and_stale_preview_cannot_commit(setup):
    client, _, workspace = setup
    preview = client.post('/api/imports/preview', json={'records': [ROW, {**ROW, 'developer_bin': '991234567890'}]}).json()
    assert preview['candidates'][0]['action'] == 'review'
    assert client.post('/api/imports/commit', json={'job_id': preview['id'], 'selected_ids': [preview['candidates'][0]['id']]}).status_code == 422
    preview = client.post('/api/imports/preview', json={'records': [ROW]}).json()
    workspace['version'] += 1
    assert client.post('/api/imports/commit', json={'job_id': preview['id'], 'selected_ids': [preview['candidates'][0]['id']]}).status_code == 409


def test_commit_uses_atomic_rpc_user_token_and_stable_retry_payload(setup, monkeypatch):
    client, settings, workspace = setup
    preview = client.post('/api/imports/preview', json={'records': [ROW]}).json()
    payload = {'job_id': preview['id'], 'selected_ids': [preview['candidates'][0]['id']]}
    calls = []
    def handler(request):
        assert request.headers['Authorization'] == 'Bearer user-token'
        assert request.headers['apikey'] == 'public-key'
        assert request.url.path == '/rest/v1/rpc/apply_registry_import'
        body = json.loads(request.content)
        calls.append(body)
        assert body['expected_version'] == 7
        assert body['commands'][0]['complex']['legalBasis']['checkedAt'] == ''
        provenance = json.loads(body['commands'][1]['artifact']['text'])
        assert provenance['verification_status'] == 'unverified'
        assert provenance['access_method'] == 'prepared_export'
        assert provenance['source_type'] == 'commercial_catalog'
        if len(calls) == 1:
            raise httpx.ReadTimeout('lost ACK')
        return httpx.Response(200, json={'version': 9, 'replayed': True})
    original = httpx.AsyncClient
    monkeypatch.setattr(imports.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    headers = {'Authorization': 'Bearer user-token'}
    assert client.post('/api/imports/commit', json=payload, headers=headers).status_code == 502
    assert client.get('/api/imports/' + preview['id']).json()['status'] == 'committing'
    workspace['version'] = 9  # SQL committed, HTTP response was lost.
    response = client.post('/api/imports/commit', json=payload, headers=headers)
    assert response.status_code == 200
    assert calls[0] == calls[1]
    assert response.json()['created'] == 1
    assert client.get('/api/imports/' + preview['id']).json()['status'] == 'committed'
    assert client.post('/api/imports/commit', json=payload, headers=headers).json() == response.json()
    assert len(calls) == 2
    assert client.post('/api/imports/commit', json={**payload, 'selected_ids': ['other']}, headers=headers).status_code == 409


def test_egov_adapter_is_bounded_maps_fields_and_never_exposes_key(setup, monkeypatch):
    client, settings, _ = setup
    settings.egov_api_key = 'private-test-key'
    settings.egov_dataset = 'operator_dataset/v1'
    settings.egov_field_map = json.dumps({'name': 'title', 'city': 'town', 'address': 'location'})
    def handler(request):
        assert request.url.host == 'data.egov.kz'
        assert request.url.path == '/api/v4/operator_dataset/v1'
        assert request.url.params['apiKey'] == 'private-test-key'
        assert json.loads(request.url.params['source'])['size'] == 101
        return httpx.Response(200, json=[{'title': 'Объект API', 'town': 'Өскемен', 'location': 'Тестовая, 8'}])
    original = httpx.AsyncClient
    monkeypatch.setattr(imports.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    response = client.post('/api/imports/preview', json={'sources': ['egov']})
    assert response.status_code == 200
    assert 'private-test-key' not in response.text
    record = response.json()['candidates'][0]['record']
    assert record['verification_status'] == 'unverified'
    assert record['source_type'] == 'official_open_data'
    assert response.json()['sources'][0]['status'] == 'available'
    settings.egov_dataset = 'https://localhost/private'
    result = client.post('/api/imports/preview', json={'sources': ['egov']}).json()
    assert not result['candidates'] and result['sources'][0]['status'] == 'error'


@pytest.mark.parametrize('confidence,result_type,expected', [(1, 'building', True), (.5, 'building', False), (1, 'street', False)])
def test_geocoder_preserves_source_coordinates_and_rejects_imprecise_matches(setup, monkeypatch, confidence, result_type, expected):
    client, settings, workspace = setup
    settings.geoapify_api_key = 'private-geocode-key'
    def handler(request):
        assert request.url.host == 'api.geoapify.com'
        assert request.url.params['filter'] == 'countrycode:kz'
        return httpx.Response(200, json={'results': [{'lat': 49.95, 'lon': 82.6, 'city': 'Усть-Каменогорск', 'country_code': 'kz', 'housenumber': '1/2', 'street': 'Тестовая', 'result_type': result_type, 'rank': {'confidence': confidence, 'match_type': 'full_match'}, 'datasource': {'attribution': 'Test provider'}}]})
    original = httpx.AsyncClient
    monkeypatch.setattr(imports.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    response = client.post('/api/imports/preview', json={'sources': ['krisha'], 'records': [ROW]})
    assert 'private-geocode-key' not in response.text
    p = response.json()
    c = p['candidates'][0]
    assert (c['record']['lat'] is not None) == expected
    assert c['sources'][0]['lat'] is None
    assert c['sources'][0]['verification_status'] == 'unverified'
    assert p['geocoding']['matched'] == int(expected)
    commands = imports.build_commands(p, [c['id']], workspace['data'])
    provenance = json.loads(commands[1]['artifact']['text'])
    assert provenance['geocoding']['status'] == ('matched' if expected else 'manual_review')
