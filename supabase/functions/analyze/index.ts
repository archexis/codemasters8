import { handleProxy, resolveEnv, sha256Hex } from '../analyze-proxy/index.ts';
type GetEnv = (key: string) => string | undefined;
type Attachment={name:string;size:number;type:string;lastModified:number};
type Snapshot = { text: string; zkId: string; url: string; account: string; date: string | null; platform: string; attachments?: Attachment[] };
export function canonicalInput(i: Snapshot): string {
  return JSON.stringify({text:i.text,zkId:i.zkId,url:i.url,account:i.account,date:i.date,platform:i.platform,...(i.attachments ? {attachments:i.attachments.map(a=>({name:a.name,size:a.size,type:a.type,lastModified:a.lastModified}))} : {})});
}
// Production handler; tests replace only the network transport, including actual REST requests.
export async function handleAnalyze(req: Request, get: GetEnv, transport: typeof fetch = fetch): Promise<Response> {
  const env=resolveEnv(get); const origin=req.headers.get('origin');
  const headers={'access-control-allow-origin':origin && env.allowedOrigins.includes(origin) ? origin : env.allowedOrigins[0], 'access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'POST,OPTIONS','content-type':'application/json',vary:'Origin'};
  const reply=(status:number,error_code:string,data:Record<string,unknown>={})=>Response.json({...(error_code ? {error:error_code,error_code} : {}),...data},{status,headers});
  if(origin && !env.allowedOrigins.includes(origin)) return reply(403,'ORIGIN_FORBIDDEN');
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
  if(req.method!=='POST') return reply(405,'METHOD_NOT_ALLOWED');
  const auth=req.headers.get('authorization'); if(!auth?.startsWith('Bearer ')) return reply(401,'AUTH_REQUIRED');
  const base=get('SUPABASE_URL'), anon=get('SUPABASE_ANON_KEY'), writer=get('SUPABASE_SERVICE_ROLE_KEY');
  if(!base || !anon) return reply(503,'AUTH_NOT_CONFIGURED');
  const userHeaders={apikey:anon,authorization:auth,'content-type':'application/json'};
  const serverHeaders={apikey:writer ?? '',authorization:`Bearer ${writer}`,'content-type':'application/json',Prefer:'return=representation'};
  const db=(path:string,init:RequestInit={},server=false)=>transport(`${base}/rest/v1/${path}`,{...init,headers:server ? serverHeaders : userHeaders,signal:AbortSignal.timeout(10000)});
  let owner:string;
  try {const r=await transport(`${base}/auth/v1/user`,{headers:userHeaders,signal:AbortSignal.timeout(10000)}); const u=await r.json(); if(!r.ok || typeof u.id!=='string') return reply(401,'AUTH_INVALID'); owner=u.id;} catch {return reply(503,'AUTH_UNAVAILABLE');}
  let body:Record<string,unknown>;
  try {
    const reader=req.body?.getReader(); if(!reader) return reply(400,'BODY_REQUIRED');
    const chunks:Uint8Array[]=[]; let size=0;
    for(;;) {const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>100000) {await reader.cancel(); return reply(413,'BODY_TOO_LARGE');} chunks.push(value);}
    const bytes=new Uint8Array(size); let offset=0; for(const c of chunks){bytes.set(c,offset); offset+=c.length;}
    body=JSON.parse(new TextDecoder().decode(bytes));
  } catch {return reply(422,'INVALID_JSON');}
  if(!body || Object.keys(body).some(k=>!['runId','input'].includes(k)) || typeof body.runId!=='string' || !/^[A-Za-z0-9-]{1,65}$/.test(body.runId)) return reply(422,'INVALID_INPUT');
  const i=body.input as Snapshot;
  if(!i || Object.keys(i).some(k=>!['text','zkId','url','account','date','platform','attachments'].includes(k)) || typeof i.text!=='string' || !i.text.trim() || i.text.length>20000 || typeof i.zkId!=='string' || !/^[A-Za-z0-9-]{1,80}$/.test(i.zkId) || !['url','account','platform'].every(k=>typeof (i as unknown as Record<string,unknown>)[k]==='string') || !(i.date===null || (typeof i.date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(i.date) && !isNaN(Date.parse(i.date)) && new Date(i.date).toISOString().slice(0,10)===i.date))) return reply(422,'INVALID_INPUT');
  if(i.attachments!==undefined && (!Array.isArray(i.attachments) || i.attachments.length>1 || i.attachments.some(a=> !a || typeof a!=='object' || Object.keys(a).some(k=>!['name','size','type','lastModified'].includes(k)) || typeof a.name!=='string' || typeof a.type!=='string' || !Number.isSafeInteger(a.size) || a.size<0 || !Number.isFinite(a.lastModified) || a.lastModified<0))) return reply(422,'INVALID_ATTACHMENT_MANIFEST');
  try {const r=await db(`workspaces?owner_id=eq.${encodeURIComponent(owner)}&select=data`); if(!r.ok) return reply(503,'WORKSPACE_UNAVAILABLE'); const rows=await r.json(); if(!rows[0]?.data?.complexes?.some((z:{id:string})=>z.id===i.zkId)) return reply(403,'OBJECT_FORBIDDEN');} catch{return reply(503,'WORKSPACE_UNAVAILABLE');}
  if(!writer || !env.apiKey || !env.model) return reply(503,'LLM_NOT_CONFIGURED');
  const hash=await sha256Hex(canonicalInput(i)); const id=body.runId;
  const filter=`analysis_runs?owner_id=eq.${encodeURIComponent(owner)}&id=eq.${encodeURIComponent(id)}`;
  const success=(row:Record<string,unknown>,replayed:boolean)=>reply(200,'',{realAI:true,engine:row.model,runId:id,inputHash:row.input_hash,input:row.input_snapshot,prompt_version:row.prompt_version,schema_version:row.schema_version,status:row.status,hypotheses:row.hypotheses,replayed});
  const replay=(row:Record<string,unknown>)=>row.input_hash!==hash ? reply(409,'RUN_INPUT_CONFLICT') : row.status==='succeeded' ? success(row,true) : reply(409,row.status==='pending' ? 'RUN_PENDING_NEW_ID_AFTER_TIMEOUT' : 'RUN_FAILED_NEW_ID_REQUIRED');
  const pending={id,owner_id:owner,zk_id:i.zkId,input_snapshot:i,input_hash:hash,provider:new URL(env.upstreamUrl).hostname,model:env.model,prompt_version:'s4-r2r3-v3',schema_version:1,status:'pending',hypotheses:[]};
  try {
    const found=await db(filter,{},true); if(!found.ok) return reply(503,'RUN_STORE_UNAVAILABLE'); const rows=await found.json(); if(rows.length) return replay(rows[0]);
    const inserted=await db('analysis_runs',{method:'POST',body:JSON.stringify(pending)},true);
    if(!inserted.ok) { if(inserted.status===409) {const r=await db(filter,{},true); if(r.ok){const rows=await r.json(); if(rows.length) return replay(rows[0]);}} return reply(503,'RUN_STORE_UNAVAILABLE'); }
  } catch {return reply(503,'RUN_STORE_UNAVAILABLE');}
  const finish=async(status:string,hypotheses:unknown[],error_code:string|null)=>{try{const r=await db(filter+'&status=eq.pending',{method:'PATCH',body:JSON.stringify({status,hypotheses,error_code,finished_at:new Date().toISOString()})},true); return r.ok && (await r.json()).length===1;}catch{return false;}};
  try {
    const quota=await db('rpc/consume_ai_quota',{method:'POST',body:'{}'});
    if(!quota.ok) {const q=await quota.json(); const exhausted=q.message==='RATE_LIMIT'; await finish('failed',[],exhausted ? 'QUOTA_EXCEEDED' : 'QUOTA_UNAVAILABLE'); return reply(exhausted ? 429 : 503,exhausted ? 'QUOTA_EXCEEDED' : 'QUOTA_UNAVAILABLE');}
    const provider=await handleProxy(new Request(req.url,{method:'POST',headers:{authorization:auth},body:JSON.stringify({text:i.text})}),env,{verifyToken:async()=>true,fetchUpstream:transport});
    const output=await provider.json();
    if(!provider.ok) {await finish('failed',[],output.error_code); return reply(provider.status,output.error_code);}
    const hypotheses=output.hypotheses.map((h:Record<string,unknown>,n:number)=>({...h,id:`${id}-h${n+1}`}));
    if(!await finish('succeeded',hypotheses,null)) return reply(503,'RUN_FINALIZE_FAILED');
    return success({...pending,status:'succeeded',hypotheses},false);
  } catch {await finish('failed',[],'ANALYSIS_UNAVAILABLE'); return reply(503,'ANALYSIS_UNAVAILABLE');}
}
export function handler(req:Request):Promise<Response> {
  return handleAnalyze(req,k=>(globalThis as unknown as {Deno:{env:{get(k:string):string|undefined}}}).Deno.env.get(k));
}
if((import.meta as unknown as {main?:boolean}).main) (globalThis as unknown as {Deno:{serve(h:typeof handler):void}}).Deno.serve(handler);
