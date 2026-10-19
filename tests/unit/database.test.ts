import { afterEach, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  createTestDatabase,
  command,
  login,
  logoutAnon,
  listMigrations,
} from '../helpers/database';
import { initialState } from '../../src/lib/domain';

const REAL_MIGRATIONS = 'supabase/migrations';
const FIXTURE_MIGRATIONS = 'tests/fixtures/contracts/migrations';
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';

let db: PGlite;

// Isolation contract (S0.2): every test gets its own in-memory PGlite instance,
// so no state (notably `version`) leaks between tests. Failed `apply_command`
// calls abort their implicit transaction and leave no partial writes (rollback
// isolation). Closing the instance discards everything.
afterEach(async () => {
  await db?.close();
});

/** Bootstrap a fresh, isolated database and point the shared handle at it. */
async function setup(migrationsDir = REAL_MIGRATIONS) {
  const tdb = await createTestDatabase(migrationsDir);
  db = tdb.db;
  return tdb;
}

/* ---------------------------------------------------------------------------
 * Migrations / loader
 * ------------------------------------------------------------------------- */

it('migrations: loads every .sql migration sorted by name and records the applied list', async () => {
  const tdb = await setup();
  // Loader must not hard-code file names: it applies exactly listMigrations().
  expect(tdb.appliedMigrations).toEqual(listMigrations(REAL_MIGRATIONS));
  // Explicit, fixed applied-migration list (order matters):
  expect(tdb.appliedMigrations).toEqual([
    '202610180001_workspace.sql',
    '202610180002_seed.sql',
    '20261018104408_c1_command_schema.sql',
    '20261018105750_s1_2_decision_contract.sql',
    '20261018111105_s1_3_invalidation.sql',
    '20261018112607_s1_4_seed_integrity.sql',
    '20261018121836_s2_1_schema_version.sql',
    '20261018130000_s2_2_receipts.sql',
    '20261018175456_s2_5_restore.sql',
    '20261018180000_s2_4_signals.sql',
    '20261019000000_s4_1_runs.sql',
    '20261019000100_s4_2_hypothesis.sql',
    '20261019000200_review_fixes.sql',
    '20261019000300_s4_trusted_path.sql',
    '20261019000400_s4_commissioning_material.sql',
    '20261019000500_s5_signal_cycle.sql',
    '20261019033830_ux_case_ledger.sql',
  ]);
  // First migration created the schema; second migration seeded app_seed.
  expect((await db.query<{ to_regclass: string }>("select to_regclass('public.workspaces')")).rows[0].to_regclass).not.toBeNull();
  expect((await db.query<{ count: number }>('select count(*)::int from public.app_seed')).rows[0].count).toBe(1);
}, 60000);

it('migrations: fixture loader applies the third (fictitious) migration, not only the first two', async () => {
  const tdb = await setup(FIXTURE_MIGRATIONS);
  // The fixture dir ships two real migrations plus a fictitious third marker.
  expect(tdb.appliedMigrations).toEqual([
    '202610180001_workspace.sql',
    '202610180002_seed.sql',
    '202610180003_contract_marker.sql',
  ]);
  // The third migration must actually execute (its marker table must exist);
  // a loader that hard-coded/skipped the first two would leave it missing.
  expect((await db.query<{ value: string }>('select value from public._contract_load_marker')).rows[0].value).toBe('third-migration-applied');
}, 60000);

/* ---------------------------------------------------------------------------
 * auth
 * ------------------------------------------------------------------------- */

it('auth: RLS isolates workspaces/storage between users and denies anon', async () => {
  await setup();
  await login(db, userA);
  await db.query('select initialize_workspace()');
  expect((await db.query('select * from workspaces')).rows).toHaveLength(1);
  await expect(db.query("update workspaces set version=99")).rejects.toThrow(/permission denied/);
  await expect(db.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['evidence', `${userB}/SQ-002/file.jpg`])).rejects.toThrow(/row-level security/);
  await login(db, userB);
  expect((await db.query('select * from workspaces')).rows).toHaveLength(0);
  expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);
  await db.query('select initialize_workspace()');
  const own = await db.query<{ owner_id: string }>('select owner_id from workspaces');
  expect(own.rows[0].owner_id).toBe(userB);
  await logoutAnon(db);
  await expect(db.query('select initialize_workspace()')).rejects.toThrow(/permission denied/);
}, 60000);

