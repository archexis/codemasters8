import { handler } from './index.ts';
function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message); }
const originalFetch = globalThis.fetch;
const config = { SUPABASE_URL:'http://supabase.test', SUPABASE_ANON_KEY:'anon', LLM_API_KEY:'server-secret', LLM_MODEL:'test-model', LLM_API_URL:'http://llm.test/chat', LLM_THINKING:'disabled' };
for (const [name,value] of Object.entries(config)) Deno.env.set(name,value);
const req = (body: unknown) => new Request('http://edge.test/analyze', { method:'POST', headers:{Authorization:'Bearer test-token','Content-Type':'application/json'},body:JSON.stringify(body) });
Deno.test('method, preflight and authentication boundary', async () => {
  assert((await handler(new Request('http://edge.test',{method:'OPTIONS'}))).status===204);
  assert((await handler(new Request('http://edge.test'))).status===405);
  assert((await handler(new Request('http://edge.test',{method:'POST'}))).status===401);
});
Deno.test('grounded LLM response uses a server secret and user-scoped quota', async () => {
  let calledProvider = false; let quota = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/auth/v1/user')) return Response.json({id:'analyst',email:'a@example.test'});
    if (url.includes('/rpc/consume_ai_quota')) { quota = true; return Response.json(null); }
    assert(new Headers(init?.headers).get('Authorization')==='Bearer server-secret');
    const body=JSON.parse(String(init?.body));
    assert(body.max_tokens===2048 && body.thinking.type==='disabled');
    calledProvider = true;
    return Response.json({ choices:[{message:{content:JSON.stringify({hypotheses:[{code:'R2',quote:'Депозит 500 тенге',reason:'Просьба оплаты'}]})}}] });
  };
  try {
    const response = await handler(req({text:'Депозит 500 тенге',complexName:'ЖК'}));
    assert(response.status===200); assert((await response.json()).realAI===true); assert(calledProvider && quota);
  } finally { globalThis.fetch = originalFetch; }
});
Deno.test('invalid token, malformed input, invented quotes and provider failure are rejected', async () => {
  let validToken = false; let failProvider = false;
  globalThis.fetch = async input => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/auth/v1/user')) return validToken ? Response.json({id:'analyst'}) : Response.json({error:'invalid token'},{status:401});
    if (url.includes('/rpc/consume_ai_quota')) return Response.json(null);
    if (failProvider) return new Response('failed',{status:500});
    return Response.json({choices:[{message:{content:JSON.stringify({hypotheses:[{code:'R2',quote:'выдуманная цитата',reason:'test'}]})}}]});
  };
  try {
    assert((await handler(req({text:'Текст',complexName:'ЖК'}))).status===401);
    validToken = true;
    assert((await handler(req({text:'',complexName:'ЖК'}))).status===422);
    assert((await handler(req({text:'Текст',complexName:'ЖК'}))).status===502);
    failProvider = true;
    assert((await handler(req({text:'Текст',complexName:'ЖК'}))).status===502);
  } finally { globalThis.fetch = originalFetch; }
});
