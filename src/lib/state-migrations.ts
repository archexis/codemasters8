/**
 * S2.1 (C2). Миграции схемы persisted workspace: v2 → v3, legacy v1,
 * future-version отказ.
 *
 * Контракт:
 *  - v2 = всё, что лежит в `sq_svelte_demo_v2` без `schemaVersion`
 *    (все workspace эпохи S0/S1). Мигрирует автоматически при загрузке:
 *    добавляются schemaVersion=3 и signalVersions={}, исправимые сведения
 *    переносятся, неподкреплённые confirmed снимаются в needs-verification
 *    с provenance (factor.before + audit-запись), ничего не выдумывается.
 *    Повторная миграция уже мигрированного состояния — no-op (deepEqual).
 *  - future version (schemaVersion > 3) — понятный отказ от записи;
 *    исходник сохраняется отдельно и доступен для экспорта, хранилище
 *    молча НЕ перезаписывается.
 *  - битый JSON — отказ с сохранением исходника; initialState подставляется
 *    только в память и НЕ затирает хранимую строку.
 *  - legacy sq_state_v1 — только отдельная команда импорта из файла
 *    с preview (previewLegacyV1 / migrateLegacyV1); loadState ключ v1
 *    не читает и не пишет, raw backup остаётся нетронутым.
 */
import type { Ad, AppState, Code, Complex, Evidence, Factor } from './types';
import { MAX_SUPPORTED_SCHEMA_VERSION, SCHEMA_VERSION, isLegalBasisPair } from './types';
import { isDateLike, validateLoadedState } from './validation';
import {
  adBelongsTo,
  adContainsQuote,
  evidenceBelongsTo,
  hasAdRef,
  hasAppealMaterial,
  hasExplicitDate,
  hasMaterialText,
  hasQuote,
  hasReadinessGap,
  hasReadinessPair,
  hasVerifiedLegalAbsence,
  isDatedIdleFact,
  isDocument,
  isLegalReview,
  isPublication,
} from './grounding';
import { markLegacyIncompleteSignals } from './signal-snapshot';

export const V2_STORAGE_KEY = 'sq_svelte_demo_v2';
export const RAW_BACKUP_KEY = 'sq_svelte_demo_v2_raw_backup';
export const V1_STORAGE_KEY = 'sq_state_v1';
export const V1_IMPORT_BACKUP_KEY = 'sq_state_v1_import_source_backup';
export const MIGRATION_MARKER = 's2.1-schema-v3';
export const MIGRATION_ACTOR = 's2.1-migration';

/** Отказ future version: несёт найденную версию и исходник для экспорта. */
export class FutureVersionError extends Error {
  foundVersion: number;
  rawSource: string;
  constructor(foundVersion: number, rawSource: string) {
    super(
      `Workspace сохранён более новой версией приложения (schemaVersion=${foundVersion}, поддерживается ≤${MAX_SUPPORTED_SCHEMA_VERSION}). ` +
        `Запись заблокирована, чтобы не потерять данные: экспортируйте исходный файл и обновите приложение.`,
    );
    this.name = 'FutureVersionError';
    this.foundVersion = foundVersion;
    this.rawSource = rawSource;
  }
}

export interface MigrationResult {
  state: AppState;
  /** true, если вход был legacy и состояние изменено миграцией. */
  migrated: boolean;
  /** Человекочитаемые заметки о перенесённом/снятом (показываются в UI/логах). */
  notes: string[];
  /** Коды вида `SQ-001:R2`, снятые с confirmed (для тестов и отчётности). */
  downgraded: string[];
}

/** Быстрый взгляд на версию сырого объекта без полной валидации. */
export function detectSchemaVersion(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const v = (raw as Record<string, unknown>).schemaVersion;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Разбор текста хранилища с понятной ошибкой (исходник сохраняет вызывающий). */
export function parseRawState(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      'Сохранённый workspace повреждён (не JSON). Данные НЕ сброшены: исходная строка сохранена отдельно, в памяти подставлено начальное состояние.',
    );
  }
}

function stamp(): string {
  return new Date().toISOString();
}

