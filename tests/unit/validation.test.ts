/**
 * S1.1 (C1). Схема команд и минимальные доказательства.
 * Каждый reject-кейс: отказ + полная неизменность state (включая audit).
 * SQL-блок доказывает, что проверки повторены сервером: version/audit
 * workspace не двигаются при отказе.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { applyCommand, initialState } from '../../src/lib/domain';
import type { AppState } from '../../src/lib/types';
import { command, createTestDatabase, login } from '../helpers/database';

const REVIEWER = 'server-analyst';

function expectReject(state: AppState, cmd: unknown, pattern: RegExp) {
  const before = structuredClone(state);
  expect(() => applyCommand(state, cmd, REVIEWER)).toThrow(pattern);
  expect(state).toEqual(before);
}

const factorCmd = (over: Record<string, unknown> = {}) => ({
  type: 'factor', zkId: 'SQ-001', code: 'R3', status: 'needs-verification',
  evidence: { source: 'Демонстрационный акт сверки', date: '2026-10-10' },
  comment: 'Проверено аналитиком', ...over,
});

function complexCmd(over: Record<string, unknown> = {}) {
  const z = initialState().complexes[0];
  return {
    type: 'complex',
    complex: {
      ...z,
      legalBasis: { type: 'unknown', status: 'unknown', source: '', checkedAt: '2026-10-10', reviewText: '' },
      readinessClaimedSource: { value: z.readinessClaimed, source: 'Сайт застройщика (DEMO-снимок)', date: '2026-10-02' },
      ...over,
    },
  };
}

describe('S1.1 command schema rejects (TS)', () => {
  it('rejects unknown code/status/type', () => {
    const state = initialState();
    expectReject(state, factorCmd({ code: 'R9' }), /неизвестный код/);
    expectReject(state, factorCmd({ status: 'approved' }), /неизвестный статус/);
    expectReject(state, { type: 'teleport', zkId: 'SQ-001' }, /Неизвестный тип команды/);
    expectReject(state, { type: 'ad', ad: initialState().ads[0], decision: 'maybe', comment: 'x' }, /неизвестное решение/);
  });

  it('rejects missing zkId', () => {
    const state = initialState();
    const { zkId: _drop, ...noZk } = factorCmd();
    expectReject(state, noZk, /zkId/);
  });

  it('rejects smuggled reviewer (server assigns authorship)', () => {
    const state = initialState();
    expectReject(state, factorCmd({ reviewer: 'mallory' }), /reviewer назначает сервер/);
    expectReject(state, factorCmd({ evidence: { source: 'x', reviewer: 'mallory' } }), /reviewer назначает сервер/);
  });

  it('rejects impossible calendar dates (2026-02-30)', () => {
    const state = initialState();
    expectReject(state, factorCmd({ evidence: { source: 'x', date: '2026-02-30' } }), /evidence\.date/);
    expectReject(state, { type: 'readiness', zkId: 'SQ-001', value: 50, source: 'Осмотр', date: '2026-02-30' }, /readiness\.date/);
    expectReject(state, complexCmd({ legalBasis: { type: 'unknown', status: 'unknown', source: '', checkedAt: '2026-02-30', reviewText: '' } }), /checkedAt/);
    const ad = { ...initialState().ads[0], id: 'AD-t1', text: 'Уникальный текст объявления 001.', date: '2026-02-30' };
    expectReject(state, { type: 'ad', ad, decision: 'saved', comment: 'x' }, /ad\.date/);
  });

  it('rejects readiness -1/101/NaN/Infinity', () => {
    const state = initialState();
    for (const value of [-1, 101]) {
      expectReject(state, { type: 'readiness', zkId: 'SQ-001', value, source: 'Осмотр', date: '2026-10-10' }, /0–100/);
    }
    for (const value of [NaN, Infinity, -Infinity]) {
      expectReject(state, { type: 'readiness', zkId: 'SQ-001', value, source: 'Осмотр', date: '2026-10-10' }, /readiness\.value/);
    }
    expectReject(state, complexCmd({ readinessClaimed: NaN }), /readinessClaimed/);
  });

  it('rejects invalid coordinates', () => {
    const state = initialState();
    expectReject(state, complexCmd({ lat: 91 }), /широта/);
    expectReject(state, complexCmd({ lng: 200 }), /долгота/);
    expectReject(state, complexCmd({ lat: NaN }), /complex\.lat/);
  });

  it('rejects mismatched legalBasis pairs (guarantee + absent-verified)', () => {
    const state = initialState();
    const bad = { type: 'guarantee', status: 'absent-verified', source: 'x', checkedAt: '2026-10-10', reviewText: 'Сверено' };
    expectReject(state, complexCmd({ legalBasis: bad }), /несогласованная пара/);
    expectReject(state, complexCmd({ legalBasis: { ...bad, type: 'unknown', status: 'verified' } }), /несогласованная пара/);
    expectReject(state, complexCmd({ legalBasis: { ...bad, type: 'absent', status: 'verified' } }), /несогласованная пара/);
  });

  it('rejects empty required fields and missing analyst comment', () => {
    const state = initialState();
    expectReject(state, factorCmd({ status: 'confirmed', evidence: { source: '   ', date: '2026-10-10' } }), /источник/);
    expectReject(state, factorCmd({ comment: '   ' }), /комментарий аналитика/);
    expectReject(state, complexCmd({ name: '  ' }), /название и адрес/);
    const ad = { ...initialState().ads[0], id: 'AD-t2', text: '   ' };
    expectReject(state, { type: 'ad', ad, decision: 'saved', comment: 'x' }, /текст/);
    expectReject(state, complexCmd({ legalBasis: { type: 'guarantee', status: 'verified', source: 'Договор', checkedAt: '2026-10-10', reviewText: '   ' } }), /reviewText/);
  });

  it('rejects ambiguous IDs', () => {
    const state = initialState();
    expectReject(state, factorCmd({ zkId: '' }), /неоднозначный идентификатор/);
    expectReject(state, factorCmd({ zkId: 'SQ 001!' }), /неоднозначный идентификатор/);
    expectReject(state, factorCmd({ evidence: { source: 'x', zkId: 'SQ-002' } }), /другому объекту/);
    const ad = { ...initialState().ads[0], id: '', text: 'Уникальный текст объявления 002.' };
    expectReject(state, { type: 'ad', ad, decision: 'saved', comment: 'x' }, /ad\.id/);
  });

  it('keeps server reviewer as author and leaves audit untouched on reject', () => {
    const state = initialState();
    const auditBefore = state.audit.length;
    const next = applyCommand(state, { type: 'readiness', zkId: 'SQ-001', value: 50, source: 'Осмотр', date: '2026-10-10' }, REVIEWER);
    expect(next.audit).toHaveLength(auditBefore + 1);
    expect(next.audit[0].reviewer).toBe(REVIEWER);
    expect(state.audit).toHaveLength(auditBefore);
  });
});

/* ------------------------------------------------------------------ */
/* SQL повторяет проверки: отказ без движения version/audit.           */
/* ------------------------------------------------------------------ */

