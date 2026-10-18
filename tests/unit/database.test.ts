import { beforeAll, afterAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { initialState } from '../../src/lib/domain';
let db: PGlite;
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select,insert,delete on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
    insert into auth.users values('${userA}','a@example.test'),('${userB}','b@example.test');
  `);
  await db.exec(readFileSync('supabase/migrations/202610180001_workspace.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/202610180002_seed.sql','utf8'));
}, 60000);
afterAll(async () => { await db?.close(); });
async function login(id: string) { await db.exec(`reset role; set request.jwt.claim.sub = '${id}'; set role authenticated;`); }
async function command(value: unknown, version: number) {
  const result = await db.query<{result:{data: ReturnType<typeof initialState>;version:number}}>('select public.apply_command($1::jsonb,$2) as result',[JSON.stringify(value),version]);
  return result.rows[0].result;
}
it('migrations, RLS, transactions, snapshots and Storage isolate two users', async () => {
  await login(userA);
  await db.query('select initialize_workspace()');
  expect((await db.query('select * from workspaces')).rows).toHaveLength(1);
  await expect(db.query("update workspaces set version=99")).rejects.toThrow(/permission denied/);
  await expect(command({type:'factor',zkId:'SQ-001',code:'R1',status:'confirmed',evidence:{source:'test'}},1)).rejects.toThrow('R1_REQUIRES_VERIFIED_ABSENCE');
  // Failed command rolls back; version is still one.
  const result = await command({type:'signal',zkId:'SQ-002',status:'confirmed',comment:'Verified evidence'},1);
  expect(result.version).toBe(2); expect(result.data.signals['SQ-002'].status).toBe('confirmed');
  await expect(command({type:'signal',zkId:'SQ-002',status:'returned',comment:'reason'},1)).rejects.toThrow('STALE_VERSION');
  const next = await command({type:'factor',zkId:'SQ-002',code:'R2',status:'rejected',evidence:{source:'correction'},comment:'withdrawn'},2);
  expect(next.data.signals['SQ-002'].status).toBe('draft');
  expect(next.data.audit).toHaveLength(2);
  expect(next.data.audit[0].reviewer).toBe('a@example.test');
  await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['evidence',`${userA}/SQ-002/file.jpg`]);
  await expect(db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['evidence',`${userB}/SQ-002/file.jpg`])).rejects.toThrow(/row-level security/);
  await login(userB);
  expect((await db.query('select * from workspaces')).rows).toHaveLength(0);
  expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);
  await db.query('select initialize_workspace()');
  const own = await db.query<{owner_id:string}>('select owner_id from workspaces');
  expect(own.rows[0].owner_id).toBe(userB);
  await expect(command({type:'media',media:{zkId:'SQ-002',id:'fake',path:`${userA}/SQ-002/file.jpg`}},1)).rejects.toThrow('INVALID_STORAGE_PATH');
  await db.exec('reset role; set request.jwt.claim.sub = \'\'; set role anon;');
  await expect(db.query('select initialize_workspace()')).rejects.toThrow(/permission denied/);
}, 60000);
it('enforces grounding, readiness guards, duplicate detection, quota and durable media', async () => {
  await login(userA);
  const ad = {...initialState().ads[0], id:'test-new',text:'Новый депозит 12345 тенге.'};
  await expect(command({type:'ad',ad,decision:'confirmed',hypothesis:{code:'R2',quote:'придумано'}},3)).rejects.toThrow('UNGROUNDED_QUOTE');
  const result = await command({type:'ad',ad,decision:'confirmed',hypothesis:{code:'R2',quote:'депозит 12345 тенге.'}},3);
  expect(result.data.ads[0].decision).toBe('confirmed');
  await expect(command({type:'ad',ad,decision:'saved'},4)).rejects.toThrow('DUPLICATE_AD');
  await expect(command({type:'factor',zkId:'SQ-001',code:'R5',status:'confirmed',evidence:{source:'test'}},4)).rejects.toThrow('R5_REQUIRES_GAP');
  const observation = await command({type:'readiness',zkId:'SQ-002',value:12,source:'Drone inspection',date:'2026-10-18'},4);
  expect(observation.data.complexes[1].factors.find(f=>f.code==='R5')?.status).toBe('hypothesis');
  const media = await command({type:'media',media:{zkId:'SQ-002',id:'photo',path:`${userA}/SQ-002/file.jpg`}},5);
  expect(media.data.media[0].id).toBe('photo');
  for (let i=0;i<30;i++) await db.query('select consume_ai_quota()');
  await expect(db.query('select consume_ai_quota()')).rejects.toThrow('RATE_LIMIT');
},60000);
