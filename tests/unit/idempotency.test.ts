/**
 * S2.2 (C2) + S2.3 (C3). Идемпотентность, квитанции, конфликты, сессии,
 * атомарность publication+media — БЕЗ моков Auth/Storage:
 *  - SQL: настоящий PGlite со ВСЕМИ реальными миграциями (включая новую
 *    s2_2_receipts), настоящие auth.uid()/RLS/storage.objects;
 *  - repository DEMO: настоящий код, настоящее сериализованное состояние
 *    (память вместо localStorage в node, память вместо IndexedDB).
 * Сессии — как временные аккаунты connected-режима (userA/userB) + перемена
 * пользователя на уровне repository (sessionGeneration).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, login, userA, userB } from '../helpers/database';
import type { Command } from '../../src/lib/domain';
import {
  attachStagedMedia,
  clearPendingCommand,
  commitCommand,
  getSessionGeneration,
  listCleanupRetries,
  loadState,
  readPendingCommand,
  recordCleanupRetry,
  removeStagedFile,
  resetDemo,
  retryPendingCleanups,
  retryPendingCommand,
  saveCommand,
  SessionSupersededError,
  stageFileForCommand,
  stagedPathsFor,
  trackAuthSession,
  unstageFileForCommand,
  uploadFile,
  withCommandId,
} from '../../src/lib/repository';

const D = '2026-10-10';

const complexCmd = (id: string) => ({
  type: 'complex',
  complex: {
    id,
    name: `Synthetic ${id} (DEMO)`,
    city: 'Өскемен',
    address: `synthetic address ${id}`,
    developer: 'Synthetic Developer (DEMO)',
    bin: null,
    origin: 'test',
    stage: 'строится',
    readinessClaimed: null,
    readinessConfirmed: null,
    readinessSources: [],
    readinessClaimedSource: null,
    legalBasis: { type: 'unknown', status: 'unknown', source: '', checkedAt: D, reviewText: '' },
    note: 'synthetic fixture S2.2',
    factors: [],
    events: [],
    sources: [],
  },
});

const adCmd = (id: string, zkId: string, text: string): Command =>
  ({
    type: 'ad',
    ad: {
      id,
      zkId,
      platform: 'krisha (DEMO)',
      account: 'demo',
      date: '2026-10-05',
      url: 'https://example.test/a',
      captureAt: '2026-10-06',
      text,
    },
    decision: 'saved',
    comment: 'Решение аналитика (synthetic S2.2)',
  }) as unknown as Command;

const SHA64 = 'a'.repeat(64);
const mediaObj = (mid: string, zkId: string, owner: string, over: Record<string, unknown> = {}) => ({
  id: mid,
  zkId,
  name: `${mid}.png`,
  kind: 'image/png',
  date: D,
  note: 'synthetic S2.3',
  ready: null,
  path: `${owner}/${zkId}/${mid}.png`,
  bytes: 4,
  sha256: SHA64,
  ...over,
});

/* ------------------------------------------------------------------ */
/* SQL-уровень: квитанции, конфликты, сессии, вложения, Storage-policy */
/* ------------------------------------------------------------------ */

