import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID,createHmac } from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';

test('S6 actual Auth/RPC/Storage/API/Edge negative matrix', async () => {
  const url=process.env.SAQ_LIVE_SUPABASE_URL!, key=process.env.SAQ_LIVE_SUPABASE_KEY!;
  expect(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)).toBe(true);
  const opts={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(url,process.env.SAQ_LIVE_SERVICE_KEY!,opts), anon=createClient(url,key,opts);
  const ids:string[]=[], paths:string[]=[];
  const password=randomUUID()+'Aa9!';
  try {
    const clients=[];
    for(let n=0;n<2;n++) {
      const email=`s6-${randomUUID()}@example.test`;
      const u=await admin.auth.admin.createUser({email,password,email_confirm:true}); expect(u.error).toBeNull(); ids.push(u.data.user!.id);
      const c=createClient(url,key,opts); expect((await c.auth.signInWithPassword({email,password})).error).toBeNull(); clients.push(c);
      expect((await c.rpc('initialize_workspace')).error).toBeNull();
    }
    const [a,b]=clients;
    const cmd={type:'signal',zkId:'SQ-002',status:'confirmed',comment:'S6 security'};
    const apply=(c:typeof a,command:object)=>c.rpc('apply_command',{command,expected_version:1,command_id:randomUUID()});
    expect((await anon.rpc('initialize_workspace')).error).not.toBeNull();
    expect((await apply(anon,cmd)).error).not.toBeNull();
    expect((await anon.from('workspaces').select('*')).data ?? []).toEqual([]);
    expect((await b.from('workspaces').select('*').eq('owner_id',ids[0])).data).toEqual([]);
    expect((await a.from('workspaces').update({version:100}).eq('owner_id',ids[0])).error).not.toBeNull();
    expect((await a.from('workspaces').update({data:{audit:[]},owner_id:ids[1]}).eq('owner_id',ids[0])).error).not.toBeNull();
    expect((await a.rpc('apply_command',{command:cmd,expected_version:1})).error).not.toBeNull();
    expect((await apply(a,{...cmd,reviewer:ids[1]})).error).not.toBeNull();
    // Extra actor/time fields cannot become server attribution even if ignored.
    const commandId=randomUUID(), before=Date.now();
    const saved=await a.rpc('apply_command',{command:{...cmd,actorId:ids[1],at:'1999-01-01T00:00:00Z'},expected_version:1,command_id:commandId}); expect(saved.error).toBeNull();
    const event=saved.data.data.audit.find((e:any)=>e.commandId===commandId);expect(event).toBeTruthy();
    expect(event.reviewer).toBe((await a.auth.getUser()).data.user!.email); expect(Date.parse(event.at)).toBeGreaterThanOrEqual(before-1000);expect(Date.parse(event.at)).toBeLessThanOrEqual(Date.now()+1000);
    const mediaId='m-'+randomUUID(), path=`${ids[0]}/SQ-002/${mediaId}.png`; paths.push(path);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
    expect((await a.storage.from('evidence').upload(path,png,{contentType:'image/png'})).error).toBeNull();
    for(const c of [anon,b]) expect((await c.storage.from('evidence').download(path)).error).not.toBeNull();
    expect((await b.storage.from('evidence').upload(`${ids[0]}/SQ-002/foreign.png`,png,{contentType:'image/png'})).error).not.toBeNull();
    expect((await a.storage.from('evidence').upload(`${ids[0]}/SQ-002/bad.html`,new Blob(['<script>'],{type:'text/html'}))).error).not.toBeNull();
    expect((await a.storage.from('evidence').upload(`${ids[0]}/SQ-002/large.pdf`,new Uint8Array(20*1024*1024+1),{contentType:'application/pdf'})).error).not.toBeNull();
    const media={id:mediaId,zkId:'SQ-002',path,name:'S6.png',kind:'image/png',date:'2026-10-18',note:'S6',ready:null};
    const attached=await a.rpc('apply_command',{command:{type:'media',media},expected_version:2,command_id:randomUUID()}); expect(attached.error).toBeNull();
    const r2=attached.data.data.complexes.find((z:any)=>z.id==='SQ-002').factors.find((f:any)=>f.code==='R2');
    const factor=await a.rpc('apply_command',{command:{type:'factor',zkId:'SQ-002',code:'R2',status:'confirmed',evidence:{...r2.evidence,mediaIds:[mediaId]},comment:'S6 attached evidence'},expected_version:3,command_id:randomUUID()});expect(factor.error).toBeNull();
    const signal=await a.rpc('apply_command',{command:{...cmd,status:'returned',comment:'S6 snapshot reference'},expected_version:4,command_id:randomUUID()}); expect(signal.error).toBeNull();
    expect(signal.data.data.signalVersions['SQ-002'].at(-1).mediaManifest).toContainEqual(expect.objectContaining({id:mediaId,path}));
    expect((await apply(b,{type:'media',media})).error).not.toBeNull();
    const privateId='S6-'+randomUUID().slice(0,8);
    const privateComplex={...signal.data.data.complexes[0],id:privateId,name:'Synthetic S6 private case',factors:[],origin:'manual'};
    expect((await a.rpc('apply_command',{command:{type:'complex',complex:privateComplex},expected_version:5,command_id:randomUUID()})).error).toBeNull();
    for(const unsafe of ['javascript:alert(1)','data:text/html,<script>alert(1)</script>']) {
      const ad={...signal.data.data.ads[0],id:'S6-'+randomUUID().slice(0,8),zkId:'SQ-002',text:'S6 unsafe link '+randomUUID(),url:unsafe};
      expect((await a.rpc('apply_command',{command:{type:'ad',ad,decision:'saved',comment:'S6 unsafe URL'},expected_version:6,command_id:randomUUID()})).error).not.toBeNull();
    }
    await a.storage.from('evidence').remove([path]); expect((await a.storage.from('evidence').download(path)).error).toBeNull();
    const staged=`${ids[0]}/SQ-002/staged.png`; paths.push(staged);
    expect((await a.storage.from('evidence').upload(staged,png,{contentType:'image/png'})).error).toBeNull();
    expect((await a.storage.from('evidence').remove([staged])).error).toBeNull(); expect((await a.storage.from('evidence').download(staged)).error).not.toBeNull();
    const token=(await a.auth.getSession()).data.session!.access_token;
    const edge=(body:object,jwt=token)=>fetch(`${url}/functions/v1/analyze`,{method:'POST',headers:{apikey:key,authorization:`Bearer ${jwt}`,'content-type':'application/json'},body:JSON.stringify(body)});
    const input={text:'S6 negative request',zkId:'SQ-002',url:'',account:'',platform:'',date:null};
    expect((await edge({},'invalid')).status).toBe(401);
    const config=JSON.parse(readFileSync('supabase/.temp/status.json','utf8').replace(/^\uFEFF/,''));
    const parts=token.split('.'),claims=JSON.parse(Buffer.from(parts[1],'base64url').toString());
    expect(typeof config.JWT_SECRET).toBe('string');
    const expiredBody=Buffer.from(JSON.stringify({...claims,exp:Math.floor(Date.now()/1000)-60})).toString('base64url');
    const prefix=parts[0]+'.'+expiredBody;
    const expired=prefix+'.'+createHmac('sha256',config.JWT_SECRET).update(prefix).digest('base64url');
    expect((await edge({},expired)).status).toBe(401);
    expect((await fetch('http://127.0.0.1:8005/api/export',{headers:{authorization:'Bearer '+expired}})).status).toBe(401);
    expect((await fetch(`${url}/rest/v1/rpc/apply_command`,{method:'POST',headers:{apikey:key,authorization:'Bearer '+expired,'content-type':'application/json'},body:'{}'})).status).toBe(401);
    expect((await fetch(`${url}/functions/v1/analyze`,{method:'POST',headers:{apikey:key},body:'{}'})).status).toBe(401);
    expect((await edge({runId:randomUUID(),input:{...input,zkId:'A-PRIVATE-ONLY'}})).status).toBe(403);
    const bToken=(await b.auth.getSession()).data.session!.access_token;
    expect((await edge({runId:randomUUID(),input:{...input,zkId:privateId}},bToken)).status).toBe(403);
    expect((await edge({runId:randomUUID(),input:{...input,text:'я'.repeat(20001)}})).status).toBe(422);
    expect((await edge({runId:randomUUID(),input:{...input,text:'я'.repeat(60000)}})).status).toBe(413);
    // Consume only the temporary user's quota: no provider request is made.
    for(let n=0;n<30;n++) expect((await a.rpc('consume_ai_quota')).error).toBeNull();
    const quotaRun=randomUUID();const exhausted=await edge({runId:quotaRun,input}); expect(exhausted.status).toBe(429); expect((await exhausted.json()).error_code).toBe('QUOTA_EXCEEDED');
    for(const headers of [new Headers(),new Headers({authorization:'Bearer invalid'})]) {
      expect((await fetch('http://127.0.0.1:8005/api/export',{headers})).status).toBe(401);
      expect((await fetch(`${url}/rest/v1/workspaces`,{headers:{apikey:key,authorization:'Bearer invalid'}})).status).toBe(401);
    }
    // Foreign run IDs reveal no rows even when the global ID is known.
    expect((await b.from('analysis_runs').select('*').eq('owner_id',ids[0])).data).toEqual([]);
    expect((await b.from('analysis_runs').select('*').eq('id',quotaRun)).data).toEqual([]);
    expect((await b.from('command_receipts').select('*').eq('owner_id',ids[0])).data ?? []).toEqual([]);
  } finally {
    if(paths.length) await admin.storage.from('evidence').remove(paths);
    for(const id of ids) expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();
  }
});

