import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState } from '../../src/lib/domain';

const client = vi.hoisted(() => ({
  getSession: vi.fn(), getUser: vi.fn(), from: vi.fn(), storageFrom: vi.fn(), rpc: vi.fn(), invoke: vi.fn(),
}));
vi.mock('../../src/lib/supabase', () => ({ demoMode: false, supabase: {
  auth: { getSession: client.getSession, getUser: client.getUser },
  from: client.from, storage: { from: client.storageFrom }, rpc: client.rpc, functions: { invoke: client.invoke },
} }));

import { commitCommand, loadState, readFileBytes, UnknownCommitResultError, uploadFile, trackAuthSession, SessionSupersededError } from '../../src/lib/repository';
import { analyze } from '../../src/lib/analysis';

const user = { id: '11111111-1111-4111-8111-111111111111', email: 'review@example.test' };

beforeEach(() => {
  vi.resetAllMocks();
  client.getSession.mockResolvedValue({ data: { session: { user } } });
  client.getUser.mockResolvedValue({ data: { user }, error: null });
  client.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { data: initialState(), version: 1 }, error: null }) }) }) });
});

describe('review: connected storage and network boundaries', () => {
  it('S6 no Web Locks means read-only DEMO, without lost form/data promises', async()=>{
    client.getSession.mockResolvedValue({data:{session:null}});client.getUser.mockResolvedValue({data:{user:null},error:null});
    const state=await loadState(); const original=Object.getOwnPropertyDescriptor(navigator,'locks');
    Object.defineProperty(navigator,'locks',{value:undefined,configurable:true});
    try {await expect(commitCommand(state,{type:'signal',zkId:'SQ-002',status:'confirmed',comment:'No locks'},'DEMO')).rejects.toThrow('Web Locks');}
    finally {if(original)Object.defineProperty(navigator,'locks',original);else delete (navigator as any).locks;}
  });
  it('S6 late workspace load after A logout/B login cannot return A data', async () => {
    trackAuthSession(user.id);
    let finish!: (value: unknown)=>void;
    client.from.mockReturnValue({select:()=>({eq:()=>({maybeSingle:()=>new Promise(resolve=>{finish=resolve;})})})});
    const pending=loadState();
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    trackAuthSession('22222222-2222-4222-8222-222222222222');
    finish({data:{data:initialState(),version:999},error:null});
    await expect(pending).rejects.toBeInstanceOf(SessionSupersededError);
  });
  it('S6 in-flight save cannot return A result after B login', async()=>{
    const state=await loadState(); let finish!:(value:unknown)=>void;
    client.rpc.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=commitCommand(state,{type:'signal',zkId:'SQ-002',status:'confirmed',comment:'Session test'},'A');
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    trackAuthSession('22222222-2222-4222-8222-222222222222');
    finish({data:{data:state,version:999},error:null});
    await expect(pending).rejects.toBeInstanceOf(SessionSupersededError);
  });
  it('backup reads Storage bytes for an authenticated owner', async () => {
    const state = await loadState();
    const zkId = state.complexes[0].id;
    const download = vi.fn().mockResolvedValue({ data: new Blob(['cloud proof']), error: null });
    client.storageFrom.mockReturnValue({ download });
    const media = { id: 'm-cloud', zkId, path: `${user.id}/${zkId}/m-cloud.png`, name: 'proof.png', kind: 'image/png', date: '2026-10-18', note: '', ready: null };
    expect(new TextDecoder().decode(await readFileBytes(media))).toBe('cloud proof');
    expect(download).toHaveBeenCalledWith(media.path);
  });

  it('a returned network error leaves the outcome unknown for safe retry', async () => {
    const state = await loadState();
    client.rpc.mockResolvedValue({ data: null, status: 0, error: { message: 'TypeError: Failed to fetch', code: '' } });
    await expect(commitCommand(state, { type: 'signal', zkId: state.complexes[0].id, status: 'draft', comment: 'Review' }, 'Reviewer'))
      .rejects.toBeInstanceOf(UnknownCommitResultError);
  });

  it('upload retry uses the real owner path and verifies existing bytes', async () => {
    const state = await loadState();
    const file = new File(['same proof'], 'proof.png', { type: 'image/png' });
    const upload = vi.fn().mockResolvedValue({ error: { message: 'The resource already exists' } });
    const download = vi.fn().mockResolvedValue({ data: new Blob(['same proof']), error: null });
    client.storageFrom.mockReturnValue({ upload, download });
    const media = await uploadFile(file, state.complexes[0].id, { mediaId: 'm-retry' });
    expect(media.path).toBe(`${user.id}/${state.complexes[0].id}/m-retry.png`);
    expect(download).toHaveBeenCalledWith(media.path);
    download.mockResolvedValue({ data: new Blob(['evil proof']), error: null });
    await expect(uploadFile(file, state.complexes[0].id, { mediaId: 'm-retry' })).rejects.toMatchObject({ message: 'The resource already exists' });
  });

  it('configured Supabase without a session still permits local DEMO analysis', async () => {
    client.getSession.mockResolvedValue({ data: { session: null } });
    const result = await analyze({text:'Бронь квартиры — 500 000 тенге.',zkId:'SQ-001',url:'',account:'',date:null,platform:''},{runId:'test',signal:new AbortController().signal});
    expect(result.realAI).toBe(false);
    expect(result.hypotheses[0].code).toBe('R2');
    expect(client.invoke).not.toHaveBeenCalled();
  });
});


describe('current AI transport contract (offline)',()=>{
  const input={text:'Депозит 500 000 тенге.',zkId:'SQ-001',url:'',account:'',date:null,platform:''};
  for(const code of ['AUTH_REQUIRED','QUOTA_EXCEEDED','PROVIDER_TIMEOUT','INVALID_PROVIDER_RESPONSE']) {
    it(`preserves ${code} without parser success`,async()=>{
      client.invoke.mockResolvedValue({data:null,error:{message:'Edge failure',context:new Response(JSON.stringify({error_code:code}),{status:code==='QUOTA_EXCEEDED'?429:503})}});
      await expect(analyze(input,{runId:'transport-run',signal:new AbortController().signal})).rejects.toThrow(code);
    });
  }
  it('rejects a different run or a fabricated quote',async()=>{
    const result={engine:'fixture',realAI:true,status:'succeeded',runId:'other-run',hypotheses:[{id:'h1',code:'R2',quote:'Депозит',reason:'Оплата'}]};
    client.invoke.mockResolvedValue({data:result,error:null});
    await expect(analyze(input,{runId:'transport-run',signal:new AbortController().signal})).rejects.toThrow('Некорректный доверенный результат');
    client.invoke.mockResolvedValue({data:{...result,runId:'transport-run',hypotheses:[{...result.hypotheses[0],quote:'Вымышленная цитата'}]},error:null});
    await expect(analyze(input,{runId:'transport-run',signal:new AbortController().signal})).rejects.toThrow('Некорректный доверенный результат');
  });
  it('does not call transport for an already cancelled run',async()=>{
    const controller=new AbortController();controller.abort();
    await expect(analyze(input,{runId:'cancelled-run',signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
    expect(client.invoke).not.toHaveBeenCalled();
  });
});
