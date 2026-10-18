/**
 * S2.4 (C6). Builder append-only версий сигнала.
 *
 * Контракт C6:
 *  - snapshot версии = Complex на момент решения (deep clone) + score/zone,
 *    посчитанные из ПРИНЯТОГО snapshot по WEIGHTS (scoring.ts); header и тело
 *    используют одну версию (weightsVersion фиксируется рядом со score);
 *  - в версию попадают ТОЛЬКО относящиеся материалы: публикации, цитируемые
 *    подтверждёнными факторами snapshot (adId), и файлы из их
 *    evidence.mediaIds → mediaManifest (mediaId/path/hash/bytes);
 *  - signed URL как постоянная ссылка НЕ хранится никогда: временная ссылка
 *    получается при чтении по path, в манифесте её нет по построению;
 *  - AI-provenance — только использованных решений: runId/hypothesisId из
 *    evidence подтверждённых факторов (реальный provenance даст серверный
 *    run в S4; клиентский `realAI:true` provenance не даёт);
 *  - `signals[zkId]` остаётся указателем на последнее решение (Detail читает
 *    его через адаптер); подтверждения/возвраты складываются в
 *    `signalVersions[zkId]` с revision = max+1, basedOnRevision = предыдущий
 *    max (null у первой); повтор с тем же commandId revision не создаёт;
 *  - legacy-сигнал эпохи до снимков (есть указатель confirmed/returned, нет
 *    версий) прошлое сегодняшними данными НЕ восстанавливает: помечается
 *    legacyIncomplete без snapshot и требует новой проверки перед экспортом.
 */
import type {
  AppState,
  Code,
  Complex,
  SignalAiProvenance,
  SignalMaterialManifest,
  SignalVersion,
  Zone,
} from './types';
import { computeScore } from './scoring';

/**
 * Версия весов оценки, зафиксированная в snapshot. Зеркало WEIGHTS из
 * scoring.ts и SQL-функции build_signal_version (миграция s2_4_signals):
 * при смене весов бампить ВСЕ ТРИ места одновременно, иначе header/тело
 * и TS/SQL разойдутся.
 */
export const SIGNAL_WEIGHTS_VERSION = 1;

/** Необязательный конверт решения сигнала (полный receipt — S2.2). */
export interface SignalDecisionOpts {
  /** ID намерения пользователя: retry повторяет тот же ID без новой revision. */
  commandId?: string;
  /** Версия workspace, из которой взят snapshot (S2.2 передаст из repository). */
  sourceVersion?: number;
}

export interface BuiltSignalSnapshot {
  snapshot: Complex;
  score: number;
  zone: Zone;
  weightsVersion: number;
  mediaManifest: SignalMaterialManifest[];
  aiProvenance: SignalAiProvenance[];
}

/**
 * Строит содержимое версии сигнала из ТЕКУЩЕГО состояния (вызывать на копии
 * внутри applyCommand до записи указателя — snapshot должен совпадать с тем,
 * что ляжет в signals[zkId].snapshot). Не мутирует вход.
 */
