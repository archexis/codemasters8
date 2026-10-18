/**
 * S4.4 (C6). Детерминированный гейт экспорта сигнальной карточки.
 *
 * Контракт:
 *  - в экспорт попадают ТОЛЬКО confirmed факторы с заземлённым evidence
 *    (adId разрешается в публикацию того же ЖК, quote — точная подстрока
 *    её текста; evidence без adId — только не-publication с источником);
 *    незаземлённое confirmed не молча выбрасывается, а перечисляется в
 *    `excluded` с причиной;
 *  - reason модели и comment аналитика — отдельные поля; reason никогда
 *    не подставляется как решение аналитика (comment берётся из audit,
 *    modelReason — из modelReason ad-команды);
 *  - needsSignalReverification (legacyIncomplete) блокирует полный
 *    экспорт: kind='blocked', материалов нет;
 *  - draft и legacy помечены маркерами; kind='draft' пока сигнал не
 *    подтверждён версией;
 *  - signed URL не хранится никогда: материалы — только ad id и
 *    mediaId/path/hash/bytes (зеркало C6-манифеста signal-snapshot).
 */
import type { Ad, AppState, Code, Zone } from './types';
import { computeScore } from './scoring';
import {
  SIGNAL_WEIGHTS_VERSION,
  latestSignalVersion,
  needsSignalReverification,
} from './signal-snapshot';

/** Версия шаблона экспортной карточки (метка backend — workspace-data/v1). */
export const EXPORT_TEMPLATE_VERSION = 'signal-card/v1';

export type ExportKind = 'full' | 'draft' | 'blocked';

export interface ExportEvidenceItem {
  code: Code;
  quote?: string;
  source: string;
  date?: string;
  adId?: string;
  /** Обоснование аналитика (из audit). Не reason модели. */
  comment: string;
  /** Reason модели (из modelReason ad-команды) — отдельно, может отсутствовать. */
  modelReason: string | null;
  provenance?: { runId: string; hypothesisId?: string };
}

export interface ExportExcluded {
  code: Code;
  reason: string;
}

export type ExportMaterial =
  | { kind: 'ad'; id: string; date: string | null; sourceUrl?: string }
  | { kind: 'media'; id: string; path: string; sha256: string | null; bytes: number | null };

export interface BuiltExport {
  template: string;
  kind: ExportKind;
  zkId: string;
  complexName: string;
  signalStatus: 'draft' | 'confirmed' | 'returned';
  score: number;
  zone: Zone;
  weightsVersion: number;
  evidence: ExportEvidenceItem[];
  excluded: ExportExcluded[];
  needsReverification: Code[];
  materials: ExportMaterial[];
  markers: string[];
  blockedReason?: string;
  exportedAt: string;
}

/** Имя файла экспорта: шаблон + объект + вид (детерминировано). */
export function exportFilename(zkId: string, kind: ExportKind): string {
  const safe = String(zkId || 'unknown').replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unknown';
  return `saq-signal-${safe}-${kind}.json`;
}

/** Последний analyst-comment по коду фактора (audit — новые первыми). */
function analystCommentFor(state: AppState, zkId: string, code: Code): string {
  for (const e of state.audit) {
    if (e.zkId !== zkId) continue;
    const d = e.details as
      | { type?: string; code?: string; hypothesis?: { code?: string } }
      | null
      | undefined;
    if (!d || typeof d !== 'object') continue;
    if (d.type === 'factor' && d.code === code) return e.comment;
    if (d.type === 'ad' && d.hypothesis?.code === code) return e.comment;
  }
  return '';
}

/** Reason модели по коду фактора (только modelReason ad-команды). */
function modelReasonFor(state: AppState, zkId: string, code: Code): string | null {
  for (const e of state.audit) {
    if (e.zkId !== zkId) continue;
    const d = e.details as
      | { type?: string; hypothesis?: { code?: string }; modelReason?: unknown }
      | null
      | undefined;
    if (d?.type === 'ad' && d.hypothesis?.code === code && typeof d.modelReason === 'string' && d.modelReason.trim()) {
      return d.modelReason;
    }
  }
  return null;
}

function httpUrl(url: string | undefined): string | undefined {
  if (typeof url !== 'string') return undefined;
  const v = url.trim();
  return /^https?:\/\//i.test(v) ? v : undefined;
}

/**
 * Строит экспортную карточку объекта. Чистая функция (вход не мутирует).
 * needs-verification факторы в баллы не входят и перечисляются отдельно.
 */
