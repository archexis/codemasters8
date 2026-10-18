/**
 * S1.2 (C1). Общее подтверждение R1–R6: весь corpus I01–I18 против TS.
 * Материалы I03/I08/I10/I16 — synthetic fixtures, не утверждения о реальных
 * застройщиках. Каждый reject-кейс: отказ + полная неизменность state
 * (data/version/audit — в TS audit и данные; version проверяет SQL-близнец).
 * SQL-часть корпуса — tests/unit/decision-contract-sql.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, initialState } from '../../src/lib/domain';
import { computeScore } from '../../src/lib/scoring';
import type { AppState, Complex } from '../../src/lib/types';
import corpus from '../fixtures/contracts/decision-cases.json';

const REVIEWER = 'test-analyst';
const COMMENT = 'Решение аналитика (synthetic fixture S1.2)';
const D = '2026-10-10';

function baseComplex(id: string, over: Record<string, unknown> = {}) {
  return {
    id, name: `Synthetic ${id} (DEMO)`, city: 'Өскемен', address: `synthetic address ${id}`,
    developer: 'Synthetic Developer (DEMO)', bin: null, origin: 'test', stage: 'строится',
    readinessClaimed: null, readinessConfirmed: null, readinessSources: [],
    readinessClaimedSource: null,
    legalBasis: { type: 'unknown', status: 'unknown', source: '', checkedAt: D, reviewText: '' },
    note: 'synthetic fixture S1.2', factors: [], events: [], sources: [], ...over,
  };
}

const legal = (type: string, status: string) => ({
  type, status, source: `Сверка ${type} (DEMO)`, checkedAt: D,
  reviewText: `Проверена область ${type}: результат зафиксирован аналитиком (DEMO)`,
});

const adFor = (id: string, zkId: string, text: string) => ({
  id, zkId, platform: 'krisha (DEMO)', account: 'demo', date: '2026-10-05',
  url: 'https://example.test/a', captureAt: '2026-10-06', text,
});

const factorCmd = (zkId: string, code: string, status: string, evidence: Record<string, unknown>, comment = COMMENT) => ({
  type: 'factor', zkId, code, status, evidence, comment,
});

function setup(zkId: string, over: Record<string, unknown> = {}): AppState {
  return applyCommand(initialState(), { type: 'complex', complex: baseComplex(zkId, over) }, REVIEWER);
}

function scoreOf(state: AppState, zkId: string): number {
  return computeScore(state.complexes.find(z => z.id === zkId)!.factors).score;
}

/** Отказ без изменений: state целиком равен копии до команды. */
function expectReject(state: AppState, cmd: unknown, pattern: RegExp) {
  const before = structuredClone(state);
  expect(() => applyCommand(state, cmd, REVIEWER)).toThrow(pattern);
  expect(state).toEqual(before);
}

