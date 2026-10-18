/**
 * S4.4 (C6). Гейт экспорта: только confirmed+grounded evidence, reason
 * отдельно от comment, needsSignalReverification блокирует полный экспорт,
 * draft/legacy помечены, без signed URL.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, initialState } from '../../src/lib/domain';
import { markLegacyIncompleteSignals } from '../../src/lib/signal-snapshot';
import { validateLoadedState } from '../../src/lib/validation';
import { buildExport, exportFilename } from '../../src/lib/export';

const confirmSignal = (zkId: string, comment: string) => ({ type: 'signal', zkId, status: 'confirmed', comment });

describe('S4.4 export gate: draft с заземлённым evidence', () => {
  it('draft: R1/R2/R3 confirmed+grounded входят, R5-гипотеза — нет; score 70/red', () => {
    const s = initialState();
    const exp = buildExport(s, 'SQ-002');
    expect(exp.template).toBe('signal-card/v1');
    expect(exp.kind).toBe('draft');
    expect(exp.markers).toContain('draft');
    expect(exp.signalStatus).toBe('draft');
    const codes = exp.evidence.map((e) => e.code).sort();
    expect(codes).toEqual(['R1', 'R2', 'R3']);
    expect(exp.excluded).toEqual([]);
    expect(exp.needsReverification).toEqual([]);
    expect(exp.score).toBe(70);
    expect(exp.zone).toBe('red');
    // AD-003 цитируется дважды — в материалах один раз.
    const ads = exp.materials.filter((m) => m.kind === 'ad');
    expect(ads.map((m) => m.id)).toEqual(['AD-003']);
    // Seed без run-ссылок: provenance нет, modelReason null.
    for (const e of exp.evidence) {
      expect(e).not.toHaveProperty('provenance');
      expect(e.modelReason).toBeNull();
    }
  });

  it('full после confirm сигнала; состояние валидно', () => {
    let s = initialState();
    s = applyCommand(s, confirmSignal('SQ-002', 'Проверено по seed-материалам'), 'analyst');
    expect(() => validateLoadedState(s)).not.toThrow();
    const exp = buildExport(s, 'SQ-002');
    expect(exp.kind).toBe('full');
    expect(exp.markers).toEqual([]);
    expect(exp.evidence.map((e) => e.code).sort()).toEqual(['R1', 'R2', 'R3']);
  });

  it('в экспорте нет signed URL', () => {
    let s = initialState();
    s = applyCommand(s, confirmSignal('SQ-002', 'Проверено'), 'analyst');
    const text = JSON.stringify(buildExport(s, 'SQ-002'));
    expect(text).not.toMatch(/signed\s*_?url/i);
    expect(text).not.toContain('sig=');
    expect(text).not.toContain('X-Amz-');
  });
});

describe('S4.4 export gate: блокировки и пометки', () => {
  it('legacyIncomplete блокирует полный экспорт (нужна новая проверка)', () => {
    let s = initialState();
    s = { ...s, signals: { 'SQ-002': { status: 'confirmed', at: '2026-10-09T15:00:00.000Z', reviewer: 'demo', comment: 'старое решение' } } };
    const marked = markLegacyIncompleteSignals(s);
    expect(marked.marked).toContain('SQ-002');
    const exp = buildExport(marked.state, 'SQ-002');
    expect(exp.kind).toBe('blocked');
    expect(exp.markers).toContain('legacy-incomplete');
    expect(exp.markers).toContain('needs-reverification');
    expect(exp.blockedReason).toMatch(/новая проверка/);
    expect(exp.evidence).toEqual([]);
    expect(exp.materials).toEqual([]);
  });

  it('незаземлённое confirmed исключается с причиной, а не молча', () => {
    const s = initialState();
    const z = s.complexes.find((c) => c.id === 'SQ-002')!;
    z.factors.find((f) => f.code === 'R2')!.evidence = {
      ...z.factors.find((f) => f.code === 'R2')!.evidence!,
      quote: 'выдуманная цитата',
    };
    const exp = buildExport(s, 'SQ-002');
    expect(exp.evidence.map((e) => e.code).sort()).toEqual(['R1', 'R3']);
    expect(exp.excluded).toEqual([{ code: 'R2', reason: 'quote-ungrounded:AD-003' }]);
    expect(exp.score).toBe(45);
  });

  it('needs-verification перечисляется отдельно и баллов не даёт', () => {
    const s = initialState();
    const z = s.complexes.find((c) => c.id === 'SQ-002')!;
    z.factors.find((f) => f.code === 'R5')!.status = 'needs-verification';
    const exp = buildExport(s, 'SQ-002');
    expect(exp.needsReverification).toEqual(['R5']);
    expect(exp.score).toBe(70);
  });

  it('неизвестный объект — отказ', () => {
    expect(() => buildExport(initialState(), 'SQ-999')).toThrow(/не найден/);
  });
});

describe('S4.4 export gate: reason отдельно, provenance из решения', () => {
  const adCmd = {
    type: 'ad',
    ad: {
      id: 'AD-T1', zkId: 'SQ-002', platform: 'Krisha.kz', account: 't1',
      date: '2026-10-10', url: 'https://example.test/t1', captureAt: '2026-10-10T10:00:00.000Z',
      text: 'Новая квартира. Депозит 700 000 тенге обязателен. Сдача в 2027 году.',
    },
    hypothesis: { code: 'R2', quote: 'Депозит 700 000 тенге обязателен.', runId: 'run-7', hypothesisId: 'run-7-h1' },
    decision: 'confirmed',
    comment: 'Аналитик: предложение оплаты подтверждаю по скриншоту.',
    modelReason: 'Модель: в тексте прямое предложение оплаты.',
  };

  it('comment аналитика и reason модели — разные поля; run-ссылка — в provenance', () => {
    let s = initialState();
    s = applyCommand(s, adCmd, 'analyst');
    // Evidence требует runId/hypothesisId пару; проводка S4.2 добавит runId
    // в evidence — здесь проверяем, что ссылка пережила сохранение целиком.
    const z = s.complexes.find((c) => c.id === 'SQ-002')!;
    const r2 = z.factors.find((f) => f.code === 'R2')!;
    r2.evidence = { ...r2.evidence!, runId: 'run-7', hypothesisId: 'run-7-h1' };
    expect(() => validateLoadedState(s)).not.toThrow();
    const exp = buildExport(s, 'SQ-002');
    const item = exp.evidence.find((e) => e.code === 'R2')!;
    expect(item.comment).toContain('Аналитик:');
    expect(item.modelReason).toContain('Модель:');
    expect(item.comment).not.toBe(item.modelReason);
    expect(item.provenance).toEqual({ runId: 'run-7', hypothesisId: 'run-7-h1' });
    expect(JSON.stringify(item)).not.toMatch(/signed/i);
  });
});

describe('S4.4 exportFilename: детерминированное имя по шаблону', () => {
  it('шаблон saq-signal-<zk>-<kind>.json, мусор в ID чистится', () => {
    expect(exportFilename('SQ-002', 'full')).toBe('saq-signal-SQ-002-full.json');
    expect(exportFilename('SQ-002', 'draft')).toBe('saq-signal-SQ-002-draft.json');
    expect(exportFilename('SQ-002', 'blocked')).toBe('saq-signal-SQ-002-blocked.json');
    expect(exportFilename('SQ 002/..', 'draft')).toBe('saq-signal-SQ-002-draft.json');
  });
});
