/**
 * S4.2 (C5). Заморозка скоринга: gaming-попытки без эффекта.
 * Веса WEIGHTS заморожены (Object.freeze, SIGNAL_WEIGHTS_VERSION=1);
 * баллы дают только confirmed R1–R6, каждый код — один раз; гипотезы,
 * needs-verification и rejected — 0; зона red — только R1+R2 при ≥60.
 * Расчёт детерминирован (порядок входа не влияет) и раскрываем
 * (scoreBreakdown/describeScore сходятся с computeScore).
 */
import { describe, expect, it } from 'vitest';
import {
  SIGNAL_WEIGHTS_VERSION,
  WEIGHTS,
  codes,
  computeScore,
  describeScore,
  scoreBreakdown,
  zoneFor,
} from '../../src/lib/scoring';
import type { Code, Factor } from '../../src/lib/types';

const f = (code: Code, status: Factor['status'] = 'confirmed'): Factor => ({ code, status });

describe('S4.2 scoring freeze: consts', () => {
  it('SIGNAL_WEIGHTS_VERSION is 1 and weights are frozen', () => {
    expect(SIGNAL_WEIGHTS_VERSION).toBe(1);
    expect(WEIGHTS).toEqual({ R1: 35, R2: 25, R3: 10, R4: 15, R5: 10, R6: 5 });
    expect(Object.isFrozen(WEIGHTS)).toBe(true);
    expect(codes).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6']);
  });

  it('mutating WEIGHTS has no effect on scoring', () => {
    expect(() => {
      (WEIGHTS as Record<string, number>).R2 = 999;
    }).toThrow();
    expect(WEIGHTS.R2).toBe(25);
    expect(computeScore([f('R2')]).score).toBe(25);
  });
});

describe('S4.2 scoring freeze: gaming attempts give nothing', () => {
  it('duplicate confirmed of the same code counts once', () => {
    expect(computeScore([f('R1'), f('R1'), f('R1')]).score).toBe(35);
    expect(computeScore([f('R2'), f('R2')]).score).toBe(25);
  });

  it('hypothesis / needs-verification / rejected give 0', () => {
    expect(computeScore([f('R1', 'hypothesis')]).score).toBe(0);
    expect(computeScore([f('R2', 'needs-verification')]).score).toBe(0);
    expect(computeScore([f('R3', 'rejected')]).score).toBe(0);
    expect(computeScore([f('R1', 'hypothesis'), f('R2', 'hypothesis')])).toMatchObject({ score: 0, zone: 'green' });
  });

  it('unknown codes are ignored, not scored', () => {
    const forged = [{ code: 'R9', status: 'confirmed' } as unknown as Factor, f('R2')];
    expect(computeScore(forged).score).toBe(25);
  });

  it('inflated zone strings do not stick: zone is recomputed', () => {
    // 60 без пары R1+R2 — yellow, не red (подмена зоны невозможна).
    expect(computeScore([f('R1'), f('R3'), f('R4')])).toMatchObject({ score: 60, zone: 'yellow' });
    expect(computeScore([f('R1'), f('R2')])).toMatchObject({ score: 60, zone: 'red' });
    expect(computeScore([f('R2'), f('R3'), f('R4'), f('R5')])).toMatchObject({ score: 60, zone: 'yellow' });
    expect(zoneFor(99, ['R2'])).toBe('yellow');
    expect(zoneFor(60, ['R1', 'R2'])).toBe('red');
  });

  it('score caps at 100 and is order-independent', () => {
    const all = codes.map((c) => f(c));
    expect(computeScore(all).score).toBe(100);
    const shuffled = [f('R6'), f('R1'), f('R4'), f('R2'), f('R5'), f('R3')];
    const a = computeScore(shuffled);
    const b = computeScore(all);
    expect(a.score).toBe(b.score);
    expect(a.zone).toBe(b.zone);
    expect([...a.confirmed].sort()).toEqual([...b.confirmed].sort());
    expect(computeScore([...all, ...all]).score).toBe(100);
  });

  it('hypotheses surface only as pending disclosure, never as points', () => {
    const r = computeScore([f('R2'), f('R3', 'hypothesis')]);
    expect(r.score).toBe(25);
    expect(r.pending).toEqual(['R3']);
    expect(r.confirmed).toEqual(['R2']);
  });
});

describe('S4.2 scoring freeze: component math and disclosure', () => {
  it('breakdown components sum to score and carry frozen version', () => {
    const b = scoreBreakdown([f('R2'), f('R3'), f('R1', 'hypothesis')]);
    expect(b.version).toBe(SIGNAL_WEIGHTS_VERSION);
    expect(b.score).toBe(35);
    expect(b.components.filter((c) => c.counted).map((c) => c.code)).toEqual(['R2', 'R3']);
    const sum = b.components.filter((c) => c.counted).reduce((s, c) => s + c.weight, 0);
    expect(Math.min(100, sum)).toBe(b.score);
    expect(b.components.map((c) => c.code)).toEqual(codes);
  });

  it('describeScore matches computeScore for every I-corpus total', () => {
    for (const [factors, score] of [
      [[f('R1')], 35],
      [[f('R2')], 25],
      [[f('R3')], 10],
      [[f('R4')], 15],
      [[f('R5')], 10],
      [[f('R6')], 5],
      [[], 0],
    ] as Array<[Factor[], number]>) {
      expect(computeScore(factors).score).toBe(score);
      expect(describeScore(factors)).toContain(String(score));
      expect(describeScore(factors)).toContain('v1');
    }
  });
});