describe('S2.2 receipts/conflicts/session (SQL, real migrations)', () => {
  let db: PGlite;
  let v = 1;

  beforeAll(async () => {
    const tdb = await createTestDatabase();
    db = tdb.db;
    await login(db, userA);
    await db.query('select initialize_workspace()');
    v = 1;
    // Временные аккаунты S2.2: второй пользователь для session-тестов.
    await login(db, userB);
    await db.query('select initialize_workspace()');
    await login(db, userA);
  }, 120000);

  afterAll(async () => {
    await db?.close();
  });

  async function apply3(cmd: unknown, cid: string, ver = v) {
    const r = await db.query<{ result: { data: unknown; version: number; replayed: boolean; appliedVersion: number; commandId: string } }>(
      'select public.apply_command($1::jsonb,$2,$3) as result',
      [JSON.stringify(cmd), ver, cid],
    );
    return r.rows[0].result;
  }

  async function counts(): Promise<{ version: number; audit: number; ads: number; media: number }> {
    const r = await db.query<{ version: number; audit: number; ads: number; media: number }>(
      "select version, jsonb_array_length(data->'audit') as audit, jsonb_array_length(data->'ads') as ads, jsonb_array_length(data->'media') as media from workspaces where owner_id = current_setting('request.jwt.claim.sub')::uuid",
    );
    return r.rows[0];
  }

  it('same commandId+payload twice → one audit, one version bump, replayed second', async () => {
    const cmd = complexCmd('SQ-R1');
    const before = await counts();
    const r1 = await apply3(cmd, 'cid-s22-01');
    expect(r1.replayed).toBe(false);
    expect(r1.version).toBe(before.version + 1);
    v = r1.version;
    const r2 = await apply3(cmd, 'cid-s22-01');
    expect(r2.replayed).toBe(true);
    expect(r2.appliedVersion).toBe(r1.version);
    expect(r2.version).toBe(r1.version);
    expect(r2.commandId).toBe('cid-s22-01');
    const after = await counts();
    expect(after.version).toBe(before.version + 1);
    expect(after.audit).toBe(before.audit + 1);
    // Аудит несёт квитанцию намерения и серверного автора.
    const audit = await db.query<{ e: { commandId?: string; actorId?: string; before?: unknown; after?: unknown } }>(
      "select (data->'audit'->0) as e from workspaces where owner_id = current_setting('request.jwt.claim.sub')::uuid",
    );
    expect(audit.rows[0].e.commandId).toBe('cid-s22-01');
    expect(typeof audit.rows[0].e.actorId).toBe('string');
  }, 120000);

  it('same commandId + different payload → COMMAND_ID_REUSED, state frozen', async () => {
    const before = await counts();
    const other = { ...complexCmd('SQ-R1'), comment: 'другое содержимое' };
    await expect(apply3(other, 'cid-s22-01')).rejects.toThrow(/COMMAND_ID_REUSED/);
    expect(await counts()).toEqual(before);
  }, 120000);

  it('canonical JSONB compare: key order does not matter for replay', async () => {
    // Тот же payload cid-s22-01, но ключи в другом порядке — replay, не REUSED.
    const shuffled = JSON.parse(
      JSON.stringify(complexCmd('SQ-R1')),
      // Пересобираем объект с обратным порядком ключей верхнего уровня.
    ) as Record<string, unknown>;
    const reordered: Record<string, unknown> = {};
    for (const k of Object.keys(shuffled).reverse()) reordered[k] = shuffled[k];
    const r = await apply3(reordered, 'cid-s22-01');
    expect(r.replayed).toBe(true);
  }, 120000);

  it('lost-after-commit: retry with stale expected_version replays without dup', async () => {
    const cmd = adCmd('AD-R1', 'SQ-R1', 'Внесите задаток 111 000 тенге за квартиру в SQ-R1.');
    const staleSeen = v;
    const r1 = await apply3(cmd, 'cid-s22-04');
    v = r1.version;
    const before = await counts();
    // Ответ потерян; клиент повторяет тем же ID со СТАРОЙ версией —
    // квитанция срабатывает раньше stale check.
    const r2 = await apply3(cmd, 'cid-s22-04', staleSeen);
    expect(r2.replayed).toBe(true);
    expect(r2.appliedVersion).toBe(r1.version);
    expect(await counts()).toEqual(before);
  }, 120000);

  it('two tabs, one expected_version → one wins, second STALE; reread + new decision applies', async () => {
    const both = v;
    const win = await apply3(adCmd('AD-R2A', 'SQ-R1', 'Платная бронь 222 000 тенге за квартиру.'), 'cid-s22-05a', both);
    v = win.version;
    await expect(apply3(adCmd('AD-R2B', 'SQ-R1', 'Платная бронь 333 000 тенге за квартиру.'), 'cid-s22-05b', both)).rejects.toThrow(
      /STALE_VERSION/,
    );
    // Вторая вкладка перечитала и приняла НОВОЕ решение явно (не автоматически).
    const before = await counts();
    const retry = await apply3(adCmd('AD-R2B', 'SQ-R1', 'Платная бронь 333 000 тенге за квартиру.'), 'cid-s22-05b', v);
    expect(retry.replayed).toBe(false);
    v = retry.version;
    const after = await counts();
    expect(after.version).toBe(before.version + 1);
    expect(after.audit).toBe(before.audit + 1);
    expect(after.ads).toBe(before.ads + 1);
  }, 120000);

  it('temp-account session: B reuses the same commandId string independently; A receipt intact', async () => {
    await login(db, userB);
    const bCmd = complexCmd('SQ-RB');
    const rb = await db.query<{ result: { version: number; replayed: boolean } }>(
      'select public.apply_command($1::jsonb,$2,$3) as result',
      [JSON.stringify(bCmd), 1, 'cid-s22-01'],
    );
    // Тот же ID у другого владельца — независимая квитанция, не REUSED.
    expect(rb.rows[0].result.replayed).toBe(false);
    expect(rb.rows[0].result.version).toBe(2);
    // B не видит workspace A.
    const seen = await db.query<{ n: number }>(
      "select count(*)::int as n from workspaces where data::text like '%SQ-R1%' and owner_id = current_setting('request.jwt.claim.sub')::uuid",
    );
    expect(seen.rows[0].n).toBe(0);
    await login(db, userA);
    // Квитанция A на месте: повтор — replay, не новая запись.
    const before = await counts();
    const r = await apply3(complexCmd('SQ-R1'), 'cid-s22-01');
    expect(r.replayed).toBe(true);
    expect(await counts()).toEqual(before);
  }, 120000);

  it('old 2-arg write signature is revoked for clients', async () => {
    await login(db, userA);
    // C2: второй доступной write-версии нет — DROP сильнее revoke: функции нет вовсе.
    await expect(
      db.query('select public.apply_command($1::jsonb,$2)', [JSON.stringify(complexCmd('SQ-REVOKED')), v]),
    ).rejects.toThrow(/permission denied|does not exist/i);
  }, 120000);

  it('no direct receipt DML for clients', async () => {
    await login(db, userA);
    await expect(db.query("insert into public.command_receipts(owner_id,command_id,payload,result_version) values(current_setting('request.jwt.claim.sub')::uuid,'x','{}',1)")).rejects.toThrow(
      /denied|policy/i,
    );
    await expect(db.query('select * from public.command_receipts')).rejects.toThrow(/denied|policy/i);
  }, 120000);
});