describe('S1.2 decision corpus (TS)', () => {
  it('corpus covers I01–I18', () => {
    expect(corpus.cases.map(c => c.id)).toEqual(
      ['I01','I02','I03','I04','I05','I06','I07','I08','I09','I10','I11','I12','I13','I14','I15','I16','I17','I18'],
    );
  });

  it('I01: R1 с generic source при verified guarantee — отказ, score 10', () => {
    let s = setup('ZK-I01', { legalBasis: legal('guarantee', 'verified') });
    const text = 'Продаём квартиру в строящемся доме до ввода, договор гарантии действует.';
    s = applyCommand(s, { type: 'ad', ad: adFor('AD-I01', 'ZK-I01', text), decision: 'saved', comment: COMMENT }, REVIEWER);
    s = applyCommand(s, factorCmd('ZK-I01', 'R3', 'confirmed',
      { kind: 'publication', source: 'Акт осмотра (DEMO)', date: D, adId: 'AD-I01', quote: text.slice(0, 20), text: 'На 2026-10-05 объект не введён в эксплуатацию (DEMO)' }), REVIEWER);
    expect(scoreOf(s, 'ZK-I01')).toBe(10);
    expectReject(s, factorCmd('ZK-I01', 'R1', 'confirmed',
      { kind: 'legal-review', source: 'generic source', date: D, text: 'generic сверка' }), /проверенного отсутствия/);
    expect(scoreOf(s, 'ZK-I01')).toBe(10);
  });

  it('I02: R1 на основании unknown — отказ, unknown остаётся', () => {
    const s = setup('ZK-I02');
    expectReject(s, factorCmd('ZK-I02', 'R1', 'confirmed',
      { kind: 'legal-review', source: 'Реестр недоступен (DEMO)', date: D, text: 'Проверить не удалось' }), /проверенного отсутствия/);
    expect(s.complexes.find(z => z.id === 'ZK-I02')!.legalBasis.status).toBe('unknown');
  });

  it('I03: R1 с полным review того же ЖК — +35 один раз', () => {
    let s = setup('ZK-I03', { legalBasis: legal('absent', 'absent-verified') });
    const cmd = factorCmd('ZK-I03', 'R1', 'confirmed',
      { kind: 'legal-review', source: 'Сверка реестра и гарантии (DEMO)', date: D, text: 'Основание отсутствует: реестр пуст, гарантии нет (DEMO)' });
    s = applyCommand(s, cmd, REVIEWER);
    expect(scoreOf(s, 'ZK-I03')).toBe(35);
    s = applyCommand(s, cmd, REVIEWER);
    expect(scoreOf(s, 'ZK-I03')).toBe(35);
  });

  it('I04: R2 с выдуманной quote без adId — отказ', () => {
    const s = setup('ZK-I04');
    expectReject(s, factorCmd('ZK-I04', 'R2', 'confirmed',
      { kind: 'publication', source: 'Ручной ввод', date: D, quote: 'выдуманная цитата про депозит' }), /без adId/);
  });

  it('I05: R2 с чужим adId — отказ', () => {
    let s = setup('ZK-I05');
    s = applyCommand(s, { type: 'complex', complex: baseComplex('ZK-X05') }, REVIEWER);
    const text = 'Внесите депозит 456 000 тенге для фиксации квартиры.';
    s = applyCommand(s, { type: 'ad', ad: adFor('AD-X05', 'ZK-X05', text), decision: 'saved', comment: COMMENT }, REVIEWER);
    expectReject(s, factorCmd('ZK-I05', 'R2', 'confirmed',
      { kind: 'publication', source: 'Ручной ввод', date: D, adId: 'AD-X05', quote: text }), /другому ЖК/);
  });

  it('I06: R2 точная quote своим ad — +25', () => {
    let s = setup('ZK-I06');
    const text = 'Внесите депозит 456 000 тенге для фиксации квартиры.';
    s = applyCommand(s, { type: 'ad', ad: adFor('AD-I06', 'ZK-I06', text), decision: 'saved', comment: COMMENT }, REVIEWER);
    s = applyCommand(s, factorCmd('ZK-I06', 'R2', 'confirmed',
      { kind: 'publication', source: 'krisha (DEMO)', date: D, adId: 'AD-I06', quote: 'депозит 456 000 тенге' }), REVIEWER);
    expect(scoreOf(s, 'ZK-I06')).toBe(25);
  });

  it('I07: R3 без подтверждения «до ввода» — отказ', () => {
    let s = setup('ZK-I07');
    const text = 'Продаём квартиру в строящемся доме, сдача скоро.';
    s = applyCommand(s, { type: 'ad', ad: adFor('AD-I07', 'ZK-I07', text), decision: 'saved', comment: COMMENT }, REVIEWER);
    expectReject(s, factorCmd('ZK-I07', 'R3', 'confirmed',
      { kind: 'publication', source: 'krisha (DEMO)', date: D, adId: 'AD-I07', quote: text }), /не введён/);
  });

  it('I08: R3 с датированным beforeCommissioning — +10', () => {
    let s = setup('ZK-I08');
    const text = 'Продаём квартиру в строящемся доме, сдача скоро.';
    s = applyCommand(s, { type: 'ad', ad: adFor('AD-I08', 'ZK-I08', text), decision: 'saved', comment: COMMENT }, REVIEWER);
    s = applyCommand(s, factorCmd('ZK-I08', 'R3', 'confirmed',
      { kind: 'publication', source: 'Акт осмотра (DEMO)', date: D, adId: 'AD-I08', quote: text, text: 'На 2026-10-05 объект не введён в эксплуатацию (DEMO)' }), REVIEWER);
    expect(scoreOf(s, 'ZK-I08')).toBe(10);
  });

  it('I09: R4 generic source без текста обращения — отказ', () => {
    const s = setup('ZK-I09');
    expectReject(s, factorCmd('ZK-I09', 'R4', 'confirmed',
      { kind: 'document', source: 'generic source', date: D }), /текст коллективного/);
  });

  it('I10: R4 текст коллективного обращения о средствах — +15', () => {
    let s = setup('ZK-I10');
    s = applyCommand(s, factorCmd('ZK-I10', 'R4', 'confirmed',
      { kind: 'document', source: 'Обращение дольщиков (DEMO)', date: D, text: 'Мы, дольщики ЖК, коллективно заявляем о привлечении средств без основания (DEMO)' }), REVIEWER);
    expect(scoreOf(s, 'ZK-I10')).toBe(15);
  });

  it('I11: R5 55/35 отдельным решением — +10', () => {
    let s = setup('ZK-I11', { readinessClaimed: 55, readinessClaimedSource: { value: 55, source: 'Сайт застройщика (DEMO)', date: '2026-09-01' } });
    s = applyCommand(s, { type: 'readiness', zkId: 'ZK-I11', value: 35, source: 'Акт осмотра (DEMO)', date: '2026-10-01' }, REVIEWER);
    expect(s.complexes.find(z => z.id === 'ZK-I11')!.factors.find(f => f.code === 'R5')?.status).toBe('hypothesis');
    s = applyCommand(s, factorCmd('ZK-I11', 'R5', 'confirmed',
      { kind: 'observation', source: 'Акт осмотра (DEMO)', date: '2026-10-01' }), REVIEWER);
    expect(scoreOf(s, 'ZK-I11')).toBe(10);
  });

  it('I12: R5 35/55 отдельным решением — +10', () => {
    let s = setup('ZK-I12', { readinessClaimed: 35, readinessClaimedSource: { value: 35, source: 'Сайт застройщика (DEMO)', date: '2026-09-01' } });
    s = applyCommand(s, { type: 'readiness', zkId: 'ZK-I12', value: 55, source: 'Акт осмотра (DEMO)', date: '2026-10-01' }, REVIEWER);
    s = applyCommand(s, factorCmd('ZK-I12', 'R5', 'confirmed',
      { kind: 'observation', source: 'Акт осмотра (DEMO)', date: '2026-10-01' }), REVIEWER);
    expect(scoreOf(s, 'ZK-I12')).toBe(10);
  });

  it('I13: R5 gap 19 / null / без source — отказ', () => {
    let s = setup('ZK-I13', { readinessClaimed: 50, readinessClaimedSource: { value: 50, source: 'Сайт застройщика (DEMO)', date: '2026-09-01' } });
    s = applyCommand(s, { type: 'readiness', zkId: 'ZK-I13', value: 31, source: 'Акт осмотра (DEMO)', date: '2026-10-01' }, REVIEWER);
    expectReject(s, factorCmd('ZK-I13', 'R5', 'confirmed',
      { kind: 'observation', source: 'Акт осмотра (DEMO)', date: '2026-10-01' }), /разрыв/);
    const s2 = setup('ZK-I13B');
    expectReject(s2, factorCmd('ZK-I13B', 'R5', 'confirmed',
      { kind: 'observation', source: 'Акт осмотра (DEMO)', date: '2026-10-01' }), /разрыв/);
    // Legacy-подобное состояние: разрыв ≥20 есть, происхождения нет.
    const s3 = setup('ZK-I13C', { readinessClaimed: 60, readinessClaimedSource: { value: 60, source: 'Сайт застройщика (DEMO)', date: '2026-09-01' } });
    const withConfirmed = applyCommand(s3, { type: 'readiness', zkId: 'ZK-I13C', value: 39, source: 'Акт осмотра (DEMO)', date: '2026-10-01' }, REVIEWER);
    const stripped = structuredClone(withConfirmed);
    stripped.complexes.find(z => z.id === 'ZK-I13C')!.readinessClaimedSource = null;
    expectReject(stripped, factorCmd('ZK-I13C', 'R5', 'confirmed',
      { kind: 'observation', source: 'Акт осмотра (DEMO)', date: '2026-10-01' }), /два наблюдения/);
  });

  it('I14: R5 gap 21 — +10', () => {
    let s = setup('ZK-I14', { readinessClaimed: 60, readinessClaimedSource: { value: 60, source: 'Сайт застройщика (DEMO)', date: '2026-09-01' } });
    s = applyCommand(s, { type: 'readiness', zkId: 'ZK-I14', value: 39, source: 'Акт осмотра (DEMO)', date: '2026-10-01' }, REVIEWER);
    s = applyCommand(s, factorCmd('ZK-I14', 'R5', 'confirmed',
      { kind: 'observation', source: 'Акт осмотра (DEMO)', date: '2026-10-01' }), REVIEWER);
    expect(scoreOf(s, 'ZK-I14')).toBe(10);
  });

  it('I15: R6 строка «просрочено» без материала — отказ', () => {
    const s = setup('ZK-I15');
    expectReject(s, factorCmd('ZK-I15', 'R6', 'confirmed',
      { kind: 'document', source: 'generic source', date: D, text: 'просрочено' }), /датированный факт/);
  });

  it('I16: R6 датированный факт + срок/простой + explanation — +5', () => {
    let s = setup('ZK-I16');
    s = applyCommand(s, factorCmd('ZK-I16', 'R6', 'confirmed',
      { kind: 'document', source: 'Акт осмотра (DEMO)', date: '2026-10-10', text: 'Плановый срок 2026-06-01 сорван; простой с 2026-07-15 (87 дней). Значимо: работы не ведутся (DEMO)' }), REVIEWER);
    expect(scoreOf(s, 'ZK-I16')).toBe(5);
  });

  it('I17: confirmed → rejected с comment — баллы сняты, audit сохранён', () => {
    let s = setup('ZK-I17');
    const text = 'Внесите депозит 100 000 тенге для брони квартиры.';
    s = applyCommand(s, { type: 'ad', ad: adFor('AD-I17', 'ZK-I17', text), decision: 'saved', comment: COMMENT }, REVIEWER);
    s = applyCommand(s, factorCmd('ZK-I17', 'R2', 'confirmed',
      { kind: 'publication', source: 'krisha (DEMO)', date: D, adId: 'AD-I17', quote: 'депозит 100 000 тенге' }), REVIEWER);
    expect(scoreOf(s, 'ZK-I17')).toBe(25);
    const auditBefore = s.audit.length;
    s = applyCommand(s, factorCmd('ZK-I17', 'R2', 'rejected',
      { kind: 'publication', source: 'krisha (DEMO)', date: D, adId: 'AD-I17', quote: 'депозит 100 000 тенге' }, 'Ошибочная привязка: цитата из другого корпуса (DEMO)'), REVIEWER);
    expect(scoreOf(s, 'ZK-I17')).toBe(0);
    expect(s.audit.length).toBe(auditBefore + 1);
    expect(s.audit.some(e => e.action === 'factor' && (e.details as { status: string }).status === 'confirmed')).toBe(true);
  });

  it('I18: невалидная ad+confirm — нет ad/factor/audit', () => {
    const s = setup('ZK-I18');
    const before = structuredClone(s);
    const badAd = adFor('AD-I18', 'ZK-I18', 'Обычное объявление без предложений.');
    expect(() => applyCommand(s, {
      type: 'ad', ad: badAd, decision: 'confirmed',
      hypothesis: { code: 'R2', quote: 'придуманная цитата про депозит' }, comment: COMMENT,
    }, REVIEWER)).toThrow(/Цитата/);
    expect(s).toEqual(before);
    expect(s.ads.some(a => a.id === 'AD-I18')).toBe(false);
  });
});

