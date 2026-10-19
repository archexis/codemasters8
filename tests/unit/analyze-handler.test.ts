import { expect, it } from 'vitest';
import { handleAnalyze } from '../../supabase/functions/analyze/index';
import transportCases from '../fixtures/contracts/ai-transport.json';

const input = { text: 'Депозит обязателен', zkId: 'SQ-001', url: '', account: '', date: null, platform: '' };
function fixture() {
  const rows = new Map<string, any>(); let calls = 0; let quota = 0;
  const env: Record<string,string> = { SUPABASE_URL:'http://db', SUPABASE_ANON_KEY:'anon', SUPABASE_SERVICE_ROLE_KEY:'writer', LLM_API_KEY:'provider', LLM_MODEL:'model' };
  const state = { rows, env, valid: true, owns: true, quotaError: '', provider: { hypotheses:[{code:'R2',quote:'Депозит',reason:'Оплата'}] } as any, rawContent:undefined as string|undefined, failWrite:false, providerStatus:200 };
  const transport: typeof fetch = async (url, init) => {
    const path = String(url); const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (path.includes('/auth/')) return Response.json(state.valid ? {id:'owner'} : {}, {status:state.valid ? 200 : 401});
    if (path.includes('/workspaces')) return Response.json([{data:{complexes:state.owns ? [{id:'SQ-001'}] : []}}]);
    if (path.includes('/analysis_runs')) {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer writer');
      if (init?.method === 'POST') { if(rows.has(body.id)) return Response.json({code:'23505'},{status:409}); rows.set(body.id,body); return Response.json([body],{status:201}); }
      const id = new URL(path).searchParams.get('id')!.slice(3);
      if (init?.method === 'PATCH') { if(state.failWrite) return Response.json({},{status:500}); Object.assign(rows.get(id),body); return Response.json([rows.get(id)]); }
      return Response.json(rows.has(id) ? [rows.get(id)] : []);
    }
    if (path.includes('/consume_ai_quota')) { quota++; return Response.json(state.quotaError ? {message:state.quotaError} : null,{status:state.quotaError ? 500 : 200}); }
    calls++; return Response.json({choices:[{message:{content:state.rawContent ?? JSON.stringify(state.provider)}}]},{status:state.providerStatus});
  };
  const run = (body: any = {runId:'run-1',input}) => handleAnalyze(new Request('http://edge',{method:'POST',headers:{authorization:'Bearer user'},body:JSON.stringify(body)}), k=>env[k], transport);
  return {state,run, counts:()=>({calls,quota})};
}
it('working handler persists a trusted run and replays without quota/provider', async()=>{
  const f=fixture(); const r=await f.run(); expect(r.status).toBe(200);
  const result=await r.json(); expect(result.runId).toBe('run-1'); expect(result.hypotheses[0].id).toBe('run-1-h1');
  expect(f.state.rows.get('run-1')).toMatchObject({owner_id:'owner',status:'succeeded',input_snapshot:input});
  expect(f.state.rows.get('run-1').input_hash).toMatch(/^[a-f0-9]{64}$/);
  expect((await f.run()).status).toBe(200); expect(f.counts()).toEqual({calls:1,quota:1});
  expect((await f.run({runId:'run-1',input:{...input,url:'https://changed'}})).status).toBe(409);
  const attachment={name:'proof.png',size:12,type:'image/png',lastModified:0};
  expect((await f.run({runId:'file-run',input:{...input,attachments:[attachment]}})).status).toBe(200);
  expect((await f.run({input:{...input,attachments:[{lastModified:0,type:'image/png',size:12,name:'proof.png'}]},runId:'file-run'})).status).toBe(200);
  expect(f.counts()).toEqual({calls:2,quota:2});
});
it('rejects missing auth, foreign zk, forged owner and missing writer before inference',async()=>{
  const f=fixture(); f.state.valid=false; expect((await f.run()).status).toBe(401);
  f.state.valid=true; f.state.owns=false; expect((await f.run()).status).toBe(403);
  f.state.owns=true; expect((await f.run({runId:'x',input,owner_id:'forged'})).status).toBe(422);
  delete f.state.env.SUPABASE_SERVICE_ROLE_KEY; expect((await f.run()).status).toBe(503); expect(f.counts().calls).toBe(0);
});
for(const bad of [{hypotheses:[{code:'R1',quote:'Депозит',reason:'x'}]}, {hypotheses:[{code:'R2',quote:' ',reason:'x'}]}, {hypotheses:[{code:'R2',quote:'выдумка',reason:'x'}]}, {hypotheses:[] as any[]}]) {
  if (!bad.hypotheses.length) bad.hypotheses=Array(7).fill({code:'R2',quote:'Депозит',reason:'x'});
  it(`rejects provider data ${JSON.stringify(bad).slice(0,90)}`,async()=>{ const f=fixture(); f.state.provider=bad; expect((await f.run()).status).toBe(502); expect(f.state.rows.get('run-1').status).toBe('failed'); expect((await f.run()).status).toBe(409); expect(f.counts().calls).toBe(1); });
}
it('distinguishes quota exhaustion from quota DB failure',async()=>{
  for(const [message,status] of [['RATE_LIMIT',429],['connection failed',503]] as const) { const f=fixture(); f.state.quotaError=message; expect((await f.run()).status).toBe(status); expect(f.counts().calls).toBe(0); }
});
it('never returns success if final journal write fails; pending retry never calls provider',async()=>{const f=fixture(); f.state.failWrite=true; expect((await f.run()).status).toBe(503); expect((await f.run()).status).toBe(409); expect(f.counts().calls).toBe(1);});
it('missing model, invalid input, provider failure and malformed response are distinct failures',async()=>{
  const missing=fixture(); delete missing.state.env.LLM_MODEL; expect((await missing.run()).status).toBe(503); expect(missing.counts().calls).toBe(0);
  for(const value of ['', 'я'.repeat(20001)]) {const f=fixture(); expect((await f.run({runId:'run',input:{...input,text:value}})).status).toBe(422); expect(f.counts().calls).toBe(0);}
  for(const bad of [{hypotheses:[{code:'R2',reason:'missing quote'}]},'malformed schema']) {const f=fixture();f.state.provider=bad;expect((await f.run()).status).toBe(502);expect(f.state.rows.get('run-1').status).toBe('failed');}
  const f=fixture();f.state.providerStatus=500;expect((await f.run()).status).toBe(502);expect(f.state.rows.get('run-1').error_code).toBe('PROVIDER_UNAVAILABLE');
});
it('simultaneous identical run IDs claim the pending row once',async()=>{const f=fixture(); const responses=await Promise.all([f.run(),f.run()]);expect(responses.map(r=>r.status)).toContain(200);expect(f.counts()).toEqual({calls:1,quota:1});});
for(const c of transportCases) it(`transport fixture ${c.id} persists failed run`,async()=>{const f=fixture();if(c.provider)f.state.provider=c.provider;f.state.rawContent=c.rawContent;expect((await f.run()).status).toBe(c.http);expect(f.state.rows.get('run-1').status).toBe(c.runStatus);});