describe('S2.3 evidence atomicity + storage checks (SQL, real migrations)', () => {
  let db: PGlite;
  let v = 1;

  beforeAll(async () => {
    const tdb = await createTestDatabase();
    db = tdb.db;
    await login(db, userA);
    await db.query('select initialize_workspace()');
    v = 1;
    const r = await db.query<{ result: { version: number } }>('select public.apply_command($1::jsonb,$2,$3) as result', [
      JSON.stringify(complexCmd('SQ-M1')),
      v,
      'cid-s23-setup',
    ]);
    v = r.rows[0].result.version;
  }, 120000);

  afterAll(async () => {
    await db?.close();
  });

  async function apply3(cmd: unknown, cid: string, ver = v) {
    const r = await db.query<{ result: { data: unknown; version: number; replayed: boolean; appliedVersion: number } }>(
      'select public.apply_command($1::jsonb,$2,$3) as result',
      [JSON.stringify(cmd), ver, cid],
    );
    v = r.rows[0].result.version;
    return r.rows[0].result;
  }

  async function counts(): Promise<{ version: number; audit: number; ads: number; media: number }> {
    const r = await db.query<{ version: number; audit: number; ads: number; media: number }>(
      "select version, jsonb_array_length(data->'audit') as audit, jsonb_array_length(data->'ads') as ads, jsonb_array_length(data->'media') as media from workspaces where owner_id = current_setting('request.jwt.claim.sub')::uuid",
    );
    return r.rows[0];
  }

  async function stageObject(path: string, size: number | null, mimetype: string | null) {
    await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb)', [
      'evidence',
      path,
      JSON.stringify({ ...(size == null ? {} : { size }), ...(mimetype == null ? {} : { mimetype }) }),
    ]);
  }

  it('foreign owner prefix → INVALID_STORAGE_PATH', async () => {
    const before = await counts();
    const cmd = { type: 'media', media: mediaObj('m-f1', 'SQ-M1', userB) };
    await expect(apply3(cmd, 'cid-s23-f1')).rejects.toThrow(/INVALID_STORAGE_PATH/);
    expect(await counts()).toEqual(before);
  }, 120000);

  it('zkId segment mismatch → INVALID_STORAGE_PATH', async () => {
    const before = await counts();
    const path = `${userA}/SQ-OTHER/m-f2.png`;
    await stageObject(path, 4, 'image/png');
    const cmd = { type: 'media', media: mediaObj('m-f2', 'SQ-M1', userA, { path }) };
    await expect(apply3(cmd, 'cid-s23-f2')).rejects.toThrow(/INVALID_STORAGE_PATH/);
    expect(await counts()).toEqual(before);
  }, 120000);

  it('missing storage object → STORAGE_OBJECT_NOT_FOUND', async () => {
    const before = await counts();
    const cmd = { type: 'media', media: mediaObj('m-f3', 'SQ-M1', userA) };
    await expect(apply3(cmd, 'cid-s23-f3')).rejects.toThrow(/STORAGE_OBJECT_NOT_FOUND/);
    expect(await counts()).toEqual(before);
  }, 120000);

  it('claimed bytes/kind vs storage metadata mismatch → STORAGE_META_MISMATCH', async () => {
    const before = await counts();
    const path = `${userA}/SQ-M1/m-f4.png`;
    await stageObject(path, 4, 'image/png');
    await expect(apply3({ type: 'media', media: mediaObj('m-f4', 'SQ-M1', userA, { bytes: 999 }) }, 'cid-s23-f4a')).rejects.toThrow(
      /STORAGE_META_MISMATCH/,
    );
    await expect(
      apply3({ type: 'media', media: mediaObj('m-f4b', 'SQ-M1', userA, { path: `${userA}/SQ-M1/m-f4b.png` }) }, 'cid-s23-f4b'),
    ).rejects.toThrow(/STORAGE_OBJECT_NOT_FOUND/);
    const pathB = `${userA}/SQ-M1/m-f4c.png`;
    await stageObject(pathB, 4, 'image/jpeg');
    await expect(
      apply3({ type: 'media', media: mediaObj('m-f4c', 'SQ-M1', userA, { path: pathB }) }, 'cid-s23-f4c'),
    ).rejects.toThrow(/STORAGE_META_MISMATCH/);
    expect(await counts()).toEqual(before);
  }, 120000);

  it('oversize / disallowed type in storage metadata → reject', async () => {
    const before = await counts();
    const big = `${userA}/SQ-M1/m-f5.png`;
    await stageObject(big, 20971521, 'image/png');
    await expect(apply3({ type: 'media', media: mediaObj('m-f5', 'SQ-M1', userA) }, 'cid-s23-f5')).rejects.toThrow(
      /STORAGE_OBJECT_TOO_LARGE/,
    );
    const exe = `${userA}/SQ-M1/m-f6.png`;
    await stageObject(exe, 4, 'application/x-msdownload');
    await expect(apply3({ type: 'media', media: mediaObj('m-f6', 'SQ-M1', userA) }, 'cid-s23-f6')).rejects.toThrow(
      /STORAGE_OBJECT_TYPE/,
    );
    expect(await counts()).toEqual(before);
  }, 120000);

  it('ad + mediaAttachment commits atomically: one version, one audit, both stored', async () => {
    const path = `${userA}/SQ-M1/m-ok.png`;
    await stageObject(path, 4, 'image/png');
    const before = await counts();
    const cmd = {
      ...adCmd('AD-OK', 'SQ-M1', 'Опубликовано: платная бронь 444 000 тенге, объект SQ-M1.'),
      mediaAttachment: mediaObj('m-ok', 'SQ-M1', userA),
    };
    const r = await apply3(cmd, 'cid-s23-ok');
    expect(r.replayed).toBe(false);
    const after = await counts();
    expect(after.version).toBe(before.version + 1);
    expect(after.audit).toBe(before.audit + 1);
    expect(after.ads).toBe(before.ads + 1);
    expect(after.media).toBe(before.media + 1);
  }, 120000);

  it('bad attachment rolls back the ad too (atomicity)', async () => {
    const before = await counts();
    const cmd = {
      ...adCmd('AD-BAD', 'SQ-M1', 'Опубликовано: платная бронь 555 000 тенге, объект SQ-M1.'),
      mediaAttachment: mediaObj('m-ghost', 'SQ-M1', userA),
    };
    await expect(apply3(cmd, 'cid-s23-bad')).rejects.toThrow(/STORAGE_OBJECT_NOT_FOUND/);
    expect(await counts()).toEqual(before);
  }, 120000);

  it('storage DELETE: referenced file blocked, unreferenced staged file deletable', async () => {
    await login(db, userA);
    const ref = `${userA}/SQ-M1/m-ok.png`;
    const delRef = await db.query('delete from storage.objects where bucket_id=$1 and name=$2', ['evidence', ref]);
    expect(delRef.rows.length).toBe(0);
    const still = await db.query('select name from storage.objects where bucket_id=$1 and name=$2', ['evidence', ref]);
    expect(still.rows.length).toBe(1);
    const staged = `${userA}/SQ-M1/staged-orphan.png`;
    await stageObject(staged, 4, 'image/png');
    const delStaged = await db.query('delete from storage.objects where bucket_id=$1 and name=$2', ['evidence', staged]);
    expect(delStaged.rows.length).toBe(0); // RLS DELETE возвращает 0 строк при успехе; проверяем ниже
    const gone = await db.query('select name from storage.objects where bucket_id=$1 and name=$2', ['evidence', staged]);
    expect(gone.rows.length).toBe(0);
  }, 120000);
});

