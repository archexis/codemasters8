/**
 * S1.2 (C1). SQL-близнец корпуса I01–I18: прямые apply_command через
 * tests/helpers/database.ts. Каждый reject: код ошибки + version/audit
 * workspace неподвижны. Материалы — synthetic fixtures (DEMO).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { command, createTestDatabase, login } from '../helpers/database';

const userA = '11111111-1111-4111-8111-111111111111';
const COMMENT = 'Решение аналитика (synthetic fixture S1.2)';
const D = '2026-10-10';

let db: PGlite;
let version = 1;
afterEach(async () => { await db?.close(); });

async function setupSql() {
  const tdb = await createTestDatabase();
  db = tdb.db;
  await login(db, userA);
  await db.query('select initialize_workspace()');
  version = 1;
}

async function apply(cmd: unknown) {
  const r = await command(db, cmd, version);
  version = r.version;
  return r.data as unknown as {
    complexes: { id: string; factors: { code: string; status: string }[] }[];
    ads: { id: string }[];
  };
}

async function stateVersion(): Promise<{ version: number; audit: number; ads: number }> {
  const r = await db.query<{ version: number; audit: number; ads: number }>(
    "select version, jsonb_array_length(data->'audit') as audit, jsonb_array_length(data->'ads') as ads from workspaces",
  );
  return r.rows[0];
}

async function expectSqlReject(cmd: unknown, pattern: RegExp) {
  const before = await stateVersion();
  await expect(command(db, cmd, version)).rejects.toThrow(pattern);
  expect(await stateVersion()).toEqual(before);
}

async function scoreOf(zkId: string): Promise<number> {
  const weights: Record<string, number> = { R1: 35, R2: 25, R3: 10, R4: 15, R5: 10, R6: 5 };
  const r = await db.query<{ factors: { code: string; status: string }[] }>(
    'select (c.value->\'factors\') as factors from workspaces, jsonb_array_elements(data->\'complexes\') c where c.value->>\'id\'=$1',
    [zkId],
  );
  const seen = new Set<string>();
  let score = 0;
  for (const f of r.rows[0].factors) {
    if (f.status === 'confirmed' && !seen.has(f.code)) { seen.add(f.code); score += weights[f.code] ?? 0; }
  }
  return Math.min(100, score);
}

const legal = (type: string, status: string) => ({
  type, status, source: `Сверка ${type} (DEMO)`, checkedAt: D,
  reviewText: `Проверена область ${type}: результат зафиксирован аналитиком (DEMO)`,
});

const complexCmd = (id: string, over: Record<string, unknown> = {}) => ({
  type: 'complex',
  complex: {
    id, name: `Synthetic ${id} (DEMO)`, city: 'Өскемен', address: `synthetic address ${id}`,
    developer: 'Synthetic Developer (DEMO)', bin: null, origin: 'test', stage: 'строится',
    readinessClaimed: null, readinessConfirmed: null, readinessSources: [],
    readinessClaimedSource: null,
    legalBasis: { type: 'unknown', status: 'unknown', source: '', checkedAt: D, reviewText: '' },
    note: 'synthetic fixture S1.2', factors: [], events: [], sources: [], ...over,
  },
});

const adCmd = (id: string, zkId: string, text: string, extra: Record<string, unknown> = {}) => ({
  type: 'ad',
  ad: {
    id, zkId, platform: 'krisha (DEMO)', account: 'demo', date: '2026-10-05',
    url: 'https://example.test/a', captureAt: '2026-10-06', text,
  },
  decision: 'saved', comment: COMMENT, ...extra,
});

const factorCmd = (zkId: string, code: string, status: string, evidence: Record<string, unknown>, comment = COMMENT) => ({
  type: 'factor', zkId, code, status, evidence, comment,
});

describe('S1.2 decision corpus (SQL mirrors)', () => {
  it('I01–I03: R1 требует absent-verified + legal-review; повтор +35 один раз', async () => {
    await setupSql();
    await apply(complexCmd('SQ-I01', { legalBasis: legal('guarantee', 'verified') }));
    const t3 = 'Продаём квартиру в строящемся доме до ввода, гарантия действует.';
    await apply(adCmd('AD-S01', 'SQ-I01', t3));
    await apply(factorCmd('SQ-I01', 'R3', 'confirmed',
      { kind: 'publication', source: 'Акт осмотра (DEMO)', date: D, adId: 'AD-S01', quote: t3, text: 'На 2026-10-05 объект не введён (DEMO)' }));
    expect(await scoreOf('SQ-I01')).toBe(10);
    await expectSqlReject(factorCmd('SQ-I01', 'R1', 'confirmed',
      { kind: 'legal-review', source: 'generic source', date: D, text: 'generic' }), /R1_REQUIRES_VERIFIED_ABSENCE/);
    expect(await scoreOf('SQ-I01')).toBe(10);

    await apply(complexCmd('SQ-I02'));
    await expectSqlReject(factorCmd('SQ-I02', 'R1', 'confirmed',
      { kind: 'legal-review', source: 'Реестр недоступен (DEMO)', date: D, text: 'Проверить не удалось' }), /R1_REQUIRES_VERIFIED_ABSENCE/);

    await apply(complexCmd('SQ-I03', { legalBasis: legal('absent', 'absent-verified') }));
    const r1 = factorCmd('SQ-I03', 'R1', 'confirmed',
      { kind: 'legal-review', source: 'Сверка реестра и гарантии (DEMO)', date: D, text: 'Основание отсутствует (DEMO)' });
    await apply(r1);
    expect(await scoreOf('SQ-I03')).toBe(35);
    await apply(r1);
    expect(await scoreOf('SQ-I03')).toBe(35);
    // R1 без legal-review материала — отказ даже при absent-verified.
    await expectSqlReject(factorCmd('SQ-I03', 'R1', 'confirmed',
      { kind: 'document', source: 'generic', date: D, text: 'generic' }), /R1_REQUIRES_LEGAL_REVIEW/);
  }, 120000);

  it('I04–I06: R2 требует свой ad и точную quote', async () => {
    await setupSql();
    await apply(complexCmd('SQ-I04'));
    await expectSqlReject(factorCmd('SQ-I04', 'R2', 'confirmed',
      { kind: 'publication', source: 'Ручной ввод', date: D, quote: 'выдуманная цитата' }), /R2_REQUIRES_AD/);

    await apply(complexCmd('SQ-I05'));
    await apply(complexCmd('SQ-X05'));
    const t5 = 'Внесите депозит 456 000 тенге для фиксации квартиры.';
    await apply(adCmd('AD-S05', 'SQ-X05', t5));
    await expectSqlReject(factorCmd('SQ-I05', 'R2', 'confirmed',
      { kind: 'publication', source: 'Ручной ввод', date: D, adId: 'AD-S05', quote: t5 }), /FOREIGN_AD/);

    await apply(complexCmd('SQ-I06'));
    const t6 = 'Внесите депозит 777 000 тенге для фиксации квартиры.';
    await apply(adCmd('AD-S06', 'SQ-I06', t6));
    await apply(factorCmd('SQ-I06', 'R2', 'confirmed',
      { kind: 'publication', source: 'krisha (DEMO)', date: D, adId: 'AD-S06', quote: 'депозит 777 000 тенге' }));
    expect(await scoreOf('SQ-I06')).toBe(25);
    await expectSqlReject(factorCmd('SQ-I06', 'R2', 'confirmed',
      { kind: 'publication', source: 'krisha (DEMO)', date: D, adId: 'AD-S06', quote: 'несуществующая цитата' }), /UNGROUNDED_QUOTE/);
  }, 120000);

  it('I07–I10: R3 материал до ввода; R4 текст обращения', async () => {
    await setupSql();
    await apply(complexCmd('SQ-I07'));
    const t7 = 'Продаём квартиру в строящемся доме, сдача скоро.';
    await apply(adCmd('AD-S07', 'SQ-I07', t7));
    await expectSqlReject(factorCmd('SQ-I07', 'R3', 'confirmed',
      { kind: 'publication', source: 'krisha (DEMO)', date: D, adId: 'AD-S07', quote: t7 }), /R3_REQUIRES_MATERIAL/);

    await apply(complexCmd('SQ-I08'));
    const t8 = 'Продаём квартиру в строящемся доме, успейте купить.';
    await apply(adCmd('AD-S08', 'SQ-I08', t8));
    await apply(factorCmd('SQ-I08', 'R3', 'confirmed',
      { kind: 'publication', source: 'Акт осмотра (DEMO)', date: D, adId: 'AD-S08', quote: t8, text: 'На 2026-10-05 объект не введён (DEMO)' }));
    expect(await scoreOf('SQ-I08')).toBe(10);

    await apply(complexCmd('SQ-I09'));
    await expectSqlReject(factorCmd('SQ-I09', 'R4', 'confirmed',
      { kind: 'document', source: 'generic source', date: D }), /R4_REQUIRES_APPEAL/);

    await apply(complexCmd('SQ-I10'));
    await apply(factorCmd('SQ-I10', 'R4', 'confirmed',
      { kind: 'document', source: 'Обращение дольщиков (DEMO)', date: D, text: 'Мы, дольщики ЖК, коллективно заявляем о привлечении средств без основания (DEMO)' }));
    expect(await scoreOf('SQ-I10')).toBe(15);
  }, 120000);

  it('I11–I14: R5 два наблюдения, |gap|>=20, отдельное решение', async () => {
    await setupSql();
    const claimed = (v: number) => ({ value: v, source: 'Сайт застройщика (DEMO)', date: '2026-09-01' });
    await apply(complexCmd('SQ-I11', { readinessClaimed: 55, readinessClaimedSource: claimed(55) }));
    await apply({ type: 'readiness', zkId: 'SQ-I11', value: 35, source: 'Акт осмотра (DEMO)', date: '2026-10-01' });
    await apply(factorCmd('SQ-I11', 'R5', 'confirmed', { kind: 'observation', source: 'Акт осмотра (DEMO)', date: '2026-10-01' }));
    expect(await scoreOf('SQ-I11')).toBe(10);

    await apply(complexCmd('SQ-I12', { readinessClaimed: 35, readinessClaimedSource: claimed(35) }));
    await apply({ type: 'readiness', zkId: 'SQ-I12', value: 55, source: 'Акт осмотра (DEMO)', date: '2026-10-01' });
    await apply(factorCmd('SQ-I12', 'R5', 'confirmed', { kind: 'observation', source: 'Акт осмотра (DEMO)', date: '2026-10-01' }));
    expect(await scoreOf('SQ-I12')).toBe(10);

    await apply(complexCmd('SQ-I13', { readinessClaimed: 50, readinessClaimedSource: claimed(50) }));
    await apply({ type: 'readiness', zkId: 'SQ-I13', value: 31, source: 'Акт осмотра (DEMO)', date: '2026-10-01' });
    await expectSqlReject(factorCmd('SQ-I13', 'R5', 'confirmed', { kind: 'observation', source: 'Акт (DEMO)', date: '2026-10-01' }), /R5_REQUIRES_GAP/);
    await apply(complexCmd('SQ-I13B'));
    await expectSqlReject(factorCmd('SQ-I13B', 'R5', 'confirmed', { kind: 'observation', source: 'Акт (DEMO)', date: '2026-10-01' }), /R5_REQUIRES_GAP/);

    await apply(complexCmd('SQ-I14', { readinessClaimed: 60, readinessClaimedSource: claimed(60) }));
    await apply({ type: 'readiness', zkId: 'SQ-I14', value: 39, source: 'Акт осмотра (DEMO)', date: '2026-10-01' });
    await apply(factorCmd('SQ-I14', 'R5', 'confirmed', { kind: 'observation', source: 'Акт осмотра (DEMO)', date: '2026-10-01' }));
    expect(await scoreOf('SQ-I14')).toBe(10);
  }, 120000);

  it('I15–I18: R6 материал; reject снимает баллы; ad+confirm атомарна', async () => {
    await setupSql();
    await apply(complexCmd('SQ-I15'));
    await expectSqlReject(factorCmd('SQ-I15', 'R6', 'confirmed',
      { kind: 'document', source: 'generic', date: D, text: 'просрочено' }), /R6_REQUIRES_MATERIAL/);

    await apply(complexCmd('SQ-I16'));
    await apply(factorCmd('SQ-I16', 'R6', 'confirmed',
      { kind: 'document', source: 'Акт осмотра (DEMO)', date: D, text: 'Плановый срок 2026-06-01 сорван; простой с 2026-07-15 (87 дней). Значимо (DEMO)' }));
    expect(await scoreOf('SQ-I16')).toBe(5);

    await apply(complexCmd('SQ-I17'));
    const t17 = 'Внесите депозит 100 000 тенге для брони квартиры.';
    await apply(adCmd('AD-S17', 'SQ-I17', t17));
    await apply(factorCmd('SQ-I17', 'R2', 'confirmed',
      { kind: 'publication', source: 'krisha (DEMO)', date: D, adId: 'AD-S17', quote: 'депозит 100 000 тенге' }));
    expect(await scoreOf('SQ-I17')).toBe(25);
    await apply(factorCmd('SQ-I17', 'R2', 'rejected',
      { kind: 'publication', source: 'krisha (DEMO)', date: D, adId: 'AD-S17', quote: 'депозит 100 000 тенге' }, 'Ошибочная привязка (DEMO)'));
    expect(await scoreOf('SQ-I17')).toBe(0);
    const audit = await db.query<{ n: number }>(
      "select jsonb_array_length(data->'audit') as n from workspaces",
    );
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(4);

    await apply(complexCmd('SQ-I18'));
    const before = await stateVersion();
    await expect(command(db, {
      type: 'ad',
      ad: {
        id: 'AD-S18', zkId: 'SQ-I18', platform: 'krisha (DEMO)', account: 'demo',
        date: '2026-10-05', url: 'https://example.test/a', captureAt: '2026-10-06',
        text: 'Обычное объявление без предложений.',
      },
      decision: 'confirmed', hypothesis: { code: 'R2', quote: 'придуманная цитата' }, comment: COMMENT,
    }, version)).rejects.toThrow(/UNGROUNDED_QUOTE/);
    const after = await stateVersion();
    expect(after).toEqual(before);
    expect(after.ads).toBe(before.ads);
  }, 120000);
});

/**
 * S1.3 (C1). SQL-близнец отзыва: confirmed R1/R5 снимаются при смене
 * материалов; баллы — только после нового confirm; audit хранит изменение
 * (details) и автоматически затронутые факторы («Авто-отзыв»).
 * Материалы — synthetic fixtures (DEMO).
 */
