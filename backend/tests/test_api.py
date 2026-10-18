from fastapi.testclient import TestClient
from backend.app.main import app, fetch_workspace, get_settings, Settings, score_for, zone_for
import httpx
import json
import pytest
from pathlib import Path

client = TestClient(app)

def test_health_and_missing_auth():
    assert client.get('/health').status_code == 200
    assert client.get('/api/export').status_code == 401
    assert client.get('/api/summary').status_code == 401

def test_no_configuration_does_not_fake_success():
    app.dependency_overrides[get_settings] = lambda: Settings(supabase_url='', supabase_anon_key='')
    try:
        assert client.get('/api/export', headers={'Authorization':'Bearer fake'}).status_code == 503
    finally:
        app.dependency_overrides.clear()

@pytest.mark.parametrize('auth_status,expected', [(400,401),(401,401),(500,502),(200,200)])
def test_real_auth_adapter_forwards_user_token_and_scopes_query(monkeypatch, auth_status, expected):
    requests = []
    def handler(request):
        requests.append(request)
        assert request.headers['authorization'] == 'Bearer user-token'
        assert request.headers['apikey'] == 'public-key'
        if request.url.path == '/auth/v1/user':
            return httpx.Response(auth_status,json={'id':'user-123'})
        assert request.url.params['owner_id'] == 'eq.user-123'
        return httpx.Response(200,json=[{'version':1,'data':{'complexes':[],'ads':[]}}])
    original = httpx.AsyncClient
    monkeypatch.setattr('backend.app.main.httpx.AsyncClient',lambda **kwargs: original(transport=httpx.MockTransport(handler),**kwargs))
    app.dependency_overrides[get_settings] = lambda: Settings(supabase_url='http://supabase.test',supabase_anon_key='public-key')
    try:
        assert client.get('/api/summary',headers={'Authorization':'Bearer user-token'}).status_code == expected
        assert len(requests) == (2 if auth_status == 200 else 1)
    finally:
        app.dependency_overrides.clear()

def test_summary_and_export_use_authenticated_workspace():
    workspace = {'version': 7, 'data': {'complexes': [
        {'factors': [{'code':'R1','status':'confirmed'},{'code':'R2','status':'confirmed'}]},
        {'factors': [{'code':'R1','status':'confirmed'},{'code':'R3','status':'confirmed'},{'code':'R4','status':'confirmed'}]},
        {'factors': [{'code':'R2','status':'hypothesis'}]},
    ], 'ads': []}}
    app.dependency_overrides[fetch_workspace] = lambda: workspace
    try:
        result = client.get('/api/summary')
        assert result.json()['zones'] == {'red':1, 'yellow':1, 'green':1}
        exported = client.get('/api/export')
        assert exported.json() == workspace
        assert exported.headers['cache-control'] == 'no-store'
    finally:
        app.dependency_overrides.clear()

def load_scoring_corpus():
    """S1.5 golden corpus shared with TS. Expected values come from the JSON, never hand-copied."""
    root = Path(__file__).resolve().parents[2]
    return json.loads((root / 'tests/fixtures/contracts/scoring.json').read_text(encoding='utf-8'))

def factors_of(case):
    factors = [{'code': c, 'status': 'confirmed'} for c in case.get('confirmed', [])]
    for status in case.get('statuses', []):
        factors.append({'code': 'R2', 'status': status})
    return factors

def test_python_matches_golden_scoring_corpus():
    corpus = load_scoring_corpus()
    # Per-case: same helpers that /api/summary uses, expected from the JSON.
    for case in corpus['cases']:
        confirmed = {f['code'] for f in factors_of(case) if f['status'] == 'confirmed'}
        score = score_for(confirmed)
        assert score == case['expected']['score'], case['id']
        assert zone_for(score, confirmed) == case['expected']['zone'], case['id']
    # Aggregate: one workspace complex per case, zone tally derived from the JSON.
    workspace = {'version': 1, 'data': {'complexes': [{'factors': factors_of(c)} for c in corpus['cases']], 'ads': []}}
    app.dependency_overrides[fetch_workspace] = lambda: workspace
    try:
        result = client.get('/api/summary')
        assert result.status_code == 200
        body = result.json()
        expected_zones = {'red': 0, 'yellow': 0, 'green': 0}
        for case in corpus['cases']:
            expected_zones[case['expected']['zone']] += 1
        assert body['zones'] == expected_zones
        assert body['complexes'] == len(corpus['cases'])
    finally:
        app.dependency_overrides.clear()

def test_zone_boundaries_via_zone_function():
    """24/25 and 59/60 edges go through zone_for directly — such scores are unreachable via weights."""
    corpus = load_scoring_corpus()
    for boundary in corpus['zoneBoundaries']:
        confirmed = set()
        if boundary['confirmedIncludesR1']:
            confirmed.add('R1')
        if boundary['confirmedIncludesR2']:
            confirmed.add('R2')
        assert zone_for(boundary['score'], confirmed) == boundary['expectedZone'], boundary
