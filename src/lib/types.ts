export type Code = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6';
export type FactorStatus = 'confirmed' | 'hypothesis' | 'rejected' | 'needs-verification';
export type Zone = 'green' | 'yellow' | 'red';

/** C1. Минимальное доказательство: расширяет прежний {source,quote,date,adId}. */
export type EvidenceKind = 'publication' | 'legal-review' | 'observation' | 'document';
export interface BeforeCommissioning {source:string;date:string;text:string}
export interface Evidence {
  id: string; zkId: string; kind: EvidenceKind;
  source: string; date: string; // реальная календарная YYYY-MM-DD
  adId?: string; quote?: string;
  text?: string; // зафиксированное содержание акта/документа/сверки
  mediaIds?: string[]; // файлы добавляются в S2; для текстового доказательства не требуются
  /**
   * S2.1 (C5-задел, поток S4). Ссылка решения на доверенный серверный run:
   * проверяется по analysis_runs в S4 (ownership, успех run, совпадение
   * input/цитаты). Клиентский `realAI:true` provenance не даёт.
   */
  beforeCommissioning?: BeforeCommissioning;
  runId?: string; hypothesisId?: string;
}
/**
 * То, что присылает клиент в factor-команде. id/zkId/kind/date подставляет
 * парсер (validation.ts): Detail.svelte и старые клиенты шлют только
 * {source, quote, date}, и это обязано проходить типовую проверку.
 */
export interface EvidenceInput {
  id?: string; zkId?: string; kind?: EvidenceKind;
  source: string; date?: string;
  adId?: string; quote?: string; text?: string; mediaIds?: string[];
  /** S2.1 (C5-задел): ссылка на серверный analysis run / гипотезу (проверка — S4). */
  beforeCommissioning?: BeforeCommissioning;
  runId?: string; hypothesisId?: string;
}

/** C1. Варианты продукта, не исчерпывающая юридическая классификация. */
export type LegalBasisType = 'unknown' | 'absent' | 'guarantee' | 'mio-permit';
export type LegalBasisStatus = 'unknown' | 'absent-verified' | 'verified';
export interface LegalBasis {
  type: LegalBasisType; status: LegalBasisStatus;
  source: string; checkedAt: string; // YYYY-MM-DD даты сверки
  reviewText: string; // сохранённое описание области сверки и её результата
}
/** Единственные согласованные пары type/status. Иное — отдельное уточнение, не подмена. */
export const LEGAL_BASIS_PAIRS: ReadonlyArray<readonly [LegalBasisType, LegalBasisStatus]> = [
  ['unknown', 'unknown'],
  ['absent', 'absent-verified'],
  ['guarantee', 'verified'],
  ['mio-permit', 'verified'],
];
export function isLegalBasisPair(type: string, status: string): boolean {
  return LEGAL_BASIS_PAIRS.some(([t, s]) => t === type && s === status);
}

/** C1. Заявленная готовность с происхождением: значение + источник + дата. */
export interface ClaimedSource { value: number; source: string; date: string }

export interface Factor { code: Code; status: FactorStatus; evidence?: Evidence; reviewer?: string; updatedAt?: string }
export interface Complex {
  id: string; name: string; city: string; address: string; developer: string; bin: string | null;
  lat?: number | null; lng?: number | null; demo?: boolean; origin: string; scenario?: string;
  stage: string; readinessClaimed: number | null; readinessConfirmed: number | null;
  readinessSources: { value: number; source: string; date: string }[];
  /** Null = происхождение заявленной готовности не зафиксировано (legacy до S1.4). */
  readinessClaimedSource: ClaimedSource | null;
  legalBasis: LegalBasis;
  note: string; factors: Factor[]; events: { date: string; text: string }[];
  sources: { title: string; date: string; url?: string }[];
  version?: number;
}
export interface Ad {
  id: string; zkId: string; platform: string; account: string;
  /**
   * S2.1 (C4-задел). Дата публикации: неизвестная — null, UI «не указана».
   * captureAt всегда время фиксации; считать captureAt датой публикации
   * нельзя. R3 с date=null требует датированного материала до ввода (S2.1:
   * evidence.text с явной датой, иначе confirmation блокируется).
   */
  date: string | null;
  url: string; captureAt: string; text: string; decision?: string; analysis?: Analysis;
  /**
   * S2.1 (стык 4). Несколько фиксаций одного текста в том же ЖК: MVP не
   * создаёт второй ad — повторные источники копятся здесь (источник, его
   * дата/ссылка/время фиксации). Отсутствие = фиксация одна (эта запись).
   */
  sightings?: AdSighting[];
}
/** S2.1 (стык 4). Одна фиксация публикации: кто/когда зафиксировал (дата источника может быть неизвестна — null). */
export interface AdSighting { source: string; date: string | null; url?: string; captureAt: string }
/**
 * S3.3 (C4). Одна строка CSV-импорта: построчный preview → выбор одной
 * валидной строки → явное сопоставление ЖК → сохранение.
 * date=null = дата в строке отсутствует (не предыдущая/сегодня);
 * dateRaw — сырая строка даты из CSV; errors блокируют save строки;
 * mappedZkId — предсопоставление по точному ID (null = unknown/ambiguous);
 * suggestionId — предложение по уникальному имени (требует подтверждения);
 * savedAdId — ID созданной публикации (повторный импорт запрещён).
 */