describe('S1.3 invalidation (SQL mirrors)', () => {
  async function factorStatus(zkId: string, code: string): Promise<string | null> {
    const r = await db.query<{ status: string }>(
      "select f.value->>'status' as status from workspaces, jsonb_array_elements(data->'complexes') c, jsonb_array_elements(c.value->'factors') f where c.value->>'id'=$1 and f.value->>'code'=$2",
      [zkId, code],
    );
    return r.rows[0]?.status ?? null;
  }

  async function latestAudit(): Promise<{ action: string; comment: string }> {
    const r = await db.query<{ action: string; comment: string }>(
      "select data->'audit'->0->>'action' as action, data->'audit'->0->>'comment' as comment from workspaces",
    );
    return r.rows[0];
  }

  const r1Evidence = () => ({
    kind: 'legal-review', source: 'Сверка реестра и гарантии (DEMO)', date: D,
    text: 'Основание отсутствует (DEMO)',
  });

  it('V01–V03: смена legalBasis отзывает confirmed R1 (−35), audit с причиной', async () => {
    await setupSql();
    const absent = legal('absent', 'absent-verified');
    await apply(complexCmd('SQ-V01', { legalBasis: absent }));
    await apply(factorCmd('SQ-V01', 'R1', 'confirmed', r1Evidence()));
    expect(await scoreOf('SQ-V01')).toBe(35);

    // V01: замена source при прежнем type/status.
    await apply(complexCmd('SQ-V01', {
      legalBasis: { ...absent, source: 'Повторная сверка реестра (DEMO)' },
    }));
    expect(await factorStatus('SQ-V01', 'R1')).toBe('needs-verification');
    expect(await scoreOf('SQ-V01')).toBe(0);
    const a1 = await latestAudit();
    expect(a1.action).toBe('complex');
    expect(a1.comment).toMatch(/Авто-отзыв.*R1 confirmed→needs-verification/);
    // Повторное подтверждение: новый confirm возвращает +35.
    await apply(factorCmd('SQ-V01', 'R1', 'confirmed', r1Evidence()));
    expect(await scoreOf('SQ-V01')).toBe(35);

    // V02: смена type/status на guarantee/verified; новый legal verified
    // не оставляет confirmed R1, повторный confirm блокируется.
    await apply(complexCmd('SQ-V02', { legalBasis: legal('absent', 'absent-verified') }));
    await apply(factorCmd('SQ-V02', 'R1', 'confirmed', r1Evidence()));
    expect(await scoreOf('SQ-V02')).toBe(35);
    await apply(complexCmd('SQ-V02', {
      legalBasis: { type: 'guarantee', status: 'verified', source: 'Гарантия оператора (DEMO)', checkedAt: D, reviewText: 'Гарантия действует (DEMO)' },
    }));
    expect(await factorStatus('SQ-V02', 'R1')).toBe('needs-verification');
    expect(await scoreOf('SQ-V02')).toBe(0);
    expect((await latestAudit()).comment).toMatch(/Авто-отзыв.*R1.*guarantee\/verified/);
    await expectSqlReject(factorCmd('SQ-V02', 'R1', 'confirmed', r1Evidence()), /R1_REQUIRES_VERIFIED_ABSENCE/);

    // V03: замена checkedAt/reviewText при прежнем status.
    await apply(complexCmd('SQ-V03', { legalBasis: legal('absent', 'absent-verified') }));
    await apply(factorCmd('SQ-V03', 'R1', 'confirmed', r1Evidence()));
    await apply(complexCmd('SQ-V03', {
      legalBasis: { ...absent, checkedAt: '2026-10-11', reviewText: 'Повторная сверка той же области (DEMO)' },
    }));
    expect(await factorStatus('SQ-V03', 'R1')).toBe('needs-verification');
    expect(await scoreOf('SQ-V03')).toBe(0);
  }, 120000);

  it('V04–V06: новое наблюдение и смена claimed source отзывают confirmed R5', async () => {
    await setupSql();
    const claimed = (v: number, source = 'Сайт застройщика (DEMO)') => ({ value: v, source, date: '2026-09-01' });
    const confirmR5 = (zk: string) => factorCmd(zk, 'R5', 'confirmed', { kind: 'observation', source: 'Акт осмотра (DEMO)', date: '2026-10-01' });

    // V04: новое наблюдение с gap<20 → needs-verification (−10).
    await apply(complexCmd('SQ-V04', { readinessClaimed: 60, readinessClaimedSource: claimed(60) }));
    await apply({ type: 'readiness', zkId: 'SQ-V04', value: 39, source: 'Акт осмотра (DEMO)', date: '2026-10-01' });
    await apply(confirmR5('SQ-V04'));
    expect(await scoreOf('SQ-V04')).toBe(10);
    await apply({ type: 'readiness', zkId: 'SQ-V04', value: 50, source: 'Акт осмотра 2 (DEMO)', date: '2026-10-12' });
    expect(await factorStatus('SQ-V04', 'R5')).toBe('needs-verification');
    expect(await scoreOf('SQ-V04')).toBe(0);
    const a4 = await latestAudit();
    expect(a4.action).toBe('readiness');
    expect(a4.comment).toMatch(/Авто-отзыв.*R5 confirmed→needs-verification/);
    await expectSqlReject(
      factorCmd('SQ-V04', 'R5', 'confirmed', { kind: 'observation', source: 'Акт осмотра 2 (DEMO)', date: '2026-10-12' }),
      /R5_REQUIRES_GAP/,
    );

    // V05: новое наблюдение с gap>=20 → hypothesis (0 до нового решения),
    // новый confirm → +10.
    await apply(complexCmd('SQ-V05', { readinessClaimed: 60, readinessClaimedSource: claimed(60) }));
    await apply({ type: 'readiness', zkId: 'SQ-V05', value: 39, source: 'Акт осмотра (DEMO)', date: '2026-10-01' });
    await apply(confirmR5('SQ-V05'));
    await apply({ type: 'readiness', zkId: 'SQ-V05', value: 30, source: 'Акт осмотра 2 (DEMO)', date: '2026-10-12' });
    expect(await factorStatus('SQ-V05', 'R5')).toBe('hypothesis');
    expect(await scoreOf('SQ-V05')).toBe(0);
    expect((await latestAudit()).comment).toMatch(/Авто-отзыв.*R5 confirmed→hypothesis/);
    await apply(factorCmd('SQ-V05', 'R5', 'confirmed', { kind: 'observation', source: 'Акт осмотра 2 (DEMO)', date: '2026-10-12' }));
    expect(await scoreOf('SQ-V05')).toBe(10);

    // V06: смена claimed source при прежнем value → needs-verification.
    await apply(complexCmd('SQ-V06', { readinessClaimed: 60, readinessClaimedSource: claimed(60) }));
    await apply({ type: 'readiness', zkId: 'SQ-V06', value: 39, source: 'Акт осмотра (DEMO)', date: '2026-10-01' });
    await apply(confirmR5('SQ-V06'));
    await apply(complexCmd('SQ-V06', {
      readinessClaimed: 60,
      readinessClaimedSource: { value: 60, source: 'Обновлённый сайт застройщика (DEMO)', date: '2026-10-11' },
    }));
    expect(await factorStatus('SQ-V06', 'R5')).toBe('needs-verification');
    expect(await scoreOf('SQ-V06')).toBe(0);
    expect((await latestAudit()).comment).toMatch(/Авто-отзыв.*R5/);
  }, 120000);
});