export function buildExport(state: AppState, zkId: string): BuiltExport {
  const z = state.complexes.find((c) => c.id === zkId);
  if (!z) throw new Error(`Экспорт: объект ${zkId} не найден`);
  const signalStatus = state.signals[zkId]?.status ?? 'draft';
  const exportedAt = new Date().toISOString();
  const base = {
    template: EXPORT_TEMPLATE_VERSION,
    zkId,
    complexName: z.name,
    signalStatus,
    exportedAt,
  };

  // Legacy-решение эпохи до снимков: прошлое не реконструируется —
  // полный экспорт заблокирован до новой проверки.
  if (needsSignalReverification(state, zkId)) {
    return {
      ...base,
      kind: 'blocked',
      score: 0,
      zone: 'green',
      weightsVersion: SIGNAL_WEIGHTS_VERSION,
      evidence: [],
      excluded: [],
      needsReverification: [],
      materials: [],
      markers: ['legacy-incomplete', 'needs-reverification'],
      blockedReason:
        'Решение эпохи до снимков (legacyIncomplete): полный экспорт заблокирован, ' +
        'требуется новая проверка перед экспортом.',
    };
  }

  const adsById = new Map<string, Ad>(state.ads.map((a) => [a.id, a]));
  const mediaById = new Map(state.media.map((m) => [m.id, m]));
  const evidence: ExportEvidenceItem[] = [];
  const excluded: ExportExcluded[] = [];
  const needsReverification: Code[] = [];
  const materials: ExportMaterial[] = [];
  const seenMaterials = new Set<string>();

  for (const f of z.factors) {
    if (f.status === 'needs-verification') {
      needsReverification.push(f.code);
      continue;
    }
    if (f.status !== 'confirmed') continue;
    const ev = f.evidence;
    if (!ev) {
      excluded.push({ code: f.code, reason: 'no-evidence' });
      continue;
    }
    // Заземление: adId разрешается в публикацию того же ЖК.
    const ad = ev.adId !== undefined ? adsById.get(ev.adId) : undefined;
    if (ev.adId !== undefined) {
      if (!ad) {
        excluded.push({ code: f.code, reason: `ad-missing:${ev.adId}` });
        continue;
      }
      if (ad.zkId !== zkId) {
        excluded.push({ code: f.code, reason: `ad-other-zk:${ev.adId}` });
        continue;
      }
      if (ev.kind === 'publication' && (!ev.quote || !ev.quote.trim())) {
        excluded.push({ code: f.code, reason: 'quote-missing' });
        continue;
      }
      if (ev.quote !== undefined && !ad.text.includes(ev.quote)) {
        excluded.push({ code: f.code, reason: `quote-ungrounded:${ev.adId}` });
        continue;
      }
    } else if (!ev.source?.trim()) {
      excluded.push({ code: f.code, reason: 'source-missing' });
      continue;
    }
    const item: ExportEvidenceItem = {
      code: f.code,
      ...(ev.quote !== undefined ? { quote: ev.quote } : {}),
      source: ev.source,
      ...(ev.date !== undefined ? { date: ev.date } : {}),
      ...(ev.adId !== undefined ? { adId: ev.adId } : {}),
      comment: analystCommentFor(state, zkId, f.code),
      modelReason: modelReasonFor(state, zkId, f.code),
      ...(ev.runId !== undefined
        ? {
          provenance: {
            runId: ev.runId,
            ...(ev.hypothesisId !== undefined ? { hypothesisId: ev.hypothesisId } : {}),
          },
        }
        : {}),
    };
    evidence.push(item);
    // Материалы — только относящиеся: цитируемая публикация и файлы её evidence.
    if (ad && !seenMaterials.has(`ad:${ad.id}`)) {
      seenMaterials.add(`ad:${ad.id}`);
      const url = httpUrl(ad.url);
      materials.push({ kind: 'ad', id: ad.id, date: ad.date, ...(url ? { sourceUrl: url } : {}) });
    }
    for (const mid of ev.mediaIds ?? []) {
      const m = mediaById.get(mid);
      if (m && m.zkId === zkId && !seenMaterials.has(`media:${m.id}`)) {
        seenMaterials.add(`media:${m.id}`);
        materials.push({ kind: 'media', id: m.id, path: m.path, sha256: m.sha256 ?? null, bytes: m.bytes ?? null });
      }
    }
  }

  const { score, zone } = computeScore(
    evidence.map((e) => ({ code: e.code, status: 'confirmed' as const })),
  );
  const latest = latestSignalVersion(state, zkId);
  const full = signalStatus === 'confirmed' && latest?.status === 'confirmed' && latest.legacyIncomplete !== true;
  return {
    ...base,
    kind: full ? 'full' : 'draft',
    score,
    zone,
    weightsVersion: SIGNAL_WEIGHTS_VERSION,
    evidence,
    excluded,
    needsReverification,
    materials,
    markers: full ? [] : ['draft', signalStatus === 'draft' ? 'signal-not-confirmed' : 'version-not-confirmed'],
  };
}