export function buildSignalSnapshot(state: AppState, zkId: string): BuiltSignalSnapshot {
  const z = state.complexes.find((c) => c.id === zkId);
  if (!z) throw new Error(`Сигнал без объекта: ${zkId} не найден среди complexes`);
  const snapshot = structuredClone(z);
  const { score, zone } = computeScore(snapshot.factors.filter((f) => f.status === 'confirmed'));
  const adsById = new Map(state.ads.map((a) => [a.id, a]));
  const mediaById = new Map(state.media.map((m) => [m.id, m]));
  const mediaManifest: SignalMaterialManifest[] = [];
  const aiProvenance: SignalAiProvenance[] = [];
  const seen = new Set<string>();
  for (const f of snapshot.factors) {
    if (f.status !== 'confirmed' || !f.evidence) continue;
    const ev = f.evidence;
    if (ev.adId !== undefined) {
      const ad = adsById.get(ev.adId);
      // Только относящиеся и только своего ЖК; dangling adId в confirmed
      // сюда попасть не должен (checkStateRefs отбрасывает раньше).
      if (ad && ad.zkId === zkId && !seen.has(`ad:${ad.id}`)) {
        seen.add(`ad:${ad.id}`);
        mediaManifest.push({ kind: 'ad', id: ad.id });
      }
    }
    for (const mid of ev.mediaIds ?? []) {
      const m = mediaById.get(mid);
      if (m && m.zkId === zkId && !seen.has(`media:${m.id}`)) {
        seen.add(`media:${m.id}`);
        mediaManifest.push({
          kind: 'media', id: m.id, path: m.path,
          sha256: m.sha256 ?? null, bytes: m.bytes ?? null,
        });
      }
    }
    if (ev.runId !== undefined) {
      aiProvenance.push({
        code: f.code as Code,
        runId: ev.runId,
        ...(ev.hypothesisId !== undefined ? { hypothesisId: ev.hypothesisId } : {}),
      });
    }
  }
  return { snapshot, score, zone, weightsVersion: SIGNAL_WEIGHTS_VERSION, mediaManifest, aiProvenance };
}

/** Последняя версия сигнала ЖК (null — версий ещё не было). */
export function latestSignalVersion(state: AppState, zkId: string): SignalVersion | null {
  const versions = state.signalVersions?.[zkId] ?? [];
  return versions.length > 0 ? versions[versions.length - 1] : null;
}

/** Следующая revision для append (max+1, не length+1 — устойчиво к порядку). */
export function nextRevisionFor(state: AppState, zkId: string): number {
  const versions = state.signalVersions?.[zkId] ?? [];
  return versions.reduce((max, v) => Math.max(max, v.revision), 0) + 1;
}

export const LEGACY_VERSION_ID_PREFIX = 'legacy-';
export const LEGACY_VERSION_ACTOR = 's2.4-migration';

/** Детерминированный ID legacy-метки (повторная пометка — no-op, дублей нет). */
export function legacyVersionId(zkId: string): string {
  return `${LEGACY_VERSION_ID_PREFIX}${zkId}-r1`;
}

/**
 * Помечает legacy-сигналы эпохи до снимков: есть указатель confirmed/returned,
 * но нет версий. Чистая функция (вход не мутирует): возвращает копию с
 * добавленными revision 1 {legacyIncomplete: true, БЕЗ snapshot} и список
 * помеченных zkId. Прошлое сегодняшними данными не восстанавливается —
 * snapshot указателя в версии НЕ копируется. Draft-указатели без решений
 * не помечаются (терять нечего). Повтор на помеченном — no-op.
 */
export function markLegacyIncompleteSignals(state: AppState): { state: AppState; marked: string[] } {
  const next = structuredClone(state);
  next.signalVersions ??= {};
  const marked: string[] = [];
  const at = new Date().toISOString();
  for (const [zkId, signal] of Object.entries(next.signals ?? {})) {
    if (signal.status !== 'confirmed' && signal.status !== 'returned') continue;
    const versions = next.signalVersions[zkId] ?? [];
    if (versions.length > 0) continue;
    const id = legacyVersionId(zkId);
    if (versions.some((v) => v.id === id)) continue;
    next.signalVersions[zkId] = [
      ...versions,
      {
        id, zkId, revision: 1, status: signal.status, at,
        reviewer: LEGACY_VERSION_ACTOR,
        comment:
          'S2.4: решение эпохи до снимков — полный snapshot отсутствует, ' +
          'прошлое сегодняшними данными не восстанавливается. Требуется новая ' +
          'проверка перед полноценным экспортом.',
        sourceVersion: 0,
        legacyIncomplete: true,
        basedOnRevision: null,
      },
    ];
    marked.push(zkId);
  }
  return { state: next, marked };
}

/**
 * Гейт экспорта (для S2.5/S5): true, если последняя версия — legacyIncomplete
 * и требуется новая проверка перед полноценным экспортом.
 */
export function needsSignalReverification(state: AppState, zkId: string): boolean {
  return latestSignalVersion(state, zkId)?.legacyIncomplete === true;
}