/**
 * Минимальная проверка достаточности материала для confirmed — предикаты
 * из grounding.ts (общие с domain.validateFactor; модуль миграций по-прежнему
 * не зависит от domain). Возвращает null, если материал достаточен, иначе
 * причину снятия. Не выдумывает данные: любая нехватка = снятие с
 * provenance, не чинка.
 */
function groundingReason(z: Complex, adsById: Map<string, Ad>, mediaIds: Set<string>, code: Code, status: string, evidence: Factor['evidence']): string | null {
  if (status !== 'confirmed') return null;
  if (!evidence) return 'нет материала решения (evidence отсутствует)';
  if (!evidenceBelongsTo(evidence, z.id)) return `материал относится к другому объекту (${evidence.zkId})`;
  switch (code) {
    case 'R1': {
      if (!hasVerifiedLegalAbsence(z)) {
        return 'R1: правовое основание не имеет проверенного отсутствия (type/absent-verified)';
      }
      if (!isLegalReview(evidence)) return 'R1: нужен материал legal-review того же ЖК';
      if (!hasMaterialText(evidence)) return 'R1: нет сохранённого содержания сверки (evidence.text)';
      return null;
    }
    case 'R2':
    case 'R3': {
      if (!hasQuote(evidence)) return `${code}: нет дословной цитаты`;
      if (!isPublication(evidence)) return `${code}: нужен материал публикации`;
      if (!hasAdRef(evidence)) return `${code}: свободная цитата без привязки к публикации`;
      const ad = adsById.get(evidence.adId);
      if (!ad) return `${code}: публикация ${evidence.adId} не найдена в workspace`;
      if (!adBelongsTo(ad, z.id)) return `${code}: публикация ${evidence.adId} относится к другому ЖК`;
      if (!adContainsQuote(ad, evidence.quote ?? '')) return `${code}: цитата отсутствует в исходном тексте публикации`;
      if (code === 'R3' && !hasMaterialText(evidence)) return 'R3: нет датированного материала, что объект не введён';
      // S2.1 (C4): дата публикации неизвестна (ad.date=null) — confirmation
      // блокируется, пока evidence.text не несёт явной календарной даты,
      // позволяющей установить рекламу до ввода. captureAt датой не считается.
      if (code === 'R3' && ad.date == null && !hasExplicitDate(evidence.text)) {
        return 'R3: дата публикации неизвестна (null) и в материале нет явной даты до ввода — confirmation заблокирован';
      }
      return null;
    }
    case 'R4': {
      if (!isDocument(evidence)) return 'R4: нужен документ обращения';
      const knownMedia = (evidence.mediaIds ?? []).filter((id) => mediaIds.has(id));
      if (!hasAppealMaterial(evidence, knownMedia.length)) {
        return 'R4: нет сохранённого текста коллективного обращения о привлечении средств и нет файла';
      }
      return null;
    }
    case 'R5': {
      if (!hasReadinessGap(z)) {
        return 'R5: нет подтверждённого разрыва ≥20 п.п.';
      }
      if (!hasReadinessPair(z)) {
        return 'R5: нет двух наблюдений (claimed/confirmed) с источником и датой каждого';
      }
      return null;
    }
    case 'R6': {
      if (!isDocument(evidence)) return 'R6: нужен документ/текст наблюдения';
      if (!isDatedIdleFact(evidence.text)) return 'R6: нет датированного факта (срок/период простоя и объяснение значимости)';
      return null;
    }
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set(['R1', 'R2', 'R3', 'R4', 'R5', 'R6']);
const KNOWN_STATUSES: ReadonlySet<string> = new Set(['confirmed', 'hypothesis', 'rejected', 'needs-verification']);

/**
 * Миграция v2 → v3. Принимает распарсенный JSON. Не мутирует вход.
 * Бросает: FutureVersionError (schemaVersion > 3), Error с понятным
 * текстом (не объект / orphan zkId / неизвестный code/status).
 */
export function migrateV2ToV3(raw: unknown, rawText?: string): MigrationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Сохранённый workspace повреждён: ожидался объект состояния, исходник сохранён отдельно.');
  }
  const found = detectSchemaVersion(raw);
  if (found !== null && found > MAX_SUPPORTED_SCHEMA_VERSION) {
    throw new FutureVersionError(found, rawText ?? JSON.stringify(raw));
  }
  if (found === 1) {
    throw new Error(
      'Это legacy-формат v1 (sq_state_v1): автоматическая миграция отключена. Используйте отдельную команду импорта из файла с предварительным просмотром.',
    );
  }
  const rec = raw as Record<string, unknown>;
  const isV3 = found === SCHEMA_VERSION;
  if (isV3) {
    // v3 — уже актуальная версия: только строгая проверка, без переписывания
    // и без маркеров (повторный вход идемпотентен, migrated:false).
    return { state: validateLoadedState(rec), migrated: false, notes: [], downgraded: [] };
  }
  if (
    !Array.isArray(rec.complexes) ||
    !Array.isArray(rec.ads) ||
    (rec.media !== undefined && !Array.isArray(rec.media)) ||
    (rec.signals !== undefined && (typeof rec.signals !== 'object' || rec.signals === null || Array.isArray(rec.signals))) ||
    (rec.audit !== undefined && !Array.isArray(rec.audit))
  ) {
    throw new Error('Сохранённый workspace повреждён: неверная структура разделов (complexes/ads/media/signals/audit), исходник сохранён отдельно.');
  }

  const draft = structuredClone(rec) as Record<string, unknown> & {
    complexes: Complex[];
    ads: Ad[];
    media?: AppState['media'];
    signals?: AppState['signals'];
    audit?: AppState['audit'];
  };
  const notes: string[] = [];
  const downgraded: string[] = [];

  draft.schemaVersion = SCHEMA_VERSION;
  if (draft.signalVersions === undefined) {
    draft.signalVersions = {};
    notes.push('signalVersions: создан пустой задел C6 (версии появятся с S2.4).');
  }
  draft.media ??= [];
  draft.signals ??= {};
  draft.audit ??= [];

  const complexIds = new Set(draft.complexes.map((c) => c.id));
  for (const ad of draft.ads) {
    if (!complexIds.has(ad.zkId)) {
      throw new Error(`Workspace v2 не переносим: публикация ${ad.id} ссылается на неизвестный объект ${ad.zkId}. Исходник сохранён — привяжите публикацию вручную и повторите.`);
    }
    // S2.1 (C4): неизвестная/битая дата публикации — null, а не captureAt
    // и не дата импорта. sightings/runId/hypothesisId переносятся как есть
    // (строгая схема проверит их ниже).
    if (typeof ad.date !== 'string' || !isDateLike(ad.date)) {
      notes.push(`ad ${ad.id}: дата публикации неизвестна — перенесена как null («не указана»), captureAt ${ad.captureAt} датой не считается.`);
      ad.date = null;
    }
  }
  for (const m of draft.media) {
    if (!complexIds.has(m.zkId)) {
      throw new Error(`Workspace v2 не переносим: файл ${m.id} ссылается на неизвестный объект ${m.zkId}. Исходник сохранён.`);
    }
    if (m.bytes == null || m.sha256 == null) {
      notes.push(`media ${m.id}: только metadata без bytes/sha256 — байты не восстановлены (missing), запись валидна.`);
    }
  }

  const adsById = new Map(draft.ads.map((a) => [a.id, a]));
  const mediaIdSet = new Set(draft.media.map((m) => m.id));
  const at = stamp();
  for (const z of draft.complexes) {
    if (!Array.isArray(z.factors)) continue;
    for (const f of z.factors) {
      if (!KNOWN_CODES.has(f.code)) throw new Error(`Workspace v2 не переносим: неизвестный код фактора ${f.code} в ${z.id}. Исходник сохранён.`);
      if (!KNOWN_STATUSES.has(f.status)) {
        throw new Error(`Workspace v2 не переносим: неизвестный статус ${f.status} у фактора ${f.code} в ${z.id} (допустимы confirmed/hypothesis/rejected/needs-verification). Исходник сохранён.`);
      }
      // S2.1-стык#2 (C5-задел): сиротский hypothesisId без runId непереносим —
      // существование run проверить негде (analysis_runs — S4). Ссылку срезаем
      // с пометкой, runId не выдумываем; фактор остаётся hypothesis без ссылки.
      const evLink = f.evidence as unknown as Record<string, unknown> | undefined;
      if (evLink && evLink.hypothesisId !== undefined && evLink.runId === undefined) {
        delete evLink.hypothesisId;
        notes.push(`фактор ${z.id}:${f.code}: сиротский hypothesisId без runId срезан при миграции (run появится в S4); исходник — в backup.`);
      }
      const reason = groundingReason(z, adsById, mediaIdSet, f.code, f.status, f.evidence);
      if (reason === null) continue;
      const original = structuredClone(f);
      f.status = 'needs-verification';
      f.reviewer = MIGRATION_ACTOR;
      f.updatedAt = at;
      (f as { before?: unknown }).before = { status: 'confirmed', evidence: original.evidence ?? null, reason };
      downgraded.push(`${z.id}:${f.code}`);
      draft.audit.unshift({
        id: crypto.randomUUID(),
        commandId: `${MIGRATION_MARKER}-${z.id}-${f.code}`,
        zkId: z.id,
        actorId: MIGRATION_ACTOR,
        reviewer: MIGRATION_ACTOR,
        at,
        action: 's2_1_migration',
        comment: `S2.1: ${f.code} confirmed→needs-verification (${reason}). Исходное решение сохранено в factor.before; доказательства не придуманы.`,
        before: { status: 'confirmed', evidence: original.evidence ?? null },
        after: { status: 'needs-verification' },
        evidence: original.evidence ?? null,
        details: { migration: MIGRATION_MARKER, zkId: z.id, code: f.code, reason },
      });
    }
  }

  if (downgraded.length > 0) {
    notes.push(`Сняты с confirmed без достаточных данных: ${downgraded.join(', ')} (исходники — в factor.before и audit).`);
  } else {
    // Чистая миграция без снятий: audit-запись НЕ добавляем (только note),
    // иначе повторный прогон того же сырого v2 давал бы новую метку времени
    // и нарушал детерминизм/идемпотентность «повтор не меняет результат».
    notes.push('Все confirmed-решения подкреплены материалами; снятий не было.');
  }

  // Строгая проверка результата: любой остаточный dangling confirmed — отказ.
  // S2.4 (C6). Legacy-сигналы эпохи до снимков (указатель confirmed/returned
  // без версий) помечаются legacyIncomplete БЕЗ snapshot: прошлое сегодняшними
  // данными не восстанавливается, перед экспортом нужна новая проверка.
  // Draft-указатели без решений не помечаются. Повторная пометка — no-op.
  const legacyMarked = markLegacyIncompleteSignals(draft as unknown as AppState);
  draft.signalVersions = legacyMarked.state.signalVersions;
  if (legacyMarked.marked.length > 0) {
    notes.push(
      `Сигналы эпохи до снимков помечены legacyIncomplete без восстановления прошлого: ${legacyMarked.marked.join(', ')} (требуется новая проверка перед экспортом).`,
    );
  }
  const state = validateLoadedState(draft);
  return { state, migrated: true, notes, downgraded };
}

