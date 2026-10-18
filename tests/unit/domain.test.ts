import { describe, expect, it } from 'vitest';
import { applyCommand, initialState, safeUrl } from '../../src/lib/domain';
import { computeScore } from '../../src/lib/scoring';
import { parseAdText, parseCsvAds, detectPlatform, dedupeKey } from '../../src/lib/parser';
import type { Code, Factor } from '../../src/lib/types';
const factor = (code: Code): Factor => ({ code, status: 'confirmed' });
describe('risk scoring parity', () => {
  it.each([['SQ-001',35,'yellow'],['SQ-002',70,'red'],['SQ-003',10,'green']])('%s keeps its control score', (id, score, zone) => {
    expect(computeScore(initialState().complexes.find(z => z.id === id)!.factors)).toMatchObject({ score, zone });
  });
  it('requires R1 + R2 for red and does not double-count duplicate factors', () => {
    expect(computeScore([factor('R1'),factor('R1')]).score).toBe(35);
    expect(computeScore(['R1','R3','R4'].map(c => factor(c as Code)))).toMatchObject({ score:60,zone:'yellow' });
    expect(computeScore([factor('R1'),factor('R2')])).toMatchObject({ score:60,zone:'red' });
    expect(computeScore([{code:'R1',status:'hypothesis'}]).score).toBe(0);
  });
});
describe('decision invariants', () => {
  it('rejects unsupported R1 and missing source/quote', () => {
    const state = initialState();
    expect(() => applyCommand(state, {type:'factor',zkId:'SQ-001',code:'R1',status:'confirmed',evidence:{source:'test'},comment:''}, 'reviewer')).toThrow('R1');
    expect(() => applyCommand(state, {type:'factor',zkId:'SQ-001',code:'R2',status:'confirmed',evidence:{source:'test'},comment:''}, 'reviewer')).toThrow('цитата');
    expect(() => applyCommand(state, {type:'factor',zkId:'SQ-001',code:'R3',status:'confirmed',evidence:{source:''},comment:''}, 'reviewer')).toThrow('источник');
  });
  it('preserves audit and invalidates signals after new facts', () => {
    let state = applyCommand(initialState(), {type:'signal',zkId:'SQ-002',status:'confirmed',comment:'проверено'},'analyst');
    const snapshot = structuredClone(state.signals['SQ-002'].snapshot);
    state = applyCommand(state, {type:'factor',zkId:'SQ-002',code:'R2',status:'rejected',evidence:{source:'проверено'},comment:'исправление'},'analyst');
    expect(state.signals['SQ-002'].status).toBe('draft');
    expect(state.signals['SQ-002'].snapshot).toEqual(snapshot);
    expect(state.audit).toHaveLength(2);
    expect(state.audit[0].details).toHaveProperty('status','rejected');
  });
  it('rechecks R5 when observations change', () => {
    let state = applyCommand(initialState(), {type:'readiness',zkId:'SQ-002',value:12,source:'Акт 1',date:'2026-10-18'},'analyst');
    expect(state.complexes[1].factors.find(f => f.code === 'R5')?.status).toBe('hypothesis');
    state = applyCommand(state, {type:'readiness',zkId:'SQ-002',value:55,source:'Акт 2',date:'2026-10-18'},'analyst');
    expect(state.complexes[1].factors.find(f => f.code === 'R5')?.status).toBe('needs-verification');
  });
  it('persists rejected analysis and rejects invented evidence atomically', () => {
    const state = initialState(); const ad = {...state.ads[0],id:'new',text:'Новый депозит 123 тенге'};
    expect(() => applyCommand(state,{type:'ad',ad,decision:'confirmed',hypothesis:{code:'R2',quote:'придуманная цитата'},comment:''},'analyst')).toThrow('Цитата');
    expect(state.ads).toHaveLength(13);
    const next = applyCommand(state,{type:'ad',ad,decision:'rejected',comment:'Не относится к объекту'},'analyst');
    expect(next.ads[0].decision).toBe('rejected');
  });
  it('rejects unsafe URLs and invalid coordinates', () => {
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    const state = initialState(); const z = {...state.complexes[0], lat:91};
    expect(() => applyCommand(state,{type:'complex',complex:z},'analyst')).toThrow('широта');
  });
});
describe('parser migration', () => {
  it.each(['Депозит 1 000 000 тенге для фиксации цены.','Алғашқы жарна 500 000 теңге.','Перевод на карту каспи 200 000 тг.'])('recognizes payment: %s', text => expect(parseAdText(text).payment.flagged).toBe(true));
  it.each(['Без предоплаты и без залога.','Бронь бесплатная.','Пишите в личку.'])('does not treat negation/channel as R2: %s', text => expect(parseAdText(text).payment.flagged).toBe(false));
  it('supports quoted multiline CSV', () => {
    const result = parseCsvAds('text;url\n"Первая строка\nВторая строка";https://krisha.kz/a');
    expect(result.rows).toHaveLength(1); expect(result.rows[0].text).toContain('\n'); expect(result.errors).toHaveLength(0);
  });
  it('checks hostname instead of URL substring', () => {
    expect(detectPlatform({url:'https://attacker.invalid/krisha.kz'}).key).toBe('unknown');
    expect(detectPlatform({url:'https://krisha.kz/a'}).key).toBe('krisha');
    expect(detectPlatform({url:'https://evilkrisha.kz/a'}).key).toBe('unknown');
  });
  it('dedup does not collide on the first 60 chars', () => {
    expect(dedupeKey({text:'a'.repeat(65)+'b'})).not.toBe(dedupeKey({text:'a'.repeat(65)+'c'}));
  });
  it('long payment evidence remains an exact substring', () => {
    const text = `Депозит 500 000 тенге ${'подробности '.repeat(50)}.`;
    const quote = parseAdText(text).payment.quotes[0];
    expect(quote.length).toBeGreaterThan(280); expect(text.includes(quote)).toBe(true);
  });
  it.each(['Без комиссии, депозит 500 000 тенге.','Не упустите возможность внести депозит 500 000 тенге.','Бронь бесплатная, но депозит 500 000 тенге обязателен.','Депозит 500 000 тенге, гарантий нет.'])('unrelated negation does not hide payment: %s', text => {
    expect(parseAdText(text).payment.flagged).toBe(true);
  });
});
