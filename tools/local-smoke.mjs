// Only creates and deletes its own temporary local Supabase users.
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const config = JSON.parse((await readFile('supabase/.temp/status.json','utf8')).replace(/^\uFEFF/,''));
const url = config.API_URL;
assert(url && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url),'This smoke test only accepts a LOCAL Supabase URL');
const anon = config.ANON_KEY; const adminKey = config.SERVICE_ROLE_KEY;
assert(anon && adminKey,'Run npx supabase status -o json > supabase/.temp/status.json first');
const options = {auth:{persistSession:false,autoRefreshToken:false}};
const admin = createClient(url,adminKey,options);
const users = [];
const password = `${randomUUID()}Aa9!`;
let api;
let clientA;
const checks = [];
function checked(name) { checks.push(name); console.log(`PASS ${name}`); }
function runNpm(args, env) {
  return new Promise((resolve,reject) => {
    const child = spawn(process.execPath,[process.env.npm_execpath,...args],{env:{...process.env,...env},stdio:'inherit',windowsHide:true});
    child.on('error',reject); child.on('exit',code => code===0 ? resolve() : reject(new Error(`npm exited ${code}`)));
  });
}
try {
  for (let i=0;i<2;i++) {
    const email=`saq-smoke-${randomUUID()}@example.test`;
    const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
    if (created.error) throw created.error;
    users.push(created.data.user);
  }
  clientA = createClient(url,anon,options); const clientB=createClient(url,anon,options);
  for (const [i,client] of [clientA,clientB].entries()) {
    const signed=await client.auth.signInWithPassword({email:users[i].email,password}); if(signed.error) throw signed.error;
    const initialized=await client.rpc('initialize_workspace'); if(initialized.error) throw initialized.error;
    assert.equal(initialized.data.data.complexes.length,16);
  }
  checked('actual Auth and seed migrations');
  const foreign=await clientB.from('workspaces').select('*').eq('owner_id',users[0].id);
  assert.equal(foreign.error,null); assert.equal(foreign.data.length,0);
  const denied=await clientA.from('workspaces').update({version:99}).eq('owner_id',users[0].id);
  assert(denied.error);
  checked('actual PostgreSQL RLS and direct-write denial');
  const saved=await clientA.rpc('apply_command',{command:{type:'signal',zkId:'SQ-002',status:'confirmed',comment:'Local smoke'},expected_version:1,command_id:randomUUID()});
  if(saved.error) throw saved.error;
  assert.equal(saved.data.version,2);
  const stale=await clientA.rpc('apply_command',{command:{type:'signal',zkId:'SQ-002',status:'returned',comment:'stale'},expected_version:1,command_id:randomUUID()});
  assert(stale.error?.message.includes('STALE_VERSION'));
  checked('actual transactional commands and stale-version guard');
  const path=`${users[0].id}/SQ-002/smoke.png`;
  const blob=new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')],{type:'image/png'});
  const uploaded=await clientA.storage.from('evidence').upload(path,blob);
  if(uploaded.error) throw uploaded.error;
  const signed=await clientA.storage.from('evidence').createSignedUrl(path,60); if(signed.error) throw signed.error;
  assert.equal((await fetch(signed.data.signedUrl)).status,200);
  const forbidden=await clientB.storage.from('evidence').createSignedUrl(path,60);
  assert(forbidden.error);
  checked('actual Storage upload, signed URL and cross-user denial');
  api=spawn(process.platform==='win32'?'backend/.venv/Scripts/python.exe':'backend/.venv/bin/python',['-m','uvicorn','backend.app.main:app','--host','127.0.0.1','--port','8005'],{env:{...process.env,SUPABASE_URL:url,SUPABASE_ANON_KEY:anon},stdio:'ignore',windowsHide:true});
  api.on('error',e=>console.error(e.message));
  let healthy=false;
  for(let i=0;i<60;i++) { try { healthy=(await fetch('http://127.0.0.1:8005/health')).ok; if(healthy) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
  assert(healthy,'API did not start');
  const session=await clientA.auth.getSession();
  const summary=await fetch('http://127.0.0.1:8005/api/summary',{headers:{Authorization:`Bearer ${session.data.session.access_token}`}});
  assert.equal(summary.status,200); assert.equal((await summary.json()).complexes,16);
  assert.equal((await fetch('http://127.0.0.1:8005/api/summary',{headers:{Authorization:'Bearer invalid'}})).status,401);
  checked('actual FastAPI → Supabase JWT validation → RLS data');
  const edgeUnauth = await fetch(`${url}/functions/v1/analyze`,{method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},body:'{}'});
  assert.equal(edgeUnauth.status,401);
  checked('actual Edge runtime rejects unauthenticated requests; external LLM tests run separately');
  await runNpm(['run','test:live','--','--grep-invert','real external LLM'],{SAQ_LIVE_SUPABASE_URL:url,SAQ_LIVE_SUPABASE_KEY:anon,SAQ_LIVE_EMAIL:users[0].email,SAQ_LIVE_PASSWORD:password,SAQ_LIVE_SERVICE_KEY:adminKey});
  checked('actual browser login, Storage, RPC and reload');
  await writeFile('supabase/.temp/live-test-report.json',JSON.stringify({passed:checks,date:new Date().toISOString()},null,2));
} finally {
  api?.kill();
  if(clientA && users[0]) {
    const listing=await clientA.storage.from('evidence').list(`${users[0].id}/SQ-002`);
    if(listing.data?.length) await clientA.storage.from('evidence').remove(listing.data.map(file=>`${users[0].id}/SQ-002/${file.name}`));
  }
  for(const user of users) { const removed=await admin.auth.admin.deleteUser(user.id); if(removed.error) console.error('Temporary user cleanup failed:',removed.error.message); }
}
