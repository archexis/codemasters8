/**
 * S2.6 (connected-режим). Настоящая изоляция и долговечность против живого
 * Supabase — БЕЗ браузерных UI-форм: временные аккаунты поднимаются напрямую
 * через Auth admin API (как tools/local-smoke.mjs), DEMO остаётся без логина.
 *
 * НЕ запускать вручную в этом спринте: выполняет принимающий в конце.
 * Skip без SAQ_LIVE_* env. Только локальный Supabase URL.
 */
import { expect, test } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { buildBackup, sha256Hex } from '../../src/lib/backup';
import { computeScore } from '../../src/lib/scoring';
import type { AppState } from '../../src/lib/types';

const URL = process.env.SAQ_LIVE_SUPABASE_URL ?? '';
const ANON = process.env.SAQ_LIVE_SUPABASE_KEY ?? '';
const SERVICE = process.env.SAQ_LIVE_SERVICE_KEY ?? '';
const LIVE = Boolean(URL && ANON && SERVICE);
const LOCAL_URL = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(URL);

test.describe('S2.6 backup/restore изоляция (connected)', () => {
  test.beforeAll(()=>{expect(LIVE, 'Нужны SAQ_LIVE_SUPABASE_URL/KEY/SERVICE_KEY').toBe(true); expect(LOCAL_URL).toBe(true);});


  let admin: SupabaseClient;
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let clientC: SupabaseClient;
  let userA: { id: string; email: string };
  let userB: { id: string; email: string };
  let userC: { id: string; email: string };
  const password = `${randomUUID()}Aa9!`;
  const createdIds: string[] = [];
  const stagedPaths: string[] = [];

  test.beforeAll(async () => {
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    admin = createClient(URL, SERVICE, options);
    for (const [slot, client] of [['A', 'a'], ['B', 'b'], ['C', 'c']] as const) {
      void slot;
      const email = `saq-isolation-${randomUUID()}@example.test`;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error) throw created.error;
      createdIds.push(created.data.user.id);
      const c = createClient(URL, ANON, options);
      const signed = await c.auth.signInWithPassword({ email, password });
      if (signed.error) throw signed.error;
      if (client === 'a') { clientA = c; userA = { id: created.data.user.id, email }; }
      if (client === 'b') { clientB = c; userB = { id: created.data.user.id, email }; }
      if (client === 'c') { clientC = c; userC = { id: created.data.user.id, email }; }
    }
    // A и B инициализированы (seed), C — чистое место под restore (строки workspace нет).
    for (const c of [clientA, clientB]) {
      const init = await c.rpc('initialize_workspace');
      if (init.error) throw init.error;
    }
  });

  test.afterAll(async () => {
    for (const [client] of [[clientA, userA], [clientB, userB], [clientC, userC]] as const) {
      try {
        if (stagedPaths.length && client) await client.storage.from('evidence').remove(stagedPaths);
      } catch { /* cleanup best-effort */ }
    }
    stagedPaths.length = 0;
    for (const id of createdIds) {
      const removed = await admin.auth.admin.deleteUser(id);
      if (removed.error) console.error('Temporary user cleanup failed:', removed.error.message);
    }
  });

  test('B не читает workspace/media A; anonymous denied', async () => {
    const foreign = await clientB.from('workspaces').select('*').eq('owner_id', userA.id);
    expect(foreign.error).toBeNull();
    expect(foreign.data).toEqual([]);
    const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const denied = await anon.from('workspaces').select('*');
    // Сервер анонимов отклоняет: либо ошибка RLS/прав, либо пусто — но не данные A.
    expect(denied.data?.some((w) => (w as { owner_id: string }).owner_id === userA.id) ?? false).toBe(false);
  });

  test('expiry: короткий TTL истекает, новая own URL работает; чужая подпись — отказ', async () => {
    const path = `${userA.id}/SQ-002/expiry.png`;
    stagedPaths.push(path);
    const blob = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' });
    const uploaded = await clientA.storage.from('evidence').upload(path, blob);
    expect(uploaded.error).toBeNull();
    const short = await clientA.storage.from('evidence').createSignedUrl(path, 3);
    expect(short.error).toBeNull();
    expect((await fetch(short.data!.signedUrl)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 4500));
    expect((await fetch(short.data!.signedUrl)).status).not.toBe(200);
    const fresh = await clientA.storage.from('evidence').createSignedUrl(path, 60);
    expect(fresh.error).toBeNull();
    expect((await fetch(fresh.data!.signedUrl)).status).toBe(200);
    const forbidden = await clientB.storage.from('evidence').createSignedUrl(path, 60);
    expect(forbidden.error).not.toBeNull();
  });

  test('backup A → restore в чистое C → сверка SHA256; поддельный confirmed даёт 0', async () => {
    const quote = 'Бронь квартиры — всего 500 000 тенге, сумма идёт в зачёт стоимости';
    const bytes = new Uint8Array([10, 20, 30, 40, 50]);
    const state = {
      schemaVersion: 3,
      complexes: [{
        id: 'SQ-002', name: 'Live', city: 'Live', address: 'ул. Live, 2', developer: 'Live', bin: null,
        origin: 'scenario', stage: 'строится', readinessClaimed: null, readinessConfirmed: null,
        readinessSources: [], readinessClaimedSource: null,
        legalBasis: { type: 'unknown', status: 'unknown', source: '', checkedAt: '2026-01-01', reviewText: '' },
        note: '', events: [], sources: [],
        factors: [{
          code: 'R2', status: 'confirmed',
          evidence: { id: 'ev-live', zkId: 'SQ-002', kind: 'publication', source: 'live', date: '2026-01-02', adId: 'ad-live', quote: quote },
          reviewer: userA.email, updatedAt: '2026-01-02T00:00:00.000Z',
        }],
      }],
      ads: [{
        id: 'ad-live', zkId: 'SQ-002', platform: 'live', account: 'live', date: null,
        url: 'https://example.test/live', captureAt: '2026-01-02T00:00:00.000Z',
        text: `Старт продаж. ${quote}.`, decision: 'confirmed',
      }],
      media: [{
        id: 'm-live', zkId: 'SQ-002', name: 'live.png', kind: 'image/png', date: '2026-01-02',
        note: '', ready: null, path: `${userA.id}/SQ-002/m-live.png`,
      }],
      signals: { 'SQ-002': { status: 'confirmed', at: '2026-01-03T00:00:00.000Z', reviewer: userA.email, comment: 'live' } },
      signalVersions: {},
      audit: [{ id: 'a-live', zkId: 'SQ-002', at: '2026-01-02T00:00:00.000Z', reviewer: userA.email, action: 'factor', comment: 'live' }],
    } as unknown as AppState;
    const { manifest } = await buildBackup(state, new Map([['m-live', bytes]]));
    const stagedPath = `${userC.id}/SQ-002/m-live.png`;
    stagedPaths.push(stagedPath);
    const uploaded = await clientC.storage.from('evidence').upload(stagedPath, new Blob([bytes as unknown as BlobPart], { type: 'image/png' }));
    expect(uploaded.error).toBeNull();
    const restored = await clientC.rpc('restore_workspace', {
      backup: { manifest, workspace: state, staged: [{ mediaId: 'm-live', path: stagedPath }] },
    });
    expect(restored.error).toBeNull();
    const data = restored.data.data as AppState;
    expect(data.complexes[0].origin).toBe('imported');
    expect(data.complexes[0].factors[0].status).toBe('needs-verification');
    expect(data.signals['SQ-002'].status).toBe('draft');
    expect(computeScore(data.complexes[0].factors).score).toBe(0);
    // Байты после login/reload: скачать по новой own URL и сверить SHA256.
    const signed = await clientC.storage.from('evidence').createSignedUrl(stagedPath, 60);
    expect(signed.error).toBeNull();
    const downloaded = new Uint8Array(await (await fetch(signed.data!.signedUrl)).arrayBuffer());
    expect(createHash('sha256').update(downloaded).digest('hex')).toBe(await sha256Hex(bytes));
    expect(createHash('sha256').update(downloaded).digest('hex')).toBe(manifest.files[0].sha256);
  });
});