export type CsvHintKind = 'id' | 'name' | 'unknown' | 'ambiguous';
export interface CsvRow {
  rowId: string; rowNumber: number;
  text: string; platform: string; account: string;
  date: string | null; dateRaw: string; url: string; zkHint: string;
  errors: string[]; hintKind: CsvHintKind;
  mappedZkId: string | null; suggestionId: string | null; savedAdId: string | null;
}
/** S3.3 (C4). Результат построчного разбора CSV: PapaParse сохранён. */
export interface CsvParseResult { rows: CsvRow[]; errors: string[]; delim: string }
export interface Hypothesis {
  code: Code; quote: string; reason: string;
  /** S2.1 (C5-задел, поток S4): стабильный ID гипотезы внутри analysis run. */
  id?: string;
}
export interface Analysis { input?: unknown; runId?: string; inputHash?: string; status?: 'succeeded'; engine: string; realAI: boolean; hypotheses: Hypothesis[] }
export interface Media {
  id: string; zkId: string; name: string; kind: string; date: string; note: string; ready: number | null; path: string;
  /**
   * S2 (C3). Целостность байтов: размер и SHA-256 файла в хранилище.
   * Старые записи без них валидны — байты не восстанавливаются задним
   * числом, отсутствие означает «только metadata», а не «проверено».
   */
  bytes?: number | null; sha256?: string | null; capturedAt?: string;
}
export interface AuditEvent {
  id: string;
  /**
   * S2 (C2). ID намерения пользователя: retry повторяет тот же commandId.
   * У записей до S2 отсутствует — это нормально, не признак порчи.
   */
  commandId?: string;
  zkId: string;
  /**
   * S2 (C2). Серверный автор решения. `reviewer` оставлен для совместимости
   * со старыми записями (там лежит то же значение — e-mail/роль автора).
   */
  actorId?: string;
  at: string; reviewer: string; action: string; comment: string;
  /**
   * S2 (C2). Снимок изменения: было/стало + материал, на котором основано
   * решение. Хранится достаточное содержание изменения, а не копия всего
   * workspace. У старых записей вместо этого — `details` с командой.
   */
  before?: unknown; after?: unknown; evidence?: unknown;
  details?: unknown;
}
export interface Signal { basedOnRevision?: number | null; reason?: string; status: 'draft' | 'confirmed' | 'returned'; snapshot?: Complex; at: string; reviewer: string; comment: string }
/**
 * S2.4 (C6). Манифест материалов, на которых основано решение версии сигнала.
 * Только относящиеся к решению записи: публикации, цитируемые подтверждёнными
 * факторами версии, и файлы из их evidence.mediaIds. Постоянных ссылок нет:
 * хранятся mediaId/path/hash, временная signed-ссылка получается при чтении.
 */
export interface SignalMaterialManifest {
  kind: 'ad' | 'media'; id: string;
  name?: string; mediaKind?: string; capturedAt?: string; note?: string;
  /** Только для media: стабильный путь в приватном bucket. */
  path?: string;
  /** Только для media: целостность байтов (могут отсутствовать у legacy metadata-only). */
  sha256?: string | null; bytes?: number | null;
}
/**
 * S2.4 (C6). AI-provenance ТОЛЬКО использованных решений: runId/hypothesisId
 * из evidence подтверждённых факторов версии. Клиентский `realAI:true`
 * provenance не даёт (проверка ownership/input — S4, таблица analysis_runs).
 */