/* ------------------------------------------------------------------ */
/* repository DEMO: очередь, pending, сессии, staged/cleanup (node)    */
/* ------------------------------------------------------------------ */

describe('S2.2 repository DEMO: queue, pending, session (no mocks)', () => {
  beforeEach(async () => {
    await resetDemo();
    trackAuthSession(null);
  });

  it('same commandId twice → single audit; retry replays (lost-response safe)', async () => {
    const base = await loadState();
    const cmd = withCommandId(adCmd('AD-D1', 'SQ-001', 'Демо-бронь 666 000 тенге за квартиру.'), 'cid-demo-01');
    const r1 = await commitCommand(base, cmd, 'unit-test');
    expect(r1.replayed).toBe(false);
    const r2 = await commitCommand(r1.state, cmd, 'unit-test');
    expect(r2.replayed).toBe(true);
    expect(r2.appliedVersion).toBe(r1.version);
    expect(r2.state.audit.length).toBe(1);
    expect(readPendingCommand()).toBeNull();
  });

  it('same commandId + changed payload → COMMAND_ID_REUSED', async () => {
    const base = await loadState();
    const original = withCommandId(adCmd('AD-D1', 'SQ-001', 'Демо-бронь 666 000 тенге за квартиру.'), 'cid-demo-01');
    await commitCommand(base, original, 'unit-test');
    const other = withCommandId(adCmd('AD-D1', 'SQ-001', 'Демо-бронь 666 000 тенге за квартиру.') as never, 'cid-demo-01');
    (other as unknown as Record<string, unknown>)['comment'] = 'изменено';
    await expect(commitCommand(base, other, 'unit-test')).rejects.toThrow(/COMMAND_ID_REUSED/);
  });

  it('failed command keeps pending with user stamp; foreign session cannot retry it', async () => {
    const base = await loadState();
    trackAuthSession('unit-test');
    const bad = withCommandId({ type: 'media', media: { id: 'x', zkId: 'SQ-NOPE', path: 'demo/SQ-NOPE/x.png' } } as never, 'cid-demo-pend');
    await expect(commitCommand(base, bad, 'unit-test')).rejects.toThrow();
    const pending = readPendingCommand();
    expect(pending?.commandId).toBe('cid-demo-pend');
    // Pending is bound to the selected session, independently of reviewer text.
    expect(pending?.user).toBe('unit-test');
    trackAuthSession('unit-other');
    await expect(retryPendingCommand(base, 'unit-other')).rejects.toThrow(/другой сессии/);
    trackAuthSession('unit-test');
    clearPendingCommand('cid-demo-pend');
    expect(readPendingCommand()).toBeNull();
  });

  it('session switch cancels queued commands of the old session', async () => {
    const base = await loadState();
    trackAuthSession('unit-test');
    const gen = getSessionGeneration();
    const cmd = withCommandId(adCmd('AD-D2', 'SQ-001', 'Демо-бронь 777 000 тенге за квартиру.'), 'cid-demo-sup');
    const p = commitCommand(base, cmd, 'unit-test');
    trackAuthSession('unit-newcomer');
    let err: unknown = null;
    try {
      await p;
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SessionSupersededError);
    expect(getSessionGeneration()).toBe(gen + 1);
    // Поздний ответ старой сессии не заменил состояние.
    const fresh = await loadState();
    expect(fresh.ads.some((a) => a.id === 'AD-D2')).toBe(false);
    trackAuthSession('unit-test');
  });

  it('DEMO without a session stamps demo, not the displayed reviewer', async () => {
    trackAuthSession(null);
    const base = await loadState();
    const bad = withCommandId({ type: 'media', media: { id: 'x', zkId: 'SQ-NOPE', path: 'demo/SQ-NOPE/x.png' } } as never, 'cid-no-session');
    await expect(commitCommand(base, bad, 'Displayed analyst')).rejects.toThrow();
    expect(readPendingCommand()?.user).toBe('demo');
    clearPendingCommand('cid-no-session');
  });

  it('saveCommand keeps the legacy 3-arg signature working', async () => {
    const base = await loadState();
    const next = await saveCommand(base, adCmd('AD-D3', 'SQ-001', 'Демо-бронь 888 000 тенге за квартиру.'), 'unit-test');
    expect(next.ads.some((a) => a.id === 'AD-D3')).toBe(true);
  });
});