/**
 * Полный путь загрузки из текста хранилища: разбор → future-отказ →
 * миграция v2→v3 при необходимости → строгая валидация.
 */
export function loadStateFromText(text: string): MigrationResult {
  const raw = parseRawState(text);
  const found = detectSchemaVersion(raw);
  if (found !== null && found > MAX_SUPPORTED_SCHEMA_VERSION) {
    throw new FutureVersionError(found, text);
  }
  if (found === SCHEMA_VERSION) {
    return { state: validateLoadedState(raw as Record<string, unknown>), migrated: false, notes: [], downgraded: [] };
  }
  return migrateV2ToV3(raw, text);
}

/* ------------------------------------------------------------------ */
/* Legacy sq_state_v1: только импорт из файла с preview.                */
/* ------------------------------------------------------------------ */

export interface LegacyV1Preview {
  detected: boolean;
  complexes: number;
  ads: number;
  /** confirmed, которые при импорте будут сняты (нет материала). */
  wouldDowngrade: string[];
  notes: string[];
  risks: string[];
  sampleIds: string[];
}

/** Предпросмотр без мутаций: что будет перенесено, что снято, чем рискуем. */
export function previewLegacyV1(raw: unknown): LegacyV1Preview {
  const empty: LegacyV1Preview = { detected: false, complexes: 0, ads: 0, wouldDowngrade: [], notes: [], risks: [], sampleIds: [] };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...empty, notes: ['Не похоже на sq_state_v1: ожидался объект с complexes/ads.'] };
  }
  const rec = raw as Record<string, unknown>;
  if (!Array.isArray(rec.complexes)) {
    return { ...empty, notes: ['Не похоже на sq_state_v1: раздел complexes отсутствует или не массив.'] };
  }
  const ads = Array.isArray(rec.ads) ? (rec.ads as Ad[]) : [];
  const adsById = new Map(ads.map((a) => [a.id, a]));
  const mediaIds = new Set<string>();
  const wouldDowngrade: string[] = [];
  const sampleIds: string[] = [];
  for (const z of rec.complexes as Complex[]) {
    if (sampleIds.length < 5 && typeof z?.id === 'string') sampleIds.push(z.id);
    for (const f of (z?.factors ?? []) as Factor[]) {
      if (f?.status !== 'confirmed') continue;
      const reason = groundingReason(z, adsById, mediaIds, f.code, f.status, f.evidence);
      if (reason !== null) wouldDowngrade.push(`${z.id}:${f.code}`);
    }
  }
  const notes = [
    `Объектов: ${(rec.complexes as unknown[]).length}, публикаций: ${ads.length}.`,
    'Файлы v1 (metadata без bytes/sha256) переносятся как metadata-only: байты не восстанавливаются.',
    'Публикации v1 без даты переносятся с date=null («не указана»); R3 по ним требует датированного материала до ввода.',
    'Разделы media/signals/audit v1 отсутствуют — будут пустыми + одна import-запись в audit.',
  ];
  const risks = [
    'Импорт перезапишет текущий workspace: сначала экспортируйте его.',
    wouldDowngrade.length > 0
      ? `Снятий с confirmed: ${wouldDowngrade.length} (${wouldDowngrade.slice(0, 8).join(', ')}${wouldDowngrade.length > 8 ? '…' : ''}) — исходники лягут в factor.before.`
      : 'Все confirmed v1 подкреплены — снятий не будет.',
  ];
  return { detected: true, complexes: (rec.complexes as unknown[]).length, ads: ads.length, wouldDowngrade, notes, risks, sampleIds };
}

