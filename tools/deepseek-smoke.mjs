// One bounded real-provider evaluation: 12 fixed cases + one new browser input.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
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
const reportPath=`docs/acceptance/s4-repair/ai-${Date.now()}.json`;
let user;
async function save() {await mkdir('docs/acceptance/s4-repair',{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');}
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
  for(const test of (reuse>=0 ? [] : cases)) {
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
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[process.env.npm_execpath,'run','test:live','--','--grep','real external LLM'],{windowsHide:true,stdio:'inherit',env:{...process.env,SAQ_LIVE_SUPABASE_URL:config.API_URL,SAQ_LIVE_SUPABASE_KEY:config.ANON_KEY,SAQ_LIVE_EMAIL:email,SAQ_LIVE_PASSWORD:password,SAQ_LIVE_AI:'1',SAQ_LIVE_MODEL:env.LLM_MODEL}});
    child.on('error',reject);child.on('exit',code=>code===0 ? resolve() : reject(new Error(`Browser failed: ${code}`)));
  });
  const workspace=await client.from('workspaces').select('data').single(); if(workspace.error) throw new Error('BROWSER_WORKSPACE_READ_FAILED');
  const ads=workspace.data.data.ads.filter(a=>a.text.includes('ЖК Новый Берег'));
  assert.equal(ads.length,1); const ad=ads[0]; assert(ad.analysis.runId);
  const z=workspace.data.data.complexes.find(z=>z.id==='SQ-001');
  assert.equal(z.factors.find(f=>f.code==='R2').status,'confirmed'); assert.equal(z.factors.find(f=>f.code==='R3').status,'rejected');
  assert.equal(z.factors.find(f=>f.code==='R2').evidence.runId,ad.analysis.runId);
  assert.equal(z.factors.find(f=>f.code==='R3').evidence.runId,ad.analysis.runId);
  assert.equal(workspace.data.data.signals['SQ-001']?.status ?? 'draft','draft');
  assert.equal(workspace.data.data.signalVersions['SQ-001']?.length ?? 0,0,'AI review must not confirm a signal');
  const browserRun=await client.from('analysis_runs').select('id,input_hash,model,prompt_version,status,hypotheses').eq('id',ad.analysis.runId).single(); if(browserRun.error) throw new Error('BROWSER_RUN_READ_FAILED');
  report.browserRun=browserRun.data;
  report.browser='PASS';report.status='PASS';await save();console.log(`PASS real AI acceptance: ${reportPath}`);
} catch(e) {report.status='FAIL';report.error=e.message;await save();throw e;}
finally {
  if(user) {
    await client.auth.signOut();
    const removed=await admin.auth.admin.deleteUser(user.id);if(removed.error) throw new Error('Temporary AI user cleanup failed');
  }
}
