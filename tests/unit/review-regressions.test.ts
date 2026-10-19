import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestDatabase, login, command, userA } from '../helpers/database';
import { initialState } from '../../src/lib/domain';
import { loadStateFromText } from '../../src/lib/state-migrations';
import { buildBackup, validateBackupPackage } from '../../src/lib/backup';
import { buildExport } from '../../src/lib/export';
import {
  attachStagedMedia, commitCommand, loadState, readDemoFileBytes, readRawBackup,
  resetDemo, restoreDemoBackup, uploadFile,
} from '../../src/lib/repository';
import { buildSignalSnapshot } from '../../src/lib/signal-snapshot';
import { createAuthDeps, handleProxy } from '../../supabase/functions/analyze-proxy/index';
import type { AppState, Command } from '../../src/lib/types';
import type { PGlite } from '@electric-sql/pglite';

let db: PGlite | undefined;
afterEach(async () => { await db?.close(); db = undefined; vi.unstubAllGlobals(); });

function memoryStorage() {
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
    removeItem: (key: string) => { items.delete(key); },
  };
  vi.stubGlobal('localStorage', storage);
  return storage;
}

function ad(zkId: string, id: string, text = 'Бронь квартиры 500 000 тенге') {
  return { id, zkId, text, platform: 'Manual', account: '', url: '', date: '2026-10-18', captureAt: '2026-10-18T10:00:00.000Z' };
}

async function sqlWorkspace() {
  db = (await createTestDatabase()).db;
  await login(db, userA);
  const row = await db.query<{ result: { data: AppState; version: number } }>('select initialize_workspace() as result');
  return row.rows[0].result;
}

