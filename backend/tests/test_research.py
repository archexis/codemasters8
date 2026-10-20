from copy import deepcopy
import asyncio
import json

import httpx
import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from backend.app.main import app, fetch_workspace, get_settings, Settings
from backend.app.research import ResearchStore, obvious_match, collect_sources, canonical_url, resolve_monitor_target

TARGET = {'complex': {'id': 'z1', 'name': 'Тихая гавань', 'address': 'Алматы, улица Мира 27', 'developer': 'Строительная компания Дом'}, 'phase': None, 'period': None}
RECORD = 'ЖК: Тихая гавань\nАдрес: Алматы, улица Мира 27\nЗастройщик: Строительная компания Дом\nДепозит 300 000 тенге.'


def test_binding_requires_one_exact_record_and_no_conflicting_scope():
    assert obvious_match(TARGET['complex'], RECORD)
    for text in (RECORD+'\nЖК: Другой дом', RECORD+'\nСравнение ЖК Соседний', RECORD.replace('ЖК:', 'Объект не является:'), RECORD+'\nНе относится к указанному объекту', RECORD.replace('Мира 27', 'Мира 270'), RECORD+'\nОчередь: Вторая'):
        assert not obvious_match(TARGET['complex'], text)
    phase={'id':'p1','name':'Первая очередь'}
    assert not obvious_match(TARGET['complex'], RECORD, phase)
    assert obvious_match(TARGET['complex'], RECORD+'\nОчередь: Первая очередь', phase)
    assert not obvious_match(TARGET['complex'], RECORD+'\nОчередь: Вторая очередь', phase)
    for url in ('http://example.com', 'https://localhost/x', 'https://127.0.0.1', 'https://u:p@example.com', 'https://example.com:bad', 'javascript:alert(1)'):
        assert canonical_url(url) is None


def test_store_owner_dedup_restart_lease_and_bounded_history(tmp_path):
    path=tmp_path/'research.sqlite'
    store=ResearchStore(path)
    first=store.enqueue('alice','case',TARGET,now=100)
    assert store.enqueue('alice','case',TARGET,now=101)==first
    assert store.latest('bob','case')['job'] is None
    lease=store.claim(now=110)[4]
    restarted=ResearchStore(path)
    new_lease=restarted.claim(now=711)[4]
    assert lease!=new_lease
    store.finish(first,lease,{'sources':[]})
    assert restarted.latest('alice','case')['job']['status']=='running'
    restarted.finish(first,new_lease,{'sources':[]})
    for i in range(25):
        job=store.enqueue('alice','case',TARGET,now=1000+i*61)
        claimed=store.claim(now=1000+i*61)
        assert claimed[0]==job
        store.finish(job,claimed[4],{'sources':[]})
    assert len(store.latest('alice','case')['history'])<=20


def test_monitor_refreshes_target_survives_restart_and_disables_deleted_cases(tmp_path):
    store=ResearchStore(tmp_path/'jobs.sqlite')
    store.monitor('alice','exists',{**TARGET,'domains':['gov.kz']},6)
    store.monitor('bob','deleted',TARGET,6)
    refreshed=deepcopy(TARGET);refreshed['complex']['name']='Актуальное имя'
    calls=[]
    async def resolve(owner,case_id):
        calls.append((owner,case_id))
        return refreshed if owner=='alice' else None
    asyncio.run(ResearchStore(store.path).schedule(resolve,now=10**11))
    assert set(calls)=={('alice','exists'),('bob','deleted')}
    assert store.claim()[3]=={**refreshed,'domains':['gov.kz']}
    assert store.latest('bob','deleted')['monitor'] is None
    assert store.latest('alice','exists')['monitor']['hours']==6
    store.monitor('alice','exists',TARGET,0)
    assert store.latest('alice','exists')['monitor'] is None


