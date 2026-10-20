/**
 * Паритет скоринга TS ↔ SQL ↔ UI (защита от рассинхрона зеркал).
 *
 * Канон — src/lib/scoring.ts (SIGNAL_WEIGHTS_VERSION + WEIGHTS + zoneFor).
 * Зеркала: src/lib/signal-snapshot.ts (только реэкспорт версии, дубля нет),
 * SQL build_signal_version (s2_4, s5) и case-snapshot (ux_case_ledger),
 * src/components/Signal.svelte (веса рендерятся из WEIGHTS, хардкода нет).
 * Тест читает файлы как текст: смена веса/порога в одном месте без остальных
 * падает здесь, а не в проде.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SIGNAL_WEIGHTS_VERSION,
  WEIGHTS,
  codes,
  computeScore,
  zoneFor,
} from '../../src/lib/scoring';
import { SIGNAL_WEIGHTS_VERSION as SNAPSHOT_VERSION } from '../../src/lib/signal-snapshot';
import type { Code, Factor } from '../../src/lib/types';

const EXPECTED_WEIGHTS: Record<Code, number> = { R1: 35, R2: 25, R3: 10, R4: 15, R5: 10, R6: 5 };

const SQL_MIRRORS = [
  'supabase/migrations/20261018180000_s2_4_signals.sql',
  'supabase/migrations/20261019000500_s5_signal_cycle.sql',
  'supabase/migrations/20261019033830_ux_case_ledger.sql',
];

/**
 * Веса R-кодов из SQL-текста. Два стиля зеркал:
 * if/elsif (s2_4, s5): `elsif c = 'R2' then score := score + 25;`
 * case-when (ledger): `case c when 'R2' then 25 ...`.
 */
function extractSqlWeights(sql: string): Record<string, number> {
  const out: Record<string, number> = {};
  const patterns = [
    /(?:if|elsif)\s+c\s*=\s*'(R[1-6])'\s+then\s+score\s*:=\s*score\s*\+\s*(\d+)/g,
    /when\s+'(R[1-6])'\s+then\s+(\d+)/g,
  ];
  for (const re of patterns) {
    for (const m of sql.matchAll(re)) out[m[1]] = Number(m[2]);
  }
  return out;
}

const f = (code: Code): Factor => ({ code, status: 'confirmed' });

describe('scoring parity: single source of weights version', () => {
  it('signal-snapshot re-exports the version instead of duplicating it', () => {
    expect(SNAPSHOT_VERSION).toBe(SIGNAL_WEIGHTS_VERSION);
    expect(SIGNAL_WEIGHTS_VERSION).toBe(1);
    const snapshotSrc = readFileSync('src/lib/signal-snapshot.ts', 'utf8');
    expect(snapshotSrc).not.toMatch(/export\s+const\s+SIGNAL_WEIGHTS_VERSION/);
    expect(snapshotSrc).toMatch(/export\s*\{\s*SIGNAL_WEIGHTS_VERSION\s*\}\s*from/);
  });

  it('WEIGHTS match the frozen map', () => {
    expect({ ...WEIGHTS }).toEqual(EXPECTED_WEIGHTS);
    expect(codes).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6']);
  });
});

describe('scoring parity: SQL mirrors', () => {
  for (const file of SQL_MIRRORS) {
    it(`${file}: weights match WEIGHTS`, () => {
      const sql = readFileSync(file, 'utf8');
      expect(extractSqlWeights(sql)).toEqual(EXPECTED_WEIGHTS);
    });

    it(`${file}: thresholds red>=60 with R1+R2, yellow>=25`, () => {
      const sql = readFileSync(file, 'utf8');
      expect(sql).toMatch(/score\s*>=\s*60/);
      expect(sql).toMatch(/score\s*>=\s*25/);
      // red — только при паре R1+R2 (флаги has_r1/has_r2 либо массив codes @>).
      expect(sql).toMatch(/has_r1\s+and\s+has_r2|codes\s*@>\s*array\['R1'\s*,\s*'R2'\]/);
    });

    it(`${file}: weightsVersion matches SIGNAL_WEIGHTS_VERSION`, () => {
      const sql = readFileSync(file, 'utf8');
      const m = sql.match(/'weightsVersion'\s*,\s*(\d+)/);
      expect(m, 'weightsVersion literal missing in SQL').not.toBeNull();
      expect(Number(m![1])).toBe(SIGNAL_WEIGHTS_VERSION);
    });
  }

  it('zoneFor behaves like the SQL thresholds', () => {
    expect(zoneFor(60, ['R1', 'R2'])).toBe('red');
    expect(zoneFor(100, ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'])).toBe('red');
    // 60 без пары R1+R2 — yellow, не red.
    expect(zoneFor(60, ['R1', 'R3', 'R4'])).toBe('yellow');
    expect(zoneFor(25, [])).toBe('yellow');
    expect(zoneFor(24, ['R3', 'R4'])).toBe('green');
    expect(computeScore(codes.map(f))).toMatchObject({ score: 100, zone: 'red' });
  });
});

describe('scoring parity: Signal.svelte renders weights from WEIGHTS', () => {
  it('no hardcoded weight list in the template', () => {
    const src = readFileSync('src/components/Signal.svelte', 'utf8');
    expect(src).not.toMatch(/R1 35/);
    expect(src).toMatch(/WEIGHTS\[/);
  });
});