/* ---------------------------------------------------------------------------
 * transactions (rollback, versioning, snapshots, signals, audit)
 * ------------------------------------------------------------------------- */

it('transactions: failed commands roll back, versions are enforced and signals/audit isolate per workspace', async () => {
  await setup();
  await login(db, userA);
  await db.query('select initialize_workspace()');
  // R1 without a verified absence rolls back; version stays 1.
  await expect(command(db, { type: 'factor', zkId: 'SQ-001', code: 'R1', status: 'confirmed', evidence: { source: 'test' } }, 1)).rejects.toThrow('R1_REQUIRES_VERIFIED_ABSENCE');
  const result = await command(db, { type: 'signal', zkId: 'SQ-002', status: 'confirmed', comment: 'Verified evidence' }, 1);
  expect(result.version).toBe(2); expect(result.data.signals['SQ-002'].status).toBe('confirmed');
  // Stale version is rejected; workspace is still at version 2.
  await expect(command(db, { type: 'signal', zkId: 'SQ-002', status: 'returned', comment: 'reason' }, 1)).rejects.toThrow('STALE_VERSION');
  const next = await command(db, { type: 'factor', zkId: 'SQ-002', code: 'R2', status: 'rejected', evidence: { source: 'correction' }, comment: 'withdrawn' }, 2);
  expect(next.data.signals['SQ-002'].status).toBe('draft');
  expect(next.data.audit).toHaveLength(2);
  expect(next.data.audit[0].reviewer).toBe('a@example.test');
}, 60000);

/* ---------------------------------------------------------------------------
 * grounding
 * ------------------------------------------------------------------------- */

it('grounding: rejects ungrounded quotes, duplicates, R5 without gap; readiness yields R5 hypothesis', async () => {
  await setup();
  await login(db, userA);
  await db.query('select initialize_workspace()');
  const ad = { ...initialState().ads[0], id: 'test-new', text: 'Новый депозит 12345 тенге.' };
  await expect(command(db, { type: 'ad', ad, decision: 'confirmed', comment:'Проверенное предложение оплаты', hypothesis: { code: 'R2', quote: 'придумано' } }, 1)).rejects.toThrow('UNGROUNDED_QUOTE');
  const result = await command(db, { type: 'ad', ad, decision: 'confirmed', comment:'Проверенное предложение оплаты', hypothesis: { code: 'R2', quote: 'депозит 12345 тенге.' } }, 1);
  expect(result.data.ads[0].decision).toBe('confirmed');
  await expect(command(db, { type: 'ad', ad, decision: 'saved' }, 2)).rejects.toThrow('DUPLICATE_AD');
  await expect(command(db, { type: 'factor', zkId: 'SQ-001', code: 'R5', status: 'confirmed', evidence: { source: 'test' } }, 2)).rejects.toThrow('R5_REQUIRES_GAP');
  const observation = await command(db, { type: 'readiness', zkId: 'SQ-002', value: 12, source: 'Drone inspection', date: '2026-10-18' }, 2);
  expect(observation.data.complexes[1].factors.find(f => f.code === 'R5')?.status).toBe('hypothesis');
}, 60000);

/* ---------------------------------------------------------------------------
 * media
 * ------------------------------------------------------------------------- */

it('media: blocks cross-owner storage paths with INVALID_STORAGE_PATH, then stores durable media', async () => {
  await setup();
  await login(db, userB);
  await db.query('select initialize_workspace()');
  // userB cannot reference userA's storage path.
  await expect(command(db, { type: 'media', media: { zkId: 'SQ-002', id: 'fake', path: `${userA}/SQ-002/file.jpg` } }, 1)).rejects.toThrow('INVALID_STORAGE_PATH');
  await login(db, userA);
  await db.query('select initialize_workspace()');
  await db.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['evidence', `${userA}/SQ-002/photo.jpg`]);
  const media = await command(db, { type: 'media', media: { zkId: 'SQ-002', id: 'photo', path: `${userA}/SQ-002/photo.jpg` } }, 1);
  expect(media.data.media[0].id).toBe('photo');
}, 60000);

/* ---------------------------------------------------------------------------
 * quota
 * ------------------------------------------------------------------------- */

it('quota: consume_ai_quota allows 30 then raises RATE_LIMIT', async () => {
  await setup();
  await login(db, userA);
  for (let i = 0; i < 30; i++) await db.query('select consume_ai_quota()');
  await expect(db.query('select consume_ai_quota()')).rejects.toThrow('RATE_LIMIT');
}, 60000);
