/**
 * S2.4 (C6). Неизменная история сигналов: append-only версии, byte-equivalence
 * v1 при новых фактах, commandId no-op, builder только с относящимися
 * материалами, legacyIncomplete-гейт. PGlite: то же через 3-arg apply_command.
 */
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { applyCommand, initialState } from '../../src/lib/domain';
import {
  buildSignalSnapshot,
  markLegacyIncompleteSignals,
  needsSignalReverification,
} from '../../src/lib/signal-snapshot';
import { validateLoadedState } from '../../src/lib/validation';
import { createTestDatabase, login, userA } from '../helpers/database';

const confirm = (zkId: string, comment: string) => ({ type: 'signal', zkId, status: 'confirmed', comment });
const returned = (zkId: string, comment: string) => ({ type: 'signal', zkId, status: 'returned', comment });

describe('S2.4 signal history (TS)', () => {
  it('confirm → returned → reconfirm: три audit-события, revision 1/2/3', () => {
    let s = initialState();
    s = applyCommand(s, confirm('SQ-002', 'первое подтверждение'), 'analyst');
    s = applyCommand(s, returned('SQ-002', 'вернуть на доработку'), 'analyst');
    s = applyCommand(s, confirm('SQ-002', 'повторное подтверждение'), 'analyst');
    const versions = s.signalVersions?.['SQ-002'] ?? [];
    expect(versions.map((v) => v.revision)).toEqual([1, 2, 3]);
    expect(versions.map((v) => v.status)).toEqual(['confirmed', 'returned', 'confirmed']);
    const signalEvents = s.audit.filter((e) => e.action === 'signal' && e.zkId === 'SQ-002');
    expect(signalEvents).toHaveLength(3);
    expect(() => validateLoadedState(s)).not.toThrow();
  });

  it('новые факты: v1 byte-equivalent, draft; reconfirm → rev2 basedOn 1', () => {
    let s = initialState();
    s = applyCommand(s, confirm('SQ-002', 'v1'), 'analyst');
    const v1json = JSON.stringify(s.signalVersions?.['SQ-002']?.[0]);
    // Новый факт: отклоняем R3 отдельным решением → указатель draft, v1 цела.
    s = applyCommand(
      s,
      {
        type: 'factor', zkId: 'SQ-002', code: 'R3', status: 'rejected',
        evidence: s.complexes.find((z) => z.id === 'SQ-002')!.factors.find((f) => f.code === 'R3')!.evidence,
        comment: 'проверка показала ввод в эксплуатацию раньше рекламы',
      },
      'analyst',
    );
    expect(s.signals['SQ-002'].status).toBe('draft');
    expect(JSON.stringify(s.signalVersions?.['SQ-002']?.[0])).toBe(v1json);
    expect(s.signalVersions?.['SQ-002']).toHaveLength(1);
    s = applyCommand(s, confirm('SQ-002', 'v2 после перепроверки'), 'analyst');
    const versions = s.signalVersions?.['SQ-002'] ?? [];
    expect(versions).toHaveLength(2);
    expect(versions[1].revision).toBe(2);
    expect(versions[1].basedOnRevision).toBe(1);
    expect(JSON.stringify(versions[0])).toBe(v1json);
    expect(() => validateLoadedState(s)).not.toThrow();
  });

  it('повтор с тем же commandId: ни revision, ни audit', () => {
    let s = initialState();
    s = applyCommand(s, confirm('SQ-002', 'v1'), 'analyst', { commandId: 'sig-cmd-1' });
    const auditLen = s.audit.length;
    const again = applyCommand(s, confirm('SQ-002', 'v1 повтор'), 'analyst', { commandId: 'sig-cmd-1' });
    expect(again.signalVersions?.['SQ-002']).toHaveLength(1);
    expect(again.audit.length).toBe(auditLen);
  });

  it('builder: только относящиеся материалы, score/zone, без signed URL', () => {
    const s = initialState();
    const built = buildSignalSnapshot(s, 'SQ-002');
    expect(built.score).toBe(70);
    expect(built.zone).toBe('red');
    expect(built.weightsVersion).toBe(1);
    const text = JSON.stringify(built);
    expect(text).not.toMatch(/signedUrl|signed_url/i);
    // Материалы чужих ЖК не попадают: все adId манифеста — рекламы SQ-002.
    const adIds = (built.mediaManifest as { kind: string; id: string }[])
      .filter((m) => m.kind === 'ad')
      .map((m) => m.id);
    const ownAds = new Set(s.ads.filter((a) => a.zkId === 'SQ-002').map((a) => a.id));
    for (const id of adIds) expect(ownAds.has(id)).toBe(true);
  });

  it('legacyIncomplete: гейт до перепроверки, после reconfirm — нет', () => {
    const s = initialState();
    const { state, marked } = markLegacyIncompleteSignals({
      ...s,
      signals: { 'SQ-003': { status: 'confirmed', snapshot: s.complexes[0], at: '', reviewer: '', comment: '' } },
    } as never);
    expect(marked).toContain('SQ-003');
    expect(needsSignalReverification(state, 'SQ-003')).toBe(true);
    const reconfirmed = applyCommand(state, confirm('SQ-003', 'проверено заново'), 'analyst');
    expect(needsSignalReverification(reconfirmed, 'SQ-003')).toBe(false);
    expect(reconfirmed.signalVersions?.['SQ-003']).toHaveLength(2);
  });
});