/**
 * S1.3 (C1). Отзыв устаревших решений: confirmed R1/R5 снимаются при смене
 * материалов; баллы — только после нового confirm; audit хранит изменение
 * (details) и автоматически затронутые факторы (комментарий «Авто-отзыв»).
 * Материалы — synthetic fixtures (DEMO).
 */
describe('S1.3 invalidation (TS)', () => {
  const r1Evidence = () => ({
    kind: 'legal-review', source: 'Сверка реестра и гарантии (DEMO)', date: D,
    text: 'Основание отсутствует: реестр пуст, гарантии нет (DEMO)',
  });

  function withConfirmedR1(zkId: string) {
    let s = setup(zkId, { legalBasis: legal('absent', 'absent-verified') });
    s = applyCommand(s, factorCmd(zkId, 'R1', 'confirmed', r1Evidence()), REVIEWER);
    expect(scoreOf(s, zkId)).toBe(35);
    return s;
  }

  function withConfirmedR5(zkId: string, claimed = 60, confirmed = 39) {
    let s = setup(zkId, { readinessClaimed: claimed, readinessClaimedSource: { value: claimed, source: 'Сайт застройщика (DEMO)', date: '2026-09-01' } });
    s = applyCommand(s, { type: 'readiness', zkId, value: confirmed, source: 'Акт осмотра (DEMO)', date: '2026-10-01' }, REVIEWER);
    s = applyCommand(s, factorCmd(zkId, 'R5', 'confirmed', { kind: 'observation', source: 'Акт осмотра (DEMO)', date: '2026-10-01' }), REVIEWER);
    expect(scoreOf(s, zkId)).toBe(10);
    return s;
  }

  function updateComplex(s: AppState, zkId: string, mutate: (c: Complex) => void): AppState {
    const current = structuredClone(s.complexes.find(z => z.id === zkId)!);
    mutate(current);
    return applyCommand(s, { type: 'complex', complex: current }, REVIEWER);
  }

  it('V01: R1 confirmed → замена source при прежнем status → needs-verification, −35, audit с причиной', () => {
    let s = withConfirmedR1('ZK-V01');
    s = updateComplex(s, 'ZK-V01', c => { c.legalBasis.source = 'Повторная сверка реестра (DEMO)'; });
    const f = s.complexes.find(z => z.id === 'ZK-V01')!.factors.find(f => f.code === 'R1')!;
    expect(f.status).toBe('needs-verification');
    expect(scoreOf(s, 'ZK-V01')).toBe(0);
    expect(s.audit[0].action).toBe('complex');
    expect(s.audit[0].comment).toMatch(/Авто-отзыв.*R1 confirmed→needs-verification.*source/);
    // Повторное подтверждение явно требуется: без нового confirm баллов нет,
    // после нового confirm — снова +35.
    expect(scoreOf(s, 'ZK-V01')).toBe(0);
    s = applyCommand(s, factorCmd('ZK-V01', 'R1', 'confirmed', r1Evidence()), REVIEWER);
    expect(scoreOf(s, 'ZK-V01')).toBe(35);
  });

  it('V02: R1 confirmed → смена type/status на guarantee/verified → needs-verification; новый legal verified не оставляет confirmed R1', () => {
    let s = withConfirmedR1('ZK-V02');
    s = updateComplex(s, 'ZK-V02', c => {
      c.legalBasis = { type: 'guarantee', status: 'verified', source: 'Гарантия оператора (DEMO)', checkedAt: D, reviewText: 'Гарантия действует, основание есть (DEMO)' };
    });
    const f = s.complexes.find(z => z.id === 'ZK-V02')!.factors.find(f => f.code === 'R1')!;
    expect(f.status).toBe('needs-verification');
    expect(scoreOf(s, 'ZK-V02')).toBe(0);
    expect(s.audit[0].comment).toMatch(/Авто-отзыв.*R1.*guarantee\/verified/);
    // При действующей гарантии повторный confirm R1 блокируется C1.
    expectReject(s, factorCmd('ZK-V02', 'R1', 'confirmed', r1Evidence()), /проверенного отсутствия/);
  });

  it('V03: R1 confirmed → замена checkedAt/reviewText при прежнем status → needs-verification', () => {
    let s = withConfirmedR1('ZK-V03');
    s = updateComplex(s, 'ZK-V03', c => {
      c.legalBasis.checkedAt = '2026-10-11';
      c.legalBasis.reviewText = 'Повторная сверка той же области: отсутствие подтверждено (DEMO)';
    });
    expect(s.complexes.find(z => z.id === 'ZK-V03')!.factors.find(f => f.code === 'R1')!.status).toBe('needs-verification');
    expect(scoreOf(s, 'ZK-V03')).toBe(0);
    expect(s.audit[0].comment).toMatch(/Авто-отзыв.*R1/);
  });

  it('V04: R5 confirmed → новое наблюдение с gap<20 → needs-verification, −10; повторный confirm блокируется', () => {
    let s = withConfirmedR5('ZK-V04');
    s = applyCommand(s, { type: 'readiness', zkId: 'ZK-V04', value: 50, source: 'Акт осмотра 2 (DEMO)', date: '2026-10-12' }, REVIEWER);
    const f = s.complexes.find(z => z.id === 'ZK-V04')!.factors.find(f => f.code === 'R5')!;
    expect(f.status).toBe('needs-verification');
    expect(scoreOf(s, 'ZK-V04')).toBe(0);
    expect(s.audit[0].action).toBe('readiness');
    expect(s.audit[0].comment).toMatch(/Авто-отзыв.*R5 confirmed→needs-verification/);
    expectReject(s, factorCmd('ZK-V04', 'R5', 'confirmed', { kind: 'observation', source: 'Акт осмотра 2 (DEMO)', date: '2026-10-12' }), /разрыв/);
    expect(scoreOf(s, 'ZK-V04')).toBe(0);
  });

  it('V05: R5 confirmed → новое наблюдение с gap>=20 → hypothesis, 0 до нового решения; новый confirm → +10', () => {
    let s = withConfirmedR5('ZK-V05');
    s = applyCommand(s, { type: 'readiness', zkId: 'ZK-V05', value: 30, source: 'Акт осмотра 2 (DEMO)', date: '2026-10-12' }, REVIEWER);
    const f = s.complexes.find(z => z.id === 'ZK-V05')!.factors.find(f => f.code === 'R5')!;
    expect(f.status).toBe('hypothesis');
    expect(scoreOf(s, 'ZK-V05')).toBe(0);
    expect(s.audit[0].comment).toMatch(/Авто-отзыв.*R5 confirmed→hypothesis/);
    // Баллы только после нового confirm.
    s = applyCommand(s, factorCmd('ZK-V05', 'R5', 'confirmed', { kind: 'observation', source: 'Акт осмотра 2 (DEMO)', date: '2026-10-12' }), REVIEWER);
    expect(scoreOf(s, 'ZK-V05')).toBe(10);
  });

  it('V06: R5 confirmed → смена claimed source при прежнем value → needs-verification', () => {
    let s = withConfirmedR5('ZK-V06');
    s = updateComplex(s, 'ZK-V06', c => {
      c.readinessClaimedSource = { value: 60, source: 'Обновлённый сайт застройщика (DEMO)', date: '2026-10-11' };
    });
    expect(s.complexes.find(z => z.id === 'ZK-V06')!.factors.find(f => f.code === 'R5')!.status).toBe('needs-verification');
    expect(scoreOf(s, 'ZK-V06')).toBe(0);
    expect(s.audit[0].comment).toMatch(/Авто-отзыв.*R5/);
  });

  it('V07: без смены материалов отзыва нет — повторный complex без изменений не трогает confirmed', () => {
    let s = withConfirmedR1('ZK-V07');
    const auditBefore = s.audit.length;
    s = updateComplex(s, 'ZK-V07', () => {});
    expect(s.complexes.find(z => z.id === 'ZK-V07')!.factors.find(f => f.code === 'R1')!.status).toBe('confirmed');
    expect(scoreOf(s, 'ZK-V07')).toBe(35);
    expect(s.audit[0].comment).not.toMatch(/Авто-отзыв/);
    expect(s.audit.length).toBe(auditBefore + 1);
  });
});