def test_search_partial_failure_dates_snippets_and_untrusted_json():
    calls=[]
    def handler(request):
        payload=json.loads(request.content);calls.append(payload)
        if len(calls)==2:return httpx.Response(503)
        return httpx.Response(200,json={'results':[
            {'url':'https://example.com/good','title':'Оригинал','raw_content':RECORD,'published_date':'Tue, 20 Oct 2026 12:00:00 GMT'},
            {'url':'https://example.com/snippet','content':RECORD,'published_date':'2026-10-20'},
            {'url':'https://example.com/old','raw_content':RECORD,'published_date':'2025-01-01'},
            {'url':'https://example.com/nodate','raw_content':RECORD},
            'bad result',{'url':'https://localhost','raw_content':RECORD}]})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            target={**TARGET,'period':{'from':'2026-10-01','to':'2026-10-31'}}
            return await collect_sources(target,'unused',['gov.kz'],client)
    result=asyncio.run(run())
    assert calls[0]['include_domains']==['gov.kz'] and 'include_domains' not in calls[1]
    assert calls[0]['start_date']=='2026-10-01'
    assert result['searches'][1]['status']=='failed'
    good,snippet,old,nodate=result['sources']
    assert good['match']=='obvious' and good['date']=='2026-10-20'
    assert good['candidates'][0]['quote'] in RECORD
    assert snippet['match']=='uncertain' and not snippet['originalCaptured'] and snippet['candidates']==[]
    assert not old['inPeriod'] and old['candidates']==[]
    assert nodate['date'] is None and nodate['match']=='uncertain'
    assert all(c['code']!='R1' for s in result['sources'] for c in s['candidates'])


def test_research_api_authorization_owner_isolation_and_no_key(tmp_path):
    settings=Settings(_env_file=None,research_db_path=str(tmp_path/'api.sqlite'))
    owner=['alice']
    async def workspace(request:Request):
        request.state.user_id=owner[0]
        return {'data':{'complexes':[TARGET['complex']], 'cases':[{'id':'case','complexId':'z1','status':'draft'}]}}
    app.dependency_overrides[fetch_workspace]=workspace
    app.dependency_overrides[get_settings]=lambda:settings
    client=TestClient(app)
    try:
        assert client.post('/api/cases/case/research').status_code==503
        assert client.get('/api/cases/foreign/research').status_code==404
        settings.tavily_api_key='unused-test-key'
        assert client.post('/api/cases/case/research',json={'domains':['arbitrary.example']}).status_code==422
        response=client.post('/api/cases/case/research')
        assert response.status_code==202
        assert client.post('/api/cases/case/research').json()['id']==response.json()['id']
        assert client.get('/api/cases/case/research').json()['job']['id']==response.json()['id']
        owner[0]='bob'
        assert client.get('/api/cases/case/research').json()['job'] is None
        assert client.post('/api/cases/case/research/monitor',json={'monitor_hours':6}).status_code==503
        assert client.post('/api/cases/case/research/monitor',json={'monitor_hours':0}).status_code==200
        assert client.post('/api/cases/case/research/monitor',json={'monitor_hours':1}).status_code==422
    finally:
        app.dependency_overrides.clear()
    assert client.get('/api/cases/case/research').status_code==401


def test_worker_prepares_candidates_without_browser_and_recovers_provider_failure(tmp_path, monkeypatch):
    from backend.app import research
    settings=Settings(_env_file=None,research_db_path=str(tmp_path/'worker.sqlite'),tavily_api_key='test-only')
    store=ResearchStore(settings.research_db_path)
    store.enqueue('alice','case',TARGET)
    original_client=httpx.AsyncClient
    def handler(request):
        return httpx.Response(200,json={'results':[{'url':'https://example.com/source','raw_content':RECORD,'published_date':'2026-10-20'}]})
    monkeypatch.setattr(research.httpx,'AsyncClient',lambda **kwargs: original_client(transport=httpx.MockTransport(handler),**kwargs))
    async def stop_after_one_cycle(*args):
        raise asyncio.CancelledError()
    monkeypatch.setattr(research.asyncio,'sleep',stop_after_one_cycle)
    async def run():
        try:
            await research.research_worker(settings)
        except asyncio.CancelledError:
            pass
    asyncio.run(run())
    result=ResearchStore(store.path).latest('alice','case')['job']
    assert result['status']=='succeeded'
    assert result['result']['sources'][0]['candidates'][0]['code']=='R2'
    assert result['result']['sources'][0]['engine']=='local-rules-v1'
    assert ResearchStore(store.path).latest('bob','case')['job'] is None


def test_monitor_resolver_filters_owner_and_rejects_deleted_phase():
    settings=Settings(_env_file=None,supabase_url='https://supabase.example',supabase_service_role_key='server-test-only')
    def handler(request):
        assert request.url.params['owner_id']=='eq.alice'
        return httpx.Response(200,json=[{'data':{'complexes':[TARGET['complex']], 'cases':[{'id':'case','complexId':'z1','phaseId':'deleted-phase'}]}}])
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await resolve_monitor_target(settings,'alice','case',client)
    assert asyncio.run(run()) is None