describe('S2.3 repository DEMO: stable upload, staged scope, cleanup ledger (no mocks)', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');

  beforeAll(async () => {
    await resetDemo();
    trackAuthSession('unit-test');
  });

  function testFile(name = 'shot.png'): File {
    return new File([png], name, { type: 'image/png' });
  }

  it('upload rejects bad type/oversize; stable mediaId keeps one path on retry', async () => {
    if (typeof File === 'undefined') {
      expect(typeof File).toBe('undefined');
      return;
    }
    await expect(uploadFile(new File(['x'], 'evil.txt', { type: 'text/plain' }), 'SQ-001')).rejects.toThrow(/Допустимы/);
    const big = new File([new Uint8Array(21 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    await expect(uploadFile(big, 'SQ-001')).rejects.toThrow(/Допустимы/);
    const m1 = await uploadFile(testFile(), 'SQ-001', { mediaId: 'm-stable-1' });
    const m2 = await uploadFile(testFile(), 'SQ-001', { mediaId: 'm-stable-1' });
    expect(m1.path).toBe(m2.path);
    expect(m1.path).toBe('demo/SQ-001/m-stable-1.png');
    expect(m1.bytes).toBe(png.length);
  });

  it('staged scope: only this commandId files removable; cleanup ledger round-trips', async () => {
    if (typeof File === 'undefined') return;
    const m = await uploadFile(testFile(), 'SQ-001', { mediaId: 'm-staged-1' });
    stageFileForCommand('cid-staged-1', m.path);
    expect(stagedPathsFor('cid-staged-1')).toEqual([m.path]);
    await expect(removeStagedFile(m.path, 'cid-other')).rejects.toThrow(/не staged/);
    await removeStagedFile(m.path, 'cid-staged-1');
    expect(stagedPathsFor('cid-staged-1')).toEqual([]);
    recordCleanupRetry('demo/SQ-001/ghost-1.bin');
    expect(listCleanupRetries()).toEqual(['demo/SQ-001/ghost-1.bin']);
    const drained = await retryPendingCleanups();
    expect(drained.removed).toEqual(['demo/SQ-001/ghost-1.bin']);
    expect(listCleanupRetries()).toEqual([]);
    unstageFileForCommand('cid-staged-1');
  });

  it('ad+attachment: single audit/version, both stored; ghost attachment rolls back', async () => {
    if (typeof File === 'undefined') return;
    const base = await loadState();
    const m = await uploadFile(testFile(), 'SQ-001', { mediaId: 'm-bundle-1' });
    const before = { audit: base.audit.length, ads: base.ads.length, media: base.media.length };
    const cmd = withCommandId(
      attachStagedMedia(adCmd('AD-BUNDLE', 'SQ-001', 'Демо-бронь 999 000 тенге за квартиру с фото.'), m),
      'cid-bundle-1',
    );
    const r = await commitCommand(base, cmd, 'unit-test');
    expect(r.replayed).toBe(false);
    expect(r.state.audit.length).toBe(before.audit + 1);
    expect(r.state.ads.length).toBe(before.ads + 1);
    expect(r.state.media.length).toBe(before.media + 1);
    expect(r.state.audit[0].commandId).toBe('cid-bundle-1');
    const ghost = { ...m, id: 'm-ghost-x', path: 'demo/SQ-001/m-ghost-x.png' };
    const bad = withCommandId(
      attachStagedMedia(adCmd('AD-GHOST', 'SQ-001', 'Демо-бронь 000 000 тенге за квартиру-призрак.'), ghost),
      'cid-bundle-2',
    );
    await expect(commitCommand(r.state, bad, 'unit-test')).rejects.toThrow(/STORAGE_OBJECT_NOT_FOUND/);
    const fresh = await loadState();
    expect(fresh.ads.some((a) => a.id === 'AD-GHOST')).toBe(false);
  });
});
