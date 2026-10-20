// Bounded real-provider acceptance: optionally skip the historical eval suite.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
const browserOnly=process.argv.includes('--browser-only');
assert(process.env.SAQ_ALLOW_PAID_AI==='1','Explicit opt-in required for real provider calls');
const config=JSON.parse((await readFile('supabase/.temp/status.json','utf8')).replace(/^\uFEFF/,''));
assert(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(config.API_URL),'Only local test users');
const env=Object.fromEntries((await readFile('.env.edge','utf8')).split(/\r?\n/).filter(s=>s && !s.startsWith('#')).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
assert(env.LLM_API_KEY && env.LLM_MODEL && config.SERVICE_ROLE_KEY,'Provider/model/server writer preflight');
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(config.API_URL,config.SERVICE_ROLE_KEY,options), client=createClient(config.API_URL,config.ANON_KEY,options);
const password=`${randomUUID()}Aa9!`,email=`deepseek-test-${randomUUID()}@example.test`;
const cases=JSON.parse(await readFile('tests/fixtures/contracts/ai-eval.json','utf8'));
assert.equal(cases.length,12);
const report={date:new Date().toISOString(),model:env.LLM_MODEL,transport:'Auth → working analyze Edge → provider → server journal',cases:[],browser:'NOT_RUN',status:'IN_PROGRESS'};
const reuse=process.argv.indexOf('--reuse-eval');
if(reuse>=0) {
  const path=process.argv[reuse+1]; assert(/^docs\/acceptance\/s4-repair\/ai-\d+\.json$/.test(path),'Use a preserved local evaluation report');
  const prior=JSON.parse(await readFile(path,'utf8'));
  assert.equal(prior.cases.length,12);assert.equal(prior.model,env.LLM_MODEL);
  assert(prior.cases.every(c=>c.status==='PASS' && c.promptVersion==='s4-r2r3-v3'));
  report.cases=prior.cases;report.previousEvalReport=path;
}
const reportPath=`test-results/score-maxxing/ai-${Date.now()}.json`;
let user,api;
const cleanupErrors = [];
async function save() {await mkdir('test-results/score-maxxing',{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');}
try {
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true}); if(created.error) throw created.error; user=created.data.user;
  const signed=await client.auth.signInWithPassword({email,password}); if(signed.error) throw signed.error;
  const init=await client.rpc('initialize_workspace'); if(init.error) throw init.error;
  const denied=await client.from('analysis_runs').insert({id:'forged',owner_id:user.id}); assert(denied.error,'Client DML must be denied');
  // Kong answers OPTIONS itself with '*'; check the application's POST allowlist before paying.
  const cors=await fetch(`${config.API_URL}/functions/v1/analyze`,{method:'POST',headers:{Origin:'http://127.0.0.1:5175',apikey:config.ANON_KEY},body:'{}'});
  assert.equal(cors.status,401,'Configure local Edge ALLOWED_ORIGIN for the live browser before inference');
  assert.equal((await cors.json()).error_code,'AUTH_REQUIRED');
  const foreignOrigin=await fetch(`${config.API_URL}/functions/v1/analyze`,{method:'POST',headers:{Origin:'https://forbidden.test',apikey:config.ANON_KEY},body:'{}'});
  assert.equal(foreignOrigin.status,403);assert.equal((await foreignOrigin.json()).error_code,'ORIGIN_FORBIDDEN');
  let failures=0;
  for(const test of (reuse>=0 || browserOnly ? [] : cases)) {
    const runId=randomUUID(),start=Date.now();
    const input={text:test.text,zkId:'SQ-001',url:'',account:'',date:null,platform:'Ручной ввод'};
    const result={id:test.id,runId,expected:test.expected,status:'FAIL'};
    try {
      const {data,error}=await client.functions.invoke('analyze',{body:{runId,input},signal:AbortSignal.timeout(45000)});
      if(error) {const e=error.context instanceof Response ? await error.context.json().catch(()=>({})) : {};throw new Error(e.error_code || 'EDGE_REQUEST_FAILED');}
      Object.assign(result,{model:data.engine,promptVersion:data.prompt_version,inputHash:data.inputHash,runStatus:data.status,actual:[...new Set(data.hypotheses.map(h=>h.code))].sort(),hypotheses:data.hypotheses});
      assert.equal(data.realAI,true);assert.equal(data.status,'succeeded');assert.equal(data.engine,env.LLM_MODEL);
      assert(data.hypotheses.every(h=>h.id && ['R2','R3'].includes(h.code) && h.quote.trim() && test.text.includes(h.quote)));
      assert.deepEqual(result.actual,[...test.expected].sort());
      assert.equal(data.inputHash,createHash('sha256').update(JSON.stringify(input)).digest('hex'));
      const row=await client.from('analysis_runs').select('*').eq('id',runId).single(); if(row.error) throw new Error('RUN_READ_FAILED');
      assert.equal(row.data.status,'succeeded');assert.deepEqual(row.data.input_snapshot,input);assert.deepEqual(row.data.hypotheses,data.hypotheses);
      const replay=await client.functions.invoke('analyze',{body:{runId,input}}); assert.equal(replay.error,null);assert.equal(replay.data.replayed,true);
      result.status='PASS';
    } catch(e) {result.error=e.message;failures++;}
    result.latencyMs=Date.now()-start;report.cases.push(result);await save();console.log(`${result.status} ${test.id} (${result.latencyMs}ms)`);
  }
  assert.equal(failures,0,`${failures} eval cases failed; preserved ${reportPath}`);
  if(browserOnly) {
    api=spawn(process.platform==='win32'?'backend/.venv/Scripts/python.exe':'backend/.venv/bin/python',['-m','uvicorn','backend.app.main:app','--host','127.0.0.1','--port','8007'],{env:{...process.env,SUPABASE_URL:config.API_URL,SUPABASE_ANON_KEY:config.ANON_KEY,CORS_ORIGINS:'http://127.0.0.1:5175'},stdio:'ignore',windowsHide:true});
    let healthy=false;
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){try{healthy=(await fetch('http://127.0.0.1:8007/health',{signal:AbortSignal.timeout(1000)})).ok;if(healthy)break;}catch{/* not up yet — retry */}await new Promise(r=>setTimeout(r,200));}
    assert(healthy,'Isolated acceptance API did not start');
  }
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[process.env.npm_execpath,'run','test:live','--','--grep','real external LLM','--output=test-results/connected-ai-current'],{windowsHide:true,stdio:'inherit',env:{...process.env,SAQ_LIVE_SUPABASE_URL:config.API_URL,SAQ_LIVE_SUPABASE_KEY:config.ANON_KEY,SAQ_LIVE_EMAIL:email,SAQ_LIVE_PASSWORD:password,SAQ_LIVE_AI:'1',SAQ_LIVE_MODEL:env.LLM_MODEL,...(browserOnly?{SAQ_LIVE_API_URL:'http://127.0.0.1:8007'}:{})}});
    child.on('error',reject);child.on('exit',code=>code===0 ? resolve() : reject(new Error(`Browser failed: ${code}`)));
  });
  const workspace=await client.from('workspaces').select('data').single(); if(workspace.error) throw new Error('BROWSER_WORKSPACE_READ_FAILED');
  const ads=workspace.data.data.ads.filter(a=>a.text.includes('Проверка полного пути '));
  assert.equal(ads.length,1); const ad=ads[0]; assert(ad.analysis.runId);
  const state=workspace.data.data;
  const artifact=state.artifacts.find(a=>a.adId===ad.id);
  const claims=state.claims.filter(c=>c.artifactId===artifact.id);
  const r2=claims.find(c=>c.code==='R2'),r3=claims.find(c=>c.code==='R3');
  assert.equal(r2.triage,'accepted');assert.equal(r3.triage,'rejected');
  const assertions=state.assertions.filter(a=>state.claims.some(c=>c.id===a.claimId&&c.artifactId===artifact.id&&c.code==='R2'));
  assert.equal(assertions[0].status,'verified');assert.equal(assertions.at(-1).status,'rejected');
  const checkedClaim=state.claims.find(c=>c.id===assertions[0].claimId);
  assert.equal(assertions[0].evidence.runId,checkedClaim.runId);
  const snapshots=state.caseSnapshots.filter(s=>s.caseId===assertions[0].caseId);
  assert.equal(snapshots[0].score,25);assert.equal(snapshots[0].status,'confirmed');
  assert.equal(snapshots.at(-1).status,'returned');assert.equal(snapshots.at(-1).score,0);
  report.caseId=assertions[0].caseId;report.claimIds=claims.map(c=>c.id);report.snapshotIds=snapshots.map(s=>s.id);
  const browserRun=await client.from('analysis_runs').select('id,input_hash,model,prompt_version,status,hypotheses').eq('id',ad.analysis.runId).single(); if(browserRun.error) throw new Error('BROWSER_RUN_READ_FAILED');
  report.browserRun=browserRun.data;
  const runs=await client.from('analysis_runs').select('id,input_hash,model,prompt_version,status,hypotheses,started_at,finished_at');if(runs.error)throw runs.error;
  report.currentRuns=runs.data;
  if(browserOnly)assert.equal(runs.data.length,2,'Expected exactly two current runs: analysis and case preparation');
  report.browser='PASS';report.status=browserOnly?'CURRENT_BROWSER_PASS':reuse>=0?'BROWSER_PASS_ARCHIVED_EVAL':'PASS';await save();console.log(`PASS real AI acceptance: ${reportPath}`);
} catch(e) {report.status='FAIL';report.error=e.message;await save();throw e;}
finally {
  api?.kill();
  // Cleanup errors are collected, not thrown inline: a throw inside finally
  // would mask the original try/catch error (no-unsafe-finally). The first
  // one is rethrown after the block below.
  if(user) {
    const files=await admin.storage.from('evidence').list(`${user.id}/SQ-001`);
    if(files.error)cleanupErrors.push(files.error);
    if(files.data?.length){const cleanup=await admin.storage.from('evidence').remove(files.data.map(f=>`${user.id}/SQ-001/${f.name}`));if(cleanup.error)cleanupErrors.push(cleanup.error);}
    await client.auth.signOut();
    const removed=await admin.auth.admin.deleteUser(user.id);if(removed.error) cleanupErrors.push(new Error('Temporary AI user cleanup failed'));
  }
}
if(cleanupErrors.length)throw cleanupErrors[0];