const userA = '11111111-1111-4111-8111-111111111111';
let db: PGlite;
afterEach(async () => { await db?.close(); });

async function setupSql() {
  const tdb = await createTestDatabase();
  db = tdb.db;
  await login(db, userA);
  await db.query('select initialize_workspace()');
}

async function workspaceVersion(): Promise<{ version: number; audit: number }> {
  const r = await db.query<{ version: number; audit: number }>(
    "select version, jsonb_array_length(data->'audit') as audit from workspaces",
  );
  return r.rows[0];
}

describe('S1.1 command schema rejects (SQL mirrors)', () => {
  it('rejects smuggled reviewer without touching version/audit', async () => {
    await setupSql();
    await expect(command(db, { ...JSON.parse(JSON.stringify(factorCmd())), reviewer: 'mallory' }, 1))
      .rejects.toThrow('REVIEWER_FORBIDDEN');
    expect(await workspaceVersion()).toEqual({ version: 1, audit: 0 });
  }, 60000);

  it('rejects impossible dates, mismatched legal pair and missing comment', async () => {
    await setupSql();
    await expect(command(db, { type: 'readiness', zkId: 'SQ-001', value: 50, source: 'Осмотр', date: '2026-02-30' }, 1))
      .rejects.toThrow('INVALID_OBSERVATION');
    const z = (await db.query<{ c: string }>("select (data->'complexes'->0)::text as c from workspaces")).rows[0].c;
    const complex = { ...JSON.parse(z), legalBasis: { type: 'guarantee', status: 'absent-verified', source: 'x', checkedAt: '2026-10-10', reviewText: 'y' } };
    await expect(command(db, { type: 'complex', complex }, 1)).rejects.toThrow('INVALID_LEGAL_BASIS');
    await expect(command(db, factorCmd({ comment: '' }), 1)).rejects.toThrow('COMMENT_REQUIRED');
    await expect(command(db, { type: 'factor', zkId: 'SQ-001', code: 'R9', status: 'confirmed', evidence: { source: 'x' }, comment: 'y' }, 1))
      .rejects.toThrow('INVALID_FACTOR');
    expect(await workspaceVersion()).toEqual({ version: 1, audit: 0 });
  }, 60000);
});
