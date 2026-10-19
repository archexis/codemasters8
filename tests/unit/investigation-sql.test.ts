import { describe, it, expect } from 'vitest';
import { createTestDatabase, login, userA, userB, command } from '../helpers/database';
import { loadStateFromText } from '../../src/lib/state-migrations';

describe('investigation server command boundary', () => {
  it('keeps triage separate, freezes decisions and enforces retries, scope and owner', async () => {
    const { db } = await createTestDatabase();
    try {
      await login(db, userA);
      const init = await db.query<{ result: { data: any; version: number } }>('select public.initialize_workspace() as result');
      let state = init.rows[0].result;
      const complexId = state.data.complexes[0].id;
      const send = async (c: unknown) => { state = await command(db, c, state.version); return state.data; };
      await expect(send({ type: 'artifact.register', artifact: { id: 'bad-artifact', complexId, kind: 'document', source: 'Акт', text: 'Текст', injected: 'unknown' } })).rejects.toThrow('INVALID_PAYLOAD_KEYS');
      await expect(send({ type: 'phase.create', phase: { id: 'bad-phase', complexId, name: 'Очередь', phaseId: null } })).rejects.toThrow('INVALID_PAYLOAD_KEYS');
      await send({ type: 'phase.create', phase: { id: 'p1', complexId, name: 'Очередь 1' } });
      await send({ type: 'artifact.register', artifact: { id: 'a1', complexId, phaseId: 'p1', kind: 'document', source: 'Акт', text: 'Коллективное обращение о привлечении средств.' } });
      expect(state.data.artifacts[0].sha256).toMatch(/^[a-f0-9]{64}$/);
      await send({ type: 'case.create', id: 'c1', complexId, phaseId: 'p1' });
      await expect(send({ type: 'signal', zkId: complexId, status: 'confirmed', comment: 'Legacy bypass' })).rejects.toThrow('CASE_REVIEW_REQUIRED');
      await expect(send({ type: 'factor', zkId: complexId, code: 'R4', status: 'confirmed', evidence: { source: 'Акт', kind: 'document', date: '2026-10-19', text: 'Коллективное обращение' }, comment: 'Legacy bypass' })).rejects.toThrow('CASE_REVIEW_REQUIRED');
      await send({ type: 'claim.propose', claim: { id: 'cl1', complexId, phaseId: 'p1', artifactId: 'a1', code: 'R4', quote: 'Коллективное обращение' } });
      expect(state.data.claims[0].quoteStart).toBe(0);
      await send({ type: 'ai.review', claimId: 'cl1', decision: 'accepted', comment: 'Извлечение верно' });
      expect(state.data.assertions).toEqual([]);
      await expect(send({ type: 'case.decide', caseId: 'c1', status: 'confirmed', comment: 'Решение' })).rejects.toThrow('VERIFIED_FACT_REQUIRED');
      const review = { type: 'fact.review', caseId: 'c1', claimId: 'cl1', status: 'verified', evidence: { source: 'Акт', kind: 'document', date: '2026-10-19', text: 'Коллективное обращение о привлечении средств.' }, comment: 'Проверено' };
      await expect(send(review)).rejects.toThrow('ARTIFACT_NOT_ATTACHED');
      await send({ type: 'case.attach', caseId: 'c1', artifactId: 'a1' });
      await send(review);
      const decision = { type: 'case.decide', caseId: 'c1', status: 'confirmed', comment: 'Факт подтверждён' };
      const before = state.version;
      const call = (v: number, payload = decision) => db.query<{ result: typeof state }>('select public.apply_command($1::jsonb,$2,$3) as result', [JSON.stringify(payload), v, 'stable-decision']);
      state = (await call(before)).rows[0].result;
      expect(state.data.caseSnapshots[0]).toMatchObject({ score: 15, zone: 'green', actor: 'a@example.test' });
      expect((await call(before)).rows[0].result).toMatchObject({ version: state.version, replayed: true });
      await expect(call(state.version, { ...decision, comment: 'Изменено' })).rejects.toThrow('COMMAND_ID_REUSED');
      await expect(send(review)).rejects.toThrow('CASE_REOPEN_REQUIRED');
      const frozen = structuredClone(state.data.caseSnapshots[0]);
      await send({ type: 'case.reopen', caseId: 'c1', comment: 'Новый материал' });
      expect(state.data.caseSnapshots[0]).toEqual(frozen);
      expect(() => loadStateFromText(JSON.stringify(state.data))).not.toThrow();
      await expect(command(db, { type: 'case.attach', caseId: 'c1', artifactId: 'a1' }, before)).rejects.toThrow('STALE_VERSION');
      await login(db, userB);
      await expect(command(db, { type: 'case.reopen', caseId: 'c1', comment: 'Чужое дело' }, 0)).rejects.toThrow('CASE_NOT_FOUND');
      await expect(db.query('select public.apply_legacy_command_ux($1::jsonb,0,$2)', ['{}', 'forbidden'])).rejects.toThrow('permission denied');
    } finally { await db.close(); }
  }, 60000);

  it('stores validated geometry without changing risk and isolates document jobs with RLS', async () => {
    const { db } = await createTestDatabase();
    try {
      await login(db, userA);
      const state = (await db.query<{ result: { data: any; version: number } }>('select public.initialize_workspace() as result')).rows[0].result;
      const complexId = state.data.complexes[0].id;
      const geometry = { id: 'geometry1', complexId, source: 'GeoJSON', verified: true, coordinates: [[[76.9,43.2],[76.91,43.2],[76.91,43.21],[76.9,43.2]]], heightMeters: 50 };
      const result = await command(db, { type: 'geometry.register', geometry }, state.version);
      expect((result.data as any).geometries[0]).toEqual(geometry);
      expect(result.data.complexes).toEqual(state.data.complexes);
      await expect(command(db, { type: 'geometry.register', geometry: { ...geometry, id: 'bad', coordinates: [[[181,43],[76,43],[76,44],[181,43]]] } }, result.version)).rejects.toThrow('INVALID_GEOMETRY');
      const jobId='33333333-3333-4333-8333-333333333333';
      await db.query("insert into public.document_jobs(id,owner_id,complex_id,kind,input_path) values($1,$2,$3,'pdf-text',$4)", [jobId,userA, complexId, `${userA}/${complexId}/${jobId}.pdf`]);
      await expect(db.query("update public.document_jobs set input_path=$1 where id=$2", [`${userA}/elsewhere/other.pdf`,jobId])).rejects.toThrow('JOB_IDENTITY_IMMUTABLE');
      await expect(db.query("update public.document_jobs set status='succeeded',result='{}' where id=$1", [jobId])).rejects.toThrow('INVALID_JOB_TRANSITION');
      await db.query("update public.document_jobs set status='running' where id=$1",[jobId]);
      await expect(db.query("update public.document_jobs set status='succeeded',result='{\"status\":\"verified\"}' where id=$1", [jobId])).rejects.toThrow('JOB_RESULT_MUST_BE_CANDIDATE');
      await db.query("update public.document_jobs set status='succeeded',result='{\"status\":\"candidate\"}' where id=$1",[jobId]);
      await login(db, userB);
      expect((await db.query('select * from public.document_jobs')).rows).toEqual([]);
      await expect(db.query("insert into public.document_jobs(owner_id,complex_id,kind,input_path) values($1,$2,'pdf-text',$3)", [userA, complexId, `${userA}/${complexId}/job.pdf`])).rejects.toThrow(/row-level security|AUTH_REQUIRED/);
    } finally { await db.close(); }
  }, 60000);

  it('rejects invented quotations, foreign phase materials and R1 under an applicable guarantee atomically', async () => {
    const { db } = await createTestDatabase();
    try {
      await login(db, userA);
      let state = (await db.query<{ result: { data: any; version: number } }>('select public.initialize_workspace() as result')).rows[0].result;
      const complexId = state.data.complexes[0].id;
      const send = async (c: unknown) => { state = await command(db, c, state.version); return state.data; };
      await send({ type: 'phase.create', phase: { id: 'guaranteed', complexId, name: 'Очередь с гарантией', legalBasis: { type: 'guarantee', status: 'verified', source: 'Реестр гарантий', checkedAt: '2026-10-19', reviewText: 'Применима к очереди' } } });
      await send({ type: 'phase.create', phase: { id: 'other', complexId, name: 'Другая очередь' } });
      await send({ type: 'artifact.register', artifact: { id: 'legal', complexId, phaseId: 'guaranteed', kind: 'legal-review', source: 'Проверка', text: 'Проверены основания привлечения средств.' } });
      await send({ type: 'artifact.register', artifact: { id: 'emoji', complexId, kind: 'document', source: 'PDF', pageNumber: 3, text: '🏗️ Точная цитата' } });
      await send({ type: 'claim.propose', claim: { id: 'emoji-claim', complexId, artifactId: 'emoji', code: 'R4', quote: 'Точная цитата' } });
      expect(state.data.claims.find((c: any) => c.id === 'emoji-claim').quoteStart).toBe('🏗️ Точная цитата'.indexOf('Точная цитата'));
      const bad = { type: 'claim.propose', claim: { id: 'invented', complexId, phaseId: 'guaranteed', artifactId: 'legal', code: 'R1', quote: 'Выдуманный текст' } };
      const version = state.version;
      await expect(send(bad)).rejects.toThrow('UNGROUNDED_QUOTE');
      await send({ type: 'claim.propose', claim: { ...bad.claim, id: 'r1', quote: 'Проверены основания' } });
      expect(state.version).toBe(version + 1);
      await send({ type: 'case.create', id: 'foreign-phase', complexId, phaseId: 'other' });
      await expect(send({ type: 'case.attach', caseId: 'foreign-phase', artifactId: 'legal' })).rejects.toThrow('ARTIFACT_SCOPE_MISMATCH');
      await send({ type: 'case.create', id: 'guarantee-case', complexId, phaseId: 'guaranteed' });
      await send({ type: 'case.attach', caseId: 'guarantee-case', artifactId: 'legal' });
      const review = { type: 'fact.review', caseId: 'guarantee-case', claimId: 'r1', status: 'verified', evidence: { kind: 'legal-review', source: 'Проверка', date: '2026-10-19', text: 'Все основания проверены' }, comment: 'Подтвердить' };
      await expect(send(review)).rejects.toThrow('R1_REQUIRES_VERIFIED_ABSENCE');
      await expect(send({ ...review, evidence: { ...review.evidence, date: undefined } })).rejects.toThrow('EVIDENCE_DATE_REQUIRED');
      expect(state.data.assertions).toHaveLength(0);
      await expect(send({ ...review, actorId: userB })).rejects.toThrow('REVIEWER_FORBIDDEN');
      const raw = (await db.query<{ data: any; version: number }>('select data,version from public.workspaces')).rows[0];
      expect(raw.version).toBe(state.version);
      expect(raw.data.audit).toHaveLength(state.data.audit.length);
    } finally { await db.close(); }
  }, 60000);

  it('invalidates current R5 after readiness changes and demotes imported authority', async () => {
    const { db } = await createTestDatabase();
    try {
      await login(db, userA);
      let state = (await db.query<{ result: { data: any; version: number } }>('select public.initialize_workspace() as result')).rows[0].result;
      const send = async (c: unknown) => { state = await command(db, c, state.version); return state.data; };
      const z = structuredClone(state.data.complexes[0]);
      z.factors = []; z.readinessClaimed = 80; z.readinessConfirmed = 50;
      z.readinessClaimedSource = { value: 80, source: 'Заявление', date: '2026-10-19' };
      z.readinessSources = [{ value: 50, source: 'Акт', date: '2026-10-19' }];
      await send({ type: 'complex', complex: z });
      await send({ type: 'readiness', zkId: z.id, value: 50, source: 'Акт', date: '2026-10-19' });
      await send({ type: 'artifact.register', artifact: { id: 'readiness-artifact', complexId: z.id, kind: 'observation', source: 'Акт', date: '2026-10-19', text: 'Разрыв готовности 30 процентных пунктов' } });
      await send({ type: 'claim.propose', claim: { id: 'readiness-claim', complexId: z.id, artifactId: 'readiness-artifact', code: 'R5', quote: 'Разрыв готовности' } });
      await send({ type: 'case.create', id: 'readiness-case', complexId: z.id });
      await send({ type: 'case.attach', caseId: 'readiness-case', artifactId: 'readiness-artifact' });
      await send({ type: 'fact.review', caseId: 'readiness-case', claimId: 'readiness-claim', status: 'verified', evidence: { source: 'Акт', date: '2026-10-19', kind: 'observation', text: 'Разрыв готовности 30 п.п.' }, comment: 'Источники сверены' });
      await send({ type: 'case.decide', caseId: 'readiness-case', status: 'confirmed', comment: 'Проверено' });
      const frozen = structuredClone(state.data.caseSnapshots[0]);
      const backup = structuredClone(state.data);
      await send({ type: 'readiness', zkId: z.id, value: 40, source: 'Новый акт', date: '2026-10-19' });
      expect(state.data.assertions.at(-1).status).toBe('candidate');
      expect(state.data.cases[0].status).toBe('draft');
      expect(state.data.caseSnapshots[0]).toEqual(frozen);
      backup.media = [];
      await login(db, userB);
      const restored = (await db.query<{ result: { data: any } }>('select public.restore_workspace($1::jsonb) as result', [JSON.stringify({ manifest: { version: 1, files: [] }, workspace: backup, staged: [] })])).rows[0].result.data;
      expect(restored.assertions[0].status).toBe('candidate');
      expect(restored.cases[0]).toMatchObject({ status: 'draft', owner: 'b@example.test' });
      expect(restored.caseSnapshots[0]).toEqual({ ...frozen, imported: true });
      await expect(db.query('select public.restore_workspace($1::jsonb)', [JSON.stringify({ manifest: { version: 1, files: [] }, workspace: backup, staged: [] })])).rejects.toThrow('RESTORE_TARGET_NOT_EMPTY');
    } finally { await db.close(); }
  }, 60000);

  it('requires temporal claim and legal coverage before verifying a dated case', async () => {
    const { db } = await createTestDatabase();
    try {
      await login(db, userA);
      let state = (await db.query<{ result: { data: any; version: number } }>('select public.initialize_workspace() as result')).rows[0].result;
      const complexId = state.data.complexes[0].id;
      const send = async (c: unknown) => { state = await command(db, c, state.version); return state.data; };
      const period={from:'2026-01-01',to:'2026-12-31'};
      const phase={id:'temporal',complexId,name:'Очередь 2026',period,legalBasis:{type:'absent',status:'absent-verified',source:'Реестры',checkedAt:'2026-10-19',reviewText:'Проверены альтернативные основания',period:{from:'2026-01-01',to:'2026-03-31'}}};
      await send({type:'phase.create',phase});
      await expect(send({type:'case.create',id:'outside-period',complexId,phaseId:'temporal',period:{from:'2025-01-01'}})).rejects.toThrow('PHASE_PERIOD_MISMATCH');
      await send({type:'artifact.register',artifact:{id:'temporal-artifact',complexId,phaseId:'temporal',kind:'legal-review',source:'Реестры',text:'Отсутствие всех применимых оснований',date:'2026-10-19'}});
      await send({type:'claim.propose',claim:{id:'short-claim',complexId,phaseId:'temporal',artifactId:'temporal-artifact',code:'R1',quote:'Отсутствие всех',period:{from:'2026-01-01',to:'2026-02-01'}}});
      await send({type:'claim.propose',claim:{id:'covering-claim',complexId,phaseId:'temporal',artifactId:'temporal-artifact',code:'R1',quote:'Отсутствие всех',period}});
      await send({type:'case.create',id:'temporal-case',complexId,phaseId:'temporal',period:{from:'2026-04-01',to:'2026-06-30'}});
      await send({type:'case.attach',caseId:'temporal-case',artifactId:'temporal-artifact'});
      const review={type:'fact.review',caseId:'temporal-case',claimId:'short-claim',status:'verified',evidence:{kind:'legal-review',source:'Реестры',date:'2026-10-19',text:'Полная сверка всех оснований'},comment:'Проверка'};
      await expect(send(review)).rejects.toThrow('CLAIM_PERIOD_MISMATCH');
      await expect(send({...review,claimId:'covering-claim'})).rejects.toThrow('LEGAL_PERIOD_MISMATCH');
      await send({type:'phase.update',phase:{...phase,legalBasis:{...phase.legalBasis,period}}});
      await send({...review,claimId:'covering-claim'});
      expect(state.data.assertions[0].period).toEqual({from:'2026-04-01',to:'2026-06-30'});
      await send({type:'case.decide',caseId:'temporal-case',status:'confirmed',comment:'Проверено по периоду'});
      expect(state.data.caseSnapshots[0].period).toEqual({from:'2026-04-01',to:'2026-06-30'});
      expect(() => loadStateFromText(JSON.stringify(state.data))).not.toThrow();
    } finally { await db.close(); }
  }, 60000);

  it('verifies R5 from phase observations and invalidates only that phase when they change', async () => {
    const { db }=await createTestDatabase();
    try {
      await login(db,userA);
      let state=(await db.query<{result:{data:any;version:number}}>('select public.initialize_workspace() as result')).rows[0].result;
      const complexId=state.data.complexes[0].id;
      const send=async(c:unknown)=>{state=await command(db,c,state.version);return state.data;};
      const phase={id:'phase-r5',complexId,name:'Очередь',readinessClaimed:80,readinessClaimedSource:{value:80,source:'Заявление очереди',date:'2026-10-19'},readinessConfirmed:50,readinessSources:[{value:50,source:'Акт очереди',date:'2026-10-19'}]};
      await send({type:'phase.create',phase});
      await send({type:'artifact.register',artifact:{id:'phase-r5-source',complexId,phaseId:phase.id,kind:'observation',source:'Акт очереди',date:'2026-10-19',text:'Готовность очереди 50 процентов'}});
      await send({type:'claim.propose',claim:{id:'phase-r5-claim',complexId,phaseId:phase.id,artifactId:'phase-r5-source',code:'R5',quote:'Готовность очереди'}});
      await send({type:'case.create',id:'phase-r5-case',complexId,phaseId:phase.id});
      await send({type:'case.attach',caseId:'phase-r5-case',artifactId:'phase-r5-source'});
      await send({type:'fact.review',caseId:'phase-r5-case',claimId:'phase-r5-claim',status:'verified',evidence:{source:'Акт очереди',date:'2026-10-19',kind:'observation',text:'Подтверждено 50 процентов'},comment:'Проверено'});
      await send({type:'case.decide',caseId:'phase-r5-case',status:'confirmed',comment:'Разрыв 30 п.п.'});
      expect(state.data.caseSnapshots[0].score).toBe(10);
      await send({type:'readiness',zkId:complexId,value:25,source:'Акт всего объекта',date:'2026-10-19'});
      expect(state.data.assertions.at(-1).status).toBe('verified');
      await expect(send({type:'phase.update',phase:{...phase,readinessSources:[]}})).rejects.toThrow('READINESS_HISTORY_APPEND_ONLY');
      await send({type:'phase.update',phase:{...phase,readinessConfirmed:55,readinessSources:[...phase.readinessSources,{value:55,source:'Новый акт очереди',date:'2026-10-19'}]}});
      expect(state.data.assertions.at(-1).status).toBe('candidate');
      expect(state.data.cases[0].status).toBe('draft');
      expect(state.data.caseSnapshots[0].score).toBe(10);
      expect(()=>loadStateFromText(JSON.stringify(state.data))).not.toThrow();
    } finally {await db.close();}
  },60000);

  it('keeps typed relations contextual and requires a separate grounded human review',async()=>{
    const {db}=await createTestDatabase();
    try{
      await login(db,userA);
      let state=(await db.query<{result:{data:any;version:number}}>('select public.initialize_workspace() as result')).rows[0].result;
      const [z,other]=state.data.complexes;
      const send=async(c:unknown)=>{state=await command(db,c,state.version);return state.data;};
      await send({type:'artifact.register',artifact:{id:'relationship-document',complexId:z.id,kind:'relationship',source:'Договор',text:'Подрядчик и объект связаны договором',date:'2026-10-19'}});
      const relation={id:'relation1',complexId:z.id,fromId:`complex:${z.id}`,toId:`complex:${other.id}`,relationType:'contractor_of',sourceArtifactIds:['relationship-document'],matchMethod:'manual'};
      await send({type:'relation.register',relation});
      expect(state.data.relations[0].verificationStatus).toBe('candidate');
      const factors=structuredClone(state.data.complexes.map((c:any)=>c.factors));
      await send({type:'relation.review',relationId:relation.id,status:'verified',comment:'Сверено с договором'});
      expect(state.data.relations[0]).toMatchObject({verificationStatus:'verified',reviewedBy:'a@example.test'});
      expect(state.data.complexes.map((c:any)=>c.factors)).toEqual(factors);
      await expect(send({type:'relation.register',relation:{...relation,id:'self-edge',toId:relation.fromId}})).rejects.toThrow('INVALID_RELATION_ENDPOINT');
      await expect(send({type:'relation.register',relation:{...relation,id:'foreign-node',toId:'organization:000000000000'}})).rejects.toThrow('RELATION_ENDPOINT_NOT_FOUND');
      await send({type:'relation.register',relation:{...relation,id:'unbacked',sourceArtifactIds:[]}});
      await expect(send({type:'relation.review',relationId:'unbacked',status:'verified',comment:'Подтвердить без документа'})).rejects.toThrow('RELATION_EVIDENCE_REQUIRED');
      expect(()=>loadStateFromText(JSON.stringify(state.data))).not.toThrow();
    }finally{await db.close();}
  },60000);
});