describe('review: SQL writes remain loadable by the application', () => {
  it('factor UI payload, confirmed publication, readiness and signal snapshots survive reload', async () => {
    let current = await sqlWorkspace();
    const zkId = current.data.complexes[0].id;
    const factor: Command = { type: 'factor', zkId, code: 'R2', status: 'needs-verification',
      evidence: { kind: 'publication', source: 'Analyst', date: '2026-10-18' }, comment: 'Review' };
    const commands: Command[] = [factor,
      { type: 'ad', ad: ad(zkId, 'AD-REVIEW'), decision: 'confirmed', hypothesis: { code: 'R2', quote: 'Бронь квартиры 500 000 тенге' }, comment: 'Confirmed' },
      { type: 'readiness', zkId, value: 25, source: 'Observation', date: '2026-10-18' },
      { type: 'signal', zkId, status: 'confirmed', comment: 'Reviewed signal' },
    ];
    for (const payload of commands) {
      current = await command(db!, payload, current.version);
      expect(() => loadStateFromText(JSON.stringify(current.data))).not.toThrow();
    }
  });

  it('new sightings merge on the server; exact repeats still fail', async () => {
    let current = await sqlWorkspace();
    const zkId = current.data.complexes[0].id;
    const first = { type: 'ad', ad: ad(zkId, 'AD-SIGHTING-A'), decision: 'saved', comment: 'First' };
    current = await command(db!, first, current.version);
    const second = { ...first, ad: { ...first.ad, id: 'AD-SIGHTING-B', date: '2026-10-17', url: 'https://example.test/new-source' } };
    current = await command(db!, second, current.version);
    expect(current.data.ads.filter(a => a.text === first.ad.text)).toHaveLength(1);
    expect(current.data.ads.find(a => a.id === first.ad.id)?.sightings).toEqual([
      { source: 'Manual', date: '2026-10-17', url: second.ad.url, captureAt: second.ad.captureAt },
    ]);
    expect(() => loadStateFromText(JSON.stringify(current.data))).not.toThrow();
    await expect(command(db!, { ...second, ad: { ...second.ad, id: 'AD-SIGHTING-C' } }, current.version)).rejects.toThrow('DUPLICATE_AD');
  });

  it('R3 carries analyst material through both domain and SQL validation', async () => {
    let current = await sqlWorkspace();
    const zkId = current.data.complexes[0].id;
    const payload: Command = { type: 'ad', ad: ad(zkId, 'AD-R3', 'Продажа квартир в строящемся доме'),
      decision: 'confirmed', hypothesis: { code: 'R3', quote: 'Продажа квартир', evidenceText: '2026-10-18: проверен реестр, объект не введён' }, comment: 'Review' };
    current = await command(db!, payload, current.version);
    const loaded = loadStateFromText(JSON.stringify(current.data)).state;
    expect(loaded.complexes[0].factors.find(f => f.code === 'R3')?.evidence?.text).toContain('объект не введён');
    await resetDemo();
    const result = await commitCommand(await loadState(), payload, 'Reviewer');
    expect(result.state.complexes[0].factors.find(f => f.code === 'R3')?.status).toBe('confirmed');
  });

  it('server-side publication attachments enter evidence and the confirmed signal manifest', async () => {
    let current = await sqlWorkspace();
    const zkId = current.data.complexes[0].id;
    const path = `${userA}/${zkId}/m-sql.png`;
    await db!.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb)',
      ['evidence', path, JSON.stringify({ size: 5, mimetype: 'image/png' })]);
    const payload = { type: 'ad', ad: ad(zkId, 'AD-SQL-MEDIA'), decision: 'confirmed',
      hypothesis: { code: 'R2', quote: 'Бронь квартиры 500 000 тенге' }, comment: 'Review with attachment',
      mediaAttachment: { id: 'm-sql', zkId, name: 'proof.png', kind: 'image/png', date: '2026-10-18', note: '', ready: null, path, bytes: 5 } };
    current = await command(db!, payload, current.version);
    expect(current.data.complexes[0].factors.find(f => f.code === 'R2')?.evidence?.mediaIds).toEqual(['m-sql']);
    current = await command(db!, { type: 'signal', zkId, status: 'confirmed', comment: 'Reviewed files' }, current.version);
    expect(current.data.signalVersions?.[zkId].at(-1)?.mediaManifest).toContainEqual(expect.objectContaining({ kind: 'media', id: 'm-sql', path }));
    expect(() => loadStateFromText(JSON.stringify(current.data))).not.toThrow();
  });

  it('new migration repairs already saved evidence and snapshots without inventing proofs', async () => {
    const current = await sqlWorkspace();
    const old = structuredClone(current.data);
    const factor = old.complexes[0].factors.find(f => f.evidence)!;
    delete (factor.evidence as unknown as Record<string, unknown>).id;
    const zkId = old.complexes[0].id;
    old.signals[zkId] = { status: 'confirmed', snapshot: structuredClone(old.complexes[0]), at: '2026-10-18', reviewer: 'Previous analyst', comment: 'Previous proof' };
    await db!.exec('reset role');
    await db!.query('update workspaces set data=$1::jsonb', [JSON.stringify(old)]);
    await db!.exec(readFileSync('supabase/migrations/20261019000200_review_fixes.sql', 'utf8'));
    const row = await db!.query<{ data: AppState }>('select data from workspaces');
    const repaired = loadStateFromText(JSON.stringify(row.rows[0].data)).state;
    expect(repaired.complexes[0].factors.find(f => f.code === factor.code)?.evidence?.id).toBeTruthy();
    expect(repaired.signals[zkId].snapshot?.factors.find(f => f.code === factor.code)?.evidence?.source).toBe(factor.evidence?.source);
  });
});