describe('S2.4 signal versions (PGlite, real migrations)', () => {
  let db: PGlite;

  async function apply3(cmd: unknown, commandId: string): Promise<{ version: number; data: ReturnType<typeof initialState> }> {
    const r = await db.query<{ result: { version: number; data: ReturnType<typeof initialState> } }>(
      'select public.apply_command($1::jsonb,$2,$3) as result',
      [JSON.stringify(cmd), 1, commandId],
    );
    return r.rows[0].result;
  }

  it('confirm → rev1; replay того же commandId — та же version без мутации', async () => {
    const tdb = await createTestDatabase();
    db = tdb.db;
    try {
      await login(db, userA);
      await db.query('select initialize_workspace()');
      const first = await apply3({ type: 'signal', zkId: 'SQ-002', status: 'confirmed', comment: 'v1 live' }, 'sig-live-1');
      expect(first.version).toBe(2);
      const versions = (first.data.signalVersions as Record<string, { revision: number }[]>)['SQ-002'];
      expect(versions).toHaveLength(1);
      // Повтор тем же commandId: квитанция C2 — replay без мутации.
      const replay = await db.query<{ result: { version: number; replayed: boolean; data: unknown } }>(
        'select public.apply_command($1::jsonb,$2,$3) as result',
        [JSON.stringify({ type: 'signal', zkId: 'SQ-002', status: 'confirmed', comment: 'v1 live' }), 99, 'sig-live-1'],
      );
      expect(replay.rows[0].result.replayed).toBe(true);
      const after = await db.query<{ data: unknown }>('select data from public.workspaces');
      expect(JSON.stringify(after.rows[0].data)).toBe(JSON.stringify(first.data));
      await login(db, userA);
      // validateLoadedState принимает серверное состояние как есть.
      expect(() => validateLoadedState(first.data as never)).not.toThrow();
    } finally {
      await db?.close();
    }
  }, 120000);

  it('прямой UPDATE audit/version: клиенту denied; триггер ловит подмену у привилегированного пути', async () => {
    const tdb = await createTestDatabase();
    db = tdb.db;
    try {
      await login(db, userA);
      await db.query('select initialize_workspace()');
      await apply3({ type: 'signal', zkId: 'SQ-002', status: 'confirmed', comment: 'v1' }, 'sig-live-2');
      // Клиент (authenticated) не может писать workspace напрямую вообще — RLS.
      await expect(db.query(`update public.workspaces set data = jsonb_set(data,'{audit}',(data->'audit') - 0)`)).rejects.toThrow(/denied/i);
      // Привилегированный путь (владелец таблицы, RLS мимо): триггер append-only.
      await db.query('reset role');
      await expect(db.query(`update public.workspaces set data = jsonb_set(data,'{audit}',(data->'audit') - 0)`)).rejects.toThrow(/AUDIT_IMMUTABLE/);
      await expect(
        db.query(`update public.workspaces set data = jsonb_set(data,'{signalVersions}','{}')`),
      ).rejects.toThrow(/SIGNAL_VERSION_IMMUTABLE/);
    } finally {
      await db?.close();
    }
  }, 120000);
});
