import type { Code, Factor, Zone } from './types';
export const WEIGHTS: Record<Code, number> = { R1: 35, R2: 25, R3: 10, R4: 15, R5: 10, R6: 5 };
export const FACTOR_META: Record<Code, { title: string; hint: string }> = {
  R1: { title: 'Отсутствие применимого законного основания', hint: 'Только проверенное отсутствие. Нет данных ≠ R1.' },
  R2: { title: 'Прямое предложение внести деньги', hint: 'Платная бронь, депозит, первоначальный взнос.' },
  R3: { title: 'Активная реклама строящегося жилья', hint: 'Продвижение до ввода в эксплуатацию.' },
  R4: { title: 'Коллективное обращение', hint: 'Проверенное обращение о привлечении средств.' },
  R5: { title: 'Разрыв готовности ≥20 п.п.', hint: 'Два значения с источниками и датами.' },
  R6: { title: 'Простой или просрочка', hint: 'Документированное отклонение от сроков.' },
};
export const codes = Object.keys(WEIGHTS) as Code[];
export function computeScore(factors: Factor[]) {
  const confirmed = [...new Set(factors.filter(f => f.status === 'confirmed' && f.code in WEIGHTS).map(f => f.code))];
  const score = Math.min(100, confirmed.reduce((sum, c) => sum + WEIGHTS[c], 0));
  const zone: Zone = score >= 60 && confirmed.includes('R1') && confirmed.includes('R2') ? 'red' : score >= 25 ? 'yellow' : 'green';
  return { score, zone, confirmed, pending: factors.filter(f => ['hypothesis', 'needs-verification'].includes(f.status)).map(f => f.code) };
}
export const zoneLabel = (zone: Zone) => ({ green: 'Зелёная', yellow: 'Жёлтая', red: 'Красная' })[zone];