/**
 * Импорт v1-объекта в канонический v3. Не мутирует вход; ключ v1
 * в хранилище не читает и не трогает (raw backup остаётся нетронутым —
 * чтением файла управляет вызывающий в repository).
 */
export function migrateLegacyV1(raw: unknown): MigrationResult {
  const preview = previewLegacyV1(raw);
  if (!preview.detected) {
    throw new Error(`Импорт v1 невозможен: ${preview.notes[0] ?? 'формат не распознан.'}`);
  }
  const rec = raw as Record<string, unknown>;
  const at = stamp();
  const importDay = at.slice(0, 10);
  const complexes: Complex[] = (rec.complexes as Complex[]).map((z) => {
    const lb = z.legalBasis as Complex['legalBasis'] | undefined;
    const lbType = lb?.type ?? 'unknown';
    const lbStatus = lb?.status ?? 'unknown';
    const pairOk = (isLegalBasisPair as (t: string, s: string) => boolean)(String(lbType), String(lbStatus));
    const checkedRaw = lb?.checkedAt ?? '';
    const checkedOk = typeof checkedRaw === 'string' && isDateLike(checkedRaw);
    return {
      id: z.id,
      name: z.name ?? '',
      city: z.city ?? 'Өскемен',
      address: z.address ?? '',
      developer: z.developer ?? '',
      bin: z.bin ?? null,
      lat: z.lat ?? null,
      lng: z.lng ?? null,
      origin: z.origin ?? 'legacy-v1',
      stage: z.stage ?? '',
      readinessClaimed: z.readinessClaimed ?? null,
      readinessConfirmed: z.readinessConfirmed ?? null,
      readinessSources: z.readinessSources ?? [],
      readinessClaimedSource: z.readinessClaimedSource ?? null,
      legalBasis: {
        type: (pairOk ? lbType : 'unknown') as Complex['legalBasis']['type'],
        status: (pairOk ? lbStatus : 'unknown') as Complex['legalBasis']['status'],
        source: lb?.source ?? '',
        checkedAt: checkedOk ? (checkedRaw as string) : importDay,
        reviewText: lb?.reviewText ?? (checkedOk ? '' : `legacy v1: дата сверки отсутствовала, проставлена дата импорта ${importDay}`),
      },
      note: z.note ?? '',
      factors: (z.factors ?? []).map((f) => {
        const ev = (f.evidence ?? {}) as Record<string, unknown>;
        const kindRaw = typeof ev.kind === 'string' ? ev.kind : ev.adId ? 'publication' : 'document';
        const kind: Evidence['kind'] =
          kindRaw === 'publication' || kindRaw === 'legal-review' || kindRaw === 'observation' || kindRaw === 'document'
            ? kindRaw
            : ev.adId ? 'publication' : 'document';
        return {
          ...f,
          evidence: {
            id: typeof ev.id === 'string' && ev.id ? ev.id : `v1-${z.id}-${f.code}`,
            zkId: typeof ev.zkId === 'string' && ev.zkId ? ev.zkId : z.id,
            kind,
            source: typeof ev.source === 'string' ? ev.source : '',
            date: typeof ev.date === 'string' && isDateLike(ev.date) ? ev.date : importDay,
            ...(typeof ev.adId === 'string' ? { adId: ev.adId } : {}),
            ...(typeof ev.quote === 'string' ? { quote: ev.quote } : {}),
            ...(typeof ev.text === 'string' ? { text: ev.text } : {}),
            // S2.1 (C5-задел): ссылки на run переживают импорт как есть.
            ...(typeof ev.runId === 'string' ? { runId: ev.runId } : {}),
            ...(typeof ev.hypothesisId === 'string' ? { hypothesisId: ev.hypothesisId } : {}),
          },
        };
      }),
      events: z.events ?? [],
      sources: z.sources ?? [],
    };
  });
  const ads: Ad[] = (Array.isArray(rec.ads) ? (rec.ads as Ad[]) : []).map((a, i) => ({
    ...a,
    id: a.id ?? `v1-ad-${i}`,
    // S2.1 (C4): неизвестная дата публикации v1 — null («не указана»),
    // а не дата импорта. captureAt импорта — время фиксации, не дата.
    date: typeof a.date === 'string' && isDateLike(a.date) ? a.date : null,
    captureAt: a.captureAt ?? importDay,
  }));
  const notes = [...preview.notes];
  const downgraded: string[] = [];
  const adsById = new Map(ads.map((a) => [a.id, a]));
  for (const z of complexes) {
    for (const f of z.factors) {
      if (!KNOWN_CODES.has(f.code)) throw new Error(`Импорт v1 невозможен: неизвестный код фактора ${f.code} в ${z.id}.`);
      if (!KNOWN_STATUSES.has(f.status)) {
        throw new Error(`Импорт v1 невозможен: неизвестный статус ${f.status} у ${f.code} в ${z.id}.`);
      }
      const reason = groundingReason(z, adsById, new Set(), f.code, f.status, f.evidence);
      if (reason === null) continue;
      const original = structuredClone(f);
      f.status = 'needs-verification';
      f.reviewer = MIGRATION_ACTOR;
      f.updatedAt = at;
      (f as { before?: unknown }).before = { status: 'confirmed', evidence: original.evidence ?? null, reason };
      downgraded.push(`${z.id}:${f.code}`);
    }
  }
  const state: AppState = {
    schemaVersion: SCHEMA_VERSION,
    complexes,
    ads,
    media: [],
    signals: {},
    signalVersions: {},
    audit: [
      {
        id: crypto.randomUUID(),
        commandId: `${MIGRATION_MARKER}-legacy-v1`,
        zkId: complexes[0]?.id ?? 'workspace',
        actorId: MIGRATION_ACTOR,
        reviewer: MIGRATION_ACTOR,
        at,
        action: 's2_1_legacy_import',
        comment: `S2.1: импорт legacy v1 (${complexes.length} объектов, ${ads.length} публикаций). Снято с confirmed: ${downgraded.length}. Raw backup v1 нетронут.`,
        details: { migration: MIGRATION_MARKER, kind: 'legacy-v1-import', downgraded },
      },
    ],
  };
  if (downgraded.length > 0) notes.push(`Сняты с confirmed: ${downgraded.join(', ')}.`);
  return { state: validateLoadedState(state), migrated: true, notes, downgraded };
}
