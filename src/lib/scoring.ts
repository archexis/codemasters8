import type { Code, Factor, Zone } from './types';

/**
 * S4.2 (C5). Замороженная версия весов скоринга.
 * Зеркало: signal-snapshot.SIGNAL_WEIGHTS_VERSION и SQL build_signal_version
 * (миграция s2_4_signals). При смене весов бампить ВСЕ места одновременно,
 * иначе header/тело сигнала и TS/SQL разойдутся. Канон версии — здесь.
 */
export const SIGNAL_WEIGHTS_VERSION = 1;

/** Замороженные веса: мутация запрещена (см. tests/unit/scoring-attack.test.ts). */
export const WEIGHTS: Record<Code, number> = { R1: 35, R2: 25, R3: 10, R4: 15, R5: 10, R6: 5 };
Object.freeze(WEIGHTS);
export const FACTOR_META: Record<Code, { title: string; hint: string }> = {
  R1: { title: 'Отсутствие применимого законного основания', hint: 'Только проверенное отсутствие. Нет данных ≠ R1.' },
  R2: { title: 'Прямое предложение внести деньги', hint: 'Платная бронь, депозит, первоначальный взнос.' },
  R3: { title: 'Активная реклама строящегося жилья', hint: 'Продвижение до ввода в эксплуатацию.' },
  R4: { title: 'Коллективное обращение', hint: 'Проверенное обращение о привлечении средств.' },
  R5: { title: 'Разрыв готовности ≥20 п.п.', hint: 'Два значения с источниками и датами.' },
  R6: { title: 'Простой или просрочка', hint: 'Документированное отклонение от сроков.' },
};
export const codes = Object.keys(WEIGHTS) as Code[];
export function zoneFor(score: number, confirmed: readonly string[]): Zone {
  const set = new Set(confirmed);
  return score >= 60 && set.has('R1') && set.has('R2') ? 'red' : score >= 25 ? 'yellow' : 'green';
}
export function computeScore(factors: Factor[]) {
  const confirmed = [...new Set(factors.filter(f => f.status === 'confirmed' && f.code in WEIGHTS).map(f => f.code))];
  const score = Math.min(100, confirmed.reduce((sum, c) => sum + WEIGHTS[c], 0));
  const zone = zoneFor(score, confirmed);
  return { score, zone, confirmed, pending: factors.filter(f => ['hypothesis', 'needs-verification'].includes(f.status)).map(f => f.code) };
}

/* ------------------------------------------------------------------ */
/* S4.2 (C5). Раскрываемый детерминированный расчёт: покомпонентная    */
/* математика и disclosure. Чистые функции поверх замороженных WEIGHTS */
/* (computeScore/zoneFor не меняются — корпус I01–I18 опирается на них).*/
/* ------------------------------------------------------------------ */

/** Вклад одного фактора в раскрытии расчёта. */
export interface ScoreComponent { code: Code; weight: number; counted: boolean }

/** Полное раскрытие расчёта: итог + покомпонентная математика + версия весов. */
export interface ScoreBreakdown {
  score: number; zone: Zone; version: number;
  confirmed: string[]; pending: string[];
  components: ScoreComponent[];
}

/**
 * Детерминированное раскрытие: те же confirmed/score/zone, что computeScore,
 * плюс покомпонентная математика (порядок — канон codes, не порядок входа)
 * и замороженная версия весов. Сумма counted-компонент всегда равна score
 * (cap 100 учтён: сумма весов R1–R6 ровно 100, дубли схлопнуты).
 */
export function scoreBreakdown(factors: Factor[]): ScoreBreakdown {
  const r = computeScore(factors);
  const counted = new Set(r.confirmed);
  return {
    score: r.score, zone: r.zone, version: SIGNAL_WEIGHTS_VERSION,
    confirmed: [...r.confirmed], pending: [...r.pending],
    components: codes.map((c) => ({ code: c, weight: WEIGHTS[c], counted: counted.has(c) })),
  };
}

/** Однострочное disclosure для header/аудита: версия, слагаемые, зона. */
export function describeScore(factors: Factor[]): string {
  const b = scoreBreakdown(factors);
  const parts = b.components.filter((c) => c.counted).map((c) => `${c.code} +${c.weight}`);
  return `v${b.version} · ${b.score} = ${parts.length ? parts.join(' + ') : '0'} · зона ${b.zone}`;
}
export const zoneLabel = (zone: Zone) => ({ green: 'Зелёная', yellow: 'Жёлтая', red: 'Красная' })[zone];