test('S6 browser offline/expired save preserves form; no server secrets in storage/network',async({page,context})=>{
 const cfg=JSON.parse(readFileSync('supabase/.temp/status.json','utf8').replace(/^\uFEFF/,''));
 const needles=[cfg.SERVICE_ROLE_KEY];
 for(const p of ['.env.edge','.temp/s4-repair/edge.env']) {try{const m=readFileSync(p,'utf8').match(/^LLM_API_KEY=(.+)$/m);if(m)needles.push(m[1].trim().replace(/^['"]|['"]$/g,''));}catch{}}
 const findings:{type:string;present:boolean}[]=[];let requests=0;
 page.on('request',r=>{requests++; const text=JSON.stringify(r.headers())+(r.postData()??'')+r.url();if(needles.some(s=>s&&text.includes(s)))findings.push({type:'request/server secret',present:true});});
 await page.goto('/'); await page.getByRole('button',{name:'Демо-аналитик',exact:true}).click();
 await page.getByLabel('Email',{exact:true}).fill(process.env.SAQ_LIVE_EMAIL!); await page.getByLabel('Пароль',{exact:true}).fill(process.env.SAQ_LIVE_PASSWORD!);
 await page.getByRole('button',{name:'Войти',exact:true}).last().click(); await expect(page.getByRole('button',{name:process.env.SAQ_LIVE_EMAIL!,exact:true})).toBeVisible();
 await page.goto('/#/detail/SQ-002');
 const value=page.getByLabel('Подтверждённая готовность, %'),source=page.getByLabel('Источник наблюдения');await value.fill('17');await source.fill('S6 offline observation');
 await page.evaluate(async()=>{const path='/src/lib/supabase.ts';const {supabase}=await import(/* @vite-ignore */ path);const r=await supabase.auth.refreshSession();if(r.error)throw r.error;});
 await expect(value).toHaveValue('17');await expect(source).toHaveValue('S6 offline observation');
 await context.setOffline(true); await page.getByRole('button',{name:'Зафиксировать готовность'}).click(); await expect(page.getByRole('alert')).toBeVisible();
 await expect(value).toHaveValue('17');await expect(source).toHaveValue('S6 offline observation');await context.setOffline(false);
 await page.route('**/rest/v1/rpc/apply_command',r=>r.fulfill({status:401,contentType:'application/json',body:JSON.stringify({message:'JWT expired',code:'PGRST303'})}));
 await page.getByRole('button',{name:'Зафиксировать готовность'}).click();await expect(page.getByRole('alert')).toContainText('JWT expired'); await expect(value).toHaveValue('17'); await expect(source).toHaveValue('S6 offline observation');
 const storage=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));
 if(needles.some(s=>s&&storage.includes(s)))findings.push({type:'browser storage/server secret',present:true});
 writeFileSync('docs/acceptance/s6/browser-secrets.json',JSON.stringify({status:findings.length?'FAIL':'PASS',requests,scope:'request URL/headers/body + localStorage/sessionStorage after real connected login and failed saves',findings},null,2)+'\n');
 expect(findings).toEqual([]);
});

test('S6 real A logout/B login discards an in-flight A workspace response',async({page})=>{
 const url=process.env.SAQ_LIVE_SUPABASE_URL!,key=process.env.SAQ_LIVE_SUPABASE_KEY!;
 const admin=createClient(url,process.env.SAQ_LIVE_SERVICE_KEY!,{auth:{persistSession:false}});
 const users:{id:string;email:string}[]=[],password=randomUUID()+'Aa9!';
 let release!:()=>void;const held=new Promise<void>(r=>{release=r;});let captured=false;
 try {
  for(let n=0;n<2;n++) {const email=`s6-session-${randomUUID()}@example.test`;const r=await admin.auth.admin.createUser({email,password,email_confirm:true});expect(r.error).toBeNull();users.push({id:r.data.user!.id,email});
   const c=createClient(url,key,{auth:{persistSession:false}});expect((await c.auth.signInWithPassword({email,password})).error).toBeNull();const w=await c.rpc('initialize_workspace');expect(w.error).toBeNull();
   if(n===0){const complex={...w.data.data.complexes[0],id:'S6-PRIVATE',name:'S6 A private case',origin:'manual',factors:[]};expect((await c.rpc('apply_command',{command:{type:'complex',complex},expected_version:1,command_id:randomUUID()})).error).toBeNull();}
  }
  await page.goto('/#/overview');await expect(page.locator('tbody tr')).toHaveCount(16);
  await page.evaluate(async({email,password})=>{const path='/src/lib/supabase.ts';const {supabase}=await import(/* @vite-ignore */path);const r=await supabase.auth.signInWithPassword({email,password});if(r.error)throw r.error;},{email:users[0].email,password});
  await expect(page.getByText('S6 A private case',{exact:true})).toBeVisible();
  await page.route('**/rest/v1/workspaces?*',async route=>{
   if(new URL(route.request().url()).searchParams.get('owner_id')==='eq.'+users[0].id&&!captured){const response=await route.fetch();captured=true;await held;await route.fulfill({response});}else await route.continue();
  });
  await page.evaluate(async()=>{const path='/src/lib/repository.ts';const repo=await import(/* @vite-ignore */path);void repo.loadState().then(()=>(window as any).__s6late='LEAK').catch((e:Error)=>(window as any).__s6late=e.name);});
  await expect.poll(()=>captured).toBe(true);
  await page.evaluate(async({email,password})=>{const path='/src/lib/supabase.ts';const {supabase}=await import(/* @vite-ignore */path);await supabase.auth.signOut();const r=await supabase.auth.signInWithPassword({email,password});if(r.error)throw r.error;},{email:users[1].email,password});
  await expect(page.getByRole('button',{name:users[1].email,exact:true})).toBeVisible();await expect(page.locator('tbody tr')).toHaveCount(16);
  release();await expect.poll(()=>page.evaluate(()=>(window as any).__s6late)).toBe('SessionSupersededError');
  await expect(page.getByText('S6 A private case',{exact:true})).toHaveCount(0);
 }finally{release();for(const u of users)expect((await admin.auth.admin.deleteUser(u.id)).error).toBeNull();}
});