describe('S2.1 domain: null date, undated R3, dupe sightings hint', () => {
  const undatedAd = (id: string, zkId: string, text: string) => ({ ...adFor(id, zkId, text), date: null });

  it('ad с date=null сохраняется; повтор того же текста несёт ID существующего', () => {
    let s = setup('ZK-U1');
    const text = 'Бронь квартиры — всего 500 000 тенге, сумма идёт в зачёт стоимости (DEMO).';
    s = applyCommand(s, { type: 'ad', ad: undatedAd('AD-U1', 'ZK-U1', text), decision: 'saved', comment: COMMENT }, REVIEWER);
    expect(s.ads[0].date).toBeNull();
    const before = structuredClone(s);
    expect(() => applyCommand(s, { type: 'ad', ad: undatedAd('AD-U2', 'ZK-U1', text), decision: 'saved', comment: COMMENT }, REVIEWER))
      .toThrow(/уже сохранена \(AD-U1\).*sightings/);
    expect(s).toEqual(before);
  });

  it('R3 по undated-публикации без явной даты — отказ; с датой в материале — confirm', () => {
    let s = setup('ZK-U2');
    const text = 'Старт продаж в строящемся доме, бронь 500 000 тенге (DEMO).';
    s = applyCommand(s, { type: 'ad', ad: undatedAd('AD-U2', 'ZK-U2', text), decision: 'saved', comment: COMMENT }, REVIEWER);
    const quote = text.slice(0, 20);
    expectReject(s, factorCmd('ZK-U2', 'R3', 'confirmed',
      { kind: 'publication', source: 'Скриншот (DEMO)', date: D, adId: 'AD-U2', quote, text: 'Объект не введён в эксплуатацию, срок сдачи не называют (DEMO)' }), /неизвестной датой публикации/);
    s = applyCommand(s, factorCmd('ZK-U2', 'R3', 'confirmed',
      { kind: 'publication', source: 'Акт осмотра (DEMO)', date: D, adId: 'AD-U2', quote, text: 'На 2026-10-05 объект не введён в эксплуатацию (DEMO)' }), REVIEWER);
    expect(s.complexes.find(z => z.id === 'ZK-U2')!.factors.find(f => f.code === 'R3')!.status).toBe('confirmed');
  });

  it('runId/hypothesisId в factor evidence переживают parse и сохраняются', () => {
    let s = setup('ZK-U3');
    const text = 'Продаём квартиру в строящемся доме до ввода (DEMO).';
    s = applyCommand(s, { type: 'ad', ad: adFor('AD-U3', 'ZK-U3', text), decision: 'saved', comment: COMMENT }, REVIEWER);
    s = applyCommand(s, factorCmd('ZK-U3', 'R2', 'confirmed',
      { kind: 'publication', source: 'krisha (DEMO)', date: D, adId: 'AD-U3', quote: text, runId: 'RUN-9', hypothesisId: 'H-9' }), REVIEWER);
    expect(s.complexes.find(z => z.id === 'ZK-U3')!.factors.find(f => f.code === 'R2')!.evidence)
      .toMatchObject({ runId: 'RUN-9', hypothesisId: 'H-9' });
  });
});