describe('review: local envelope, evidence and restore', () => {
  it('rejects future or malformed states inside an envelope without overwriting the source', async () => {
    const storage = memoryStorage();
    for (const state of [{ ...initialState(), schemaVersion: 999 }, { ...initialState(), ads: 'broken' }]) {
      const raw = JSON.stringify({ envelope: 1, state, version: 7, receipts: {} });
      storage.setItem('sq_svelte_demo_v2', raw);
      await expect(loadState()).rejects.toThrow();
      expect(storage.getItem('sq_svelte_demo_v2')).toBe(raw);
      expect(readRawBackup()).toBe(raw);
      await expect(commitCommand(initialState(), { type: 'signal', zkId: 'SQ-001', status: 'draft', comment: 'Review' }, 'Reviewer')).rejects.toThrow();
      expect(storage.getItem('sq_svelte_demo_v2')).toBe(raw);
    }
  });

  it('attached bytes enter the accepted signal manifest and JSON export', async () => {
    await resetDemo();
    let state = await loadState();
    const zkId = state.complexes[0].id;
    const media = await uploadFile(new File(['proof'], 'proof.png', { type: 'image/png' }), zkId);
    const payload: Command = { type: 'ad', ad: ad(zkId, 'AD-MEDIA'), decision: 'confirmed', hypothesis: { code: 'R2', quote: 'Бронь квартиры 500 000 тенге' }, comment: 'Reviewed proof' };
    state = (await commitCommand(state, attachStagedMedia(payload, media), 'Reviewer')).state;
    expect(buildSignalSnapshot(state, zkId).mediaManifest).toContainEqual(expect.objectContaining({ kind: 'media', id: media.id, path: media.path }));
    state = (await commitCommand(state, { type: 'signal', zkId, status: 'confirmed', comment: 'Reviewed signal' }, 'Reviewer')).state;
    expect(buildExport(state, zkId).materials).toContainEqual(expect.objectContaining({ kind: 'media', id: media.id }));
    expect(() => loadStateFromText(JSON.stringify(state))).not.toThrow();
  });

  it('cloud backup restored into DEMO reopens every file and can be backed up again', async () => {
    const source = initialState();
    const zkId = source.complexes[0].id;
    const bytes = new TextEncoder().encode('original cloud proof');
    source.media.push({ id: 'm-cloud', zkId, name: 'scan.jpeg', path: `cloud-user/${zkId}/m-cloud.jpg`, kind: 'image/jpeg', date: '2026-10-18', note: '', ready: null });
    const backup = await validateBackupPackage((await buildBackup(source, new Map([['m-cloud', bytes]]))).zip);
    const storage = memoryStorage();
    storage.setItem('sq_svelte_demo_v2', JSON.stringify({ schemaVersion: 3, complexes: [], ads: [], media: [], signals: {}, signalVersions: {}, audit: [] }));
    const imported = await restoreDemoBackup(backup);
    const reopened = await loadState();
    expect(reopened).toEqual(imported);
    expect(reopened.media[0].path).toBe(`demo/${zkId}/m-cloud.jpg`);
    expect(await readDemoFileBytes(reopened.media[0].path)).toEqual(bytes);
    const again = await buildBackup(reopened, new Map([['m-cloud', await readDemoFileBytes(reopened.media[0].path)]]));
    expect((await validateBackupPackage(again.zip)).files.get('m-cloud')).toEqual(bytes);
  });
});

describe('review: proxy authentication and quota before paid calls', () => {
  const env = { allowedOrigins: ['http://localhost:5173'], apiKey: 'provider-stub', model: 'stub', upstreamUrl: 'http://stub', timeoutMs: 30000 };
  const post = () => new Request('http://test', { method: 'POST', headers: { Origin: env.allowedOrigins[0], Authorization: 'Bearer public-key', 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Review' }) });

  it('fails closed when no user verifier was provided', async () => {
    const provider = vi.fn();
    expect((await handleProxy(post(), env, { fetchUpstream: provider })).status).toBe(401);
    expect(provider).not.toHaveBeenCalled();
  });

  it('production verifier rejects a public key without consuming quota or calling the provider', async () => {
    const auth = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: 'Invalid user' }, { status: 401 }));
    const deps = createAuthDeps(k => ({ SUPABASE_URL: 'http://supabase.test', SUPABASE_ANON_KEY: 'public-key' })[k as 'SUPABASE_URL'], auth);
    const provider = vi.fn();
    expect((await handleProxy(post(), env, { ...deps, fetchUpstream: provider })).status).toBe(401);
    expect(auth).toHaveBeenCalledTimes(1);
    expect(provider).not.toHaveBeenCalled();
  });

  it('a signed-in caller must pass the persisted quota before any provider call', async () => {
    const auth = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: userA }))
      .mockResolvedValueOnce(Response.json({ message: 'quota exceeded' }, { status: 429 }));
    const deps = createAuthDeps(k => k === 'SUPABASE_URL' ? 'http://supabase.test' : 'public-key', auth);
    const provider = vi.fn();
    expect((await handleProxy(post(), env, { ...deps, fetchUpstream: provider })).status).toBe(429);
    expect(String(auth.mock.calls[1][0])).toContain('/rpc/consume_ai_quota');
    expect(provider).not.toHaveBeenCalled();
  });
});
