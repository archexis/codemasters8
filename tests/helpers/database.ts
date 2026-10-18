import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { initialState } from '../../src/lib/domain';

/**
 * Test database (S0.2).
 *
 * Centralises the PGlite bootstrap that emulates Supabase's `auth` and
 * `storage` schemas, then loads **every** `.sql` migration found in the given
 * migrations directory, in sorted-by-name order (so a 3rd migration is never
 * silently skipped because the loader hard-codes file names).
 *
 * Each caller gets its own in-memory PGlite instance, which gives per-test
 * isolation: closing the instance discards all rows, and failed `apply_command`
 * calls abort their implicit transaction, leaving no partial state (rollback
 * isolation within a test).
 */

export const userA = '11111111-1111-4111-8111-111111111111';
export const userB = '22222222-2222-4222-8222-222222222222';

const BOOTSTRAP_SQL = `
create role anon; create role authenticated;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated; grant select,insert,delete on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
insert into auth.users values('${userA}','a@example.test'),('${userB}','b@example.test');
`;

/** Return `.sql` files in `dir` sorted by name (excludes temp / non-sql files). */
export function listMigrations(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('.') && !/[~]$/.test(f) && !/\.(tmp|bak|swp)$/i.test(f))
    .sort();
}

export interface TestDatabase {
  db: PGlite;
  appliedMigrations: string[];
}

/** Create a fresh, isolated PGlite instance and apply all migrations in `dir`. */
export async function createTestDatabase(
  migrationsDir = 'supabase/migrations',
): Promise<TestDatabase> {
  const db = new PGlite();
  await db.exec(BOOTSTRAP_SQL);
  const appliedMigrations = listMigrations(migrationsDir);
  for (const file of appliedMigrations) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }
  return { db, appliedMigrations };
}

/** Emulate a Supabase authenticated session for the given user id. */
export async function login(db: PGlite, id: string) {
  await db.exec(`reset role; set request.jwt.claim.sub = '${id}'; set role authenticated;`);
}

/** Emulate an anonymous session. */
export async function logoutAnon(db: PGlite) {
  await db.exec(`reset role; set request.jwt.claim.sub = ''; set role anon;`);
}

export interface ApplyResult {
  data: ReturnType<typeof initialState>;
  version: number;
}

/** Submit a command through `public.apply_command` and return the decoded result. */
export async function command(db: PGlite, value: unknown, version: number): Promise<ApplyResult> {
  // C2: единственная пишущая сигнатура — (jsonb, integer, text); command_id на намерение.
  const commandId = `test-${Date.now().toString(36)}-${Math.floor(Math.random() * 2 ** 30).toString(36)}`;
  const result = await db.query<{ result: ApplyResult }>(
    'select public.apply_command($1::jsonb,$2,$3) as result',
    [JSON.stringify(value), version, commandId],
  );
  return result.rows[0].result;
}
