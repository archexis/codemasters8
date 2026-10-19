import { handleAnalyze } from './index.ts';
function assert(value:unknown):asserts value {if(!value) throw new Error('Assertion failed');}
const env:Record<string,string>={SUPABASE_URL:'http://db',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'writer',LLM_API_KEY:'server-secret',LLM_MODEL:'model'};
const get=(k:string)=>env[k];
const request=(body:unknown)=>new Request('http://edge',{method:'POST',headers:{authorization:'Bearer user'},body:JSON.stringify(body)});
Deno.test('production method/auth boundaries',async()=>{
  assert((await handleAnalyze(new Request('http://edge',{method:'OPTIONS'}),get)).status===204);
  assert((await handleAnalyze(new Request('http://edge'),get)).status===405);
  assert((await handleAnalyze(new Request('http://edge',{method:'POST'}),get)).status===401);
});
Deno.test('production chunked byte bound precedes JSON parsing/provider',async()=>{
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(60000));c.enqueue(new Uint8Array(60000));c.close();}});
  const r=await handleAnalyze(new Request('http://edge',{method:'POST',headers:{authorization:'Bearer x'},body:stream}),get,()=>Promise.resolve(Response.json({id:'owner'})));
  assert(r.status===413);
});
Deno.test('production writes pending then succeeded and replays without paid request',async()=>{
  let row:Record<string,unknown>|null=null; let calls=0;
  const transport:typeof fetch=async(url,init)=>{
    const path=String(url); const body=init?.body ? JSON.parse(String(init.body)) : null;
    if(path.includes('/auth/')) return Response.json({id:'owner'});
    if(path.includes('/workspaces')) return Response.json([{data:{complexes:[{id:'SQ-001'}]}}]);
    if(path.includes('/analysis_runs')) {
      assert(new Headers(init?.headers).get('authorization')==='Bearer writer');
      if(init?.method==='POST'){row=body;assert(row?.status==='pending');}
      if(init?.method==='PATCH'){Object.assign(row!,body);}
      return Response.json(row ? [row] : []);
    }
    if(path.includes('/consume_ai_quota')) return Response.json(null);
    calls++; assert(new Headers(init?.headers).get('authorization')==='Bearer server-secret');
    return Response.json({choices:[{message:{content:JSON.stringify({hypotheses:[{code:'R2',quote:'Депозит',reason:'оплата'}]})}}]});
  };
  const body={runId:'run',input:{text:'Депозит обязателен',zkId:'SQ-001',url:'',account:'',platform:'',date:null}};
  assert((await handleAnalyze(request(body),get,transport)).status===200);
  assert((await handleAnalyze(request(body),get,transport)).status===200); assert(calls===1);
});
