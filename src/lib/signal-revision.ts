import type { AppState } from './types';

// null means current; NaN preserves an explicitly invalid query instead of selecting live data.
export function parseSignalRevision(query: string): number | null {
  const params = new URLSearchParams(query);
  if (!params.has('revision')) return null;
  const raw = params.get('revision') ?? '';
  const value = Number(raw);
  return params.getAll('revision').length === 1 && /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(value) ? value : NaN;
}

export function signalRevisionError(state: AppState, zkId: string, revision: number | null): string {
  if (revision === null) return '';
  if (!Number.isSafeInteger(revision) || revision < 1) return 'Некорректная версия сигнала';
  return state.signalVersions?.[zkId]?.some(v => v.revision === revision) ? '' : 'Версия не найдена';
}