export interface SignalAiProvenance { provider?:string; model?:string; promptVersion?:string; inputHash?:string; origin?:string; reason?:string; code: Code; runId: string; hypothesisId?: string }
/**
 * S2 (C6, задел S2.1). Append-only версия сигнала. `signals[zkId]` остаётся
 * текущим draft/указателем на последнее решение (Detail читает его через
 * адаптер до S2.4); сами подтверждения/возвраты складываются сюда.
 * _snapshot_ включает Complex, подтверждённые factors/evidence, связанные
 * ads/media-манифесты, score/zone и AI-provenance использованных решений;
 * signed URL как постоянная ссылка не хранится (только mediaId/path/hash).
 */
export interface SignalVersion {
  ads?: Ad[];
  decisionAudit?: AuditEvent[];
  id: string; zkId: string; revision: number; status: Signal['status'];
  at: string; reviewer: string; comment: string;
  /** Версия workspace, из которой взят snapshot. */
  sourceVersion: number;
  /**
   * Снимок решения. Отсутствует только у legacyIncomplete (сигнал из эпохи
   * до снимков): прошлое нельзя реконструировать сегодняшними данными —
   * S2.4 пометит такие и потребует новой проверки перед экспортом.
   */
  snapshot?: Complex;
  legacyIncomplete?: boolean;
  basedOnRevision?: number | null;
  /**
   * S2.4 (C6). Идемпотентность повтора: commandId намерения пользователя.
   * Совпадает с id, когда версия создана по команде с явным commandId;
   * повтор решения с тем же commandId новую revision не создаёт.
   * (Полный конверт receipt/expected_version — S2.2.)
   */
  commandId?: string;
  /**
   * S2.4 (C6). Оценка принятого snapshot: score/zone по WEIGHTS
   * (scoring.ts) и версия весов — header и тело используют одну версию.
   */
  score?: number; zone?: Zone; weightsVersion?: number;
  /** S2.4 (C6). Только относящиеся материалы версии (без signed URL). */
  mediaManifest?: SignalMaterialManifest[];
  /** S2.4 (C6). AI-provenance только использованных решений версии. */
  aiProvenance?: SignalAiProvenance[];
}
/** S2 (C2). Версия схемы persisted workspace. 3 — первая версионированная. */
export const SCHEMA_VERSION = 3;
/** S2 (C2). Поддерживаемый максимум: выше — future version, запись запрещена. */
export const MAX_SUPPORTED_SCHEMA_VERSION = 3;
export interface AppState {
  /**
   * S2 (C2). Канон после loadState — 3. Поле опционально, потому что
   * отсутствует в legacy v2: такие workspace мигрируют при загрузке
   * (state-migrations.migrateV2ToV3), а не отбрасываются.
   */
  schemaVersion?: number;
  complexes: Complex[]; ads: Ad[]; media: Media[]; signals: Record<string, Signal>;
  /**
   * S2 (C6, задел S2.1). Пусто до S2.4: подтверждения/возвраты версий
   * появятся вместе с signal-snapshot. Отсутствие = «версий ещё не было».
   */
  signalVersions?: Record<string, SignalVersion[]>;
  audit: AuditEvent[];
}
export interface Registry { name: string; url: string; note: string }

/** C1/S1.1. Входные команды: evidence частичное, reviewer запрещён (автор — серверный). */
export type Command =
  | { type: 'factor'; zkId: string; code: Code; status: FactorStatus; evidence: EvidenceInput; comment: string }
  | { type: 'ad'; ad: Ad; hypothesis?: { code: Code; quote: string; evidenceText?: string; beforeCommissioning?: BeforeCommissioning; runId?: string; hypothesisId?: string }; decision: 'confirmed' | 'rejected' | 'saved'; comment: string; modelReason?: string }
  | { type: 'media'; media: Media }
  | { type: 'readiness'; zkId: string; value: number; source: string; date: string }
  | { type: 'signal'; zkId: string; status: Signal['status']; comment: string }
  | { type: 'complex'; complex: Complex };

/** Команда после runtime-парсинга: evidence полное (id/zkId/kind/date подставлены). */
export type ParsedCommand =
  | { type: 'factor'; zkId: string; code: Code; status: FactorStatus; evidence: Evidence; comment: string }
  | Exclude<Command, { type: 'factor' }>;
