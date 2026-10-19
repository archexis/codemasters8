/**
 * S1.1 (C1). Runtime-парсинг команд до domain: typed union из types.ts
 * проверяется здесь через zod. TypeScript — не граница доверия: те же
 * проверки повторяет SQL-миграция c1_command_schema.
 *
 * Слои отказа (порядок важен для регрессии S0):
 *  1. parseCommand — форма: известный type, отсутствие reviewer, типы,
 *     enum code/status/decision, форматы ID, календарные даты, конечные
 *     числа, согласованная пара legalBasis, reviewText, claimed-источник.
 *  2. domain.validateFactor / ветки applyCommand — смысл с состоянием:
 *     R1-статус, цитата в тексте, разрыв R5, дубли, URL, пустые поля,
 *     comment аналитика (проверяется ПОСЛЕДНИМ, чтобы старые тесты,
 *     ждущие R1/цитату/источник при пустом comment, не меняли смысл).
 */
import { z } from 'zod';
import type {
  Ad, AppState, Code, Complex, Evidence, EvidenceInput, FactorStatus, ParsedCommand,
} from './types';
import { isLegalBasisPair } from './types';
import { computeScore } from './scoring';
import { periodContains } from './applicability';

export const ID_RE = /^[A-Za-z0-9-]{1,80}$/;
export function relationEndpointExists(state:AppState, id:string):boolean {
  return state.complexes.some(z=>`complex:${z.id}`===id || (!!z.bin && `organization:${z.bin}`===id)) ||
    !!state.phases?.some(p=>`phase:${p.id}`===id) || !!state.artifacts?.some(a=>`document:${a.id}`===id) ||
    state.ads.some(ad=>`publication:${ad.id}`===id || (!!ad.account && `account:${ad.platform}:${ad.account}`===id));
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Строгая календарная дата YYYY-MM-DD: 2026-02-30 не проходит. */
export function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Дата материала: YYYY-MM-DD либо ISO-datetime (captureAt из Analyze
 * приходит полным ISO). Проверяется календарная часть.
 */
export function isDateLike(value: string): boolean {
  if (isCalendarDate(value)) return true;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return isCalendarDate(value.slice(0, 10));
  return false;
}

const today = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
/* S2.1-стык#2 (C4). Канонический ключ дедупа публикаций.             */
/*                                                                     */
/* dedupeKey = zkId + canonicalText: полный текст, нормализованные     */
/* телефоны (8XXXXXXXXXX → +7XXXXXXXXXX), схлопнутые пробелы, нижний   */
/* регистр. Сравнение — строго в пределах одного ЖК: одинаковый текст  */
/* в другом ЖК допустим и повтором не считается. SQL-миграция          */
/* s2_4_signals (ad_canonical_text/ad_dedupe_key) пересчитывает ключ   */
/* серверно и не доверяет присланному клиентом.                        */
/*                                                                     */
/* Эквивалентность parser.dedupeKey: тот возвращает phone|canonText —  */
/* при сравнении внутри одного zkId (как делает domain ad-ветка) даёт  */
/* то же равенство; каноническая форма здесь — для S3-контракта.       */
/* ------------------------------------------------------------------ */

/** KZ-телефон вида +7/8 + 10 цифр с возможными разделителями (зеркало parser RE_PHONE). */
const AD_PHONE_RE = /((?:\+7|8)[\s\-()]?\d{3}[\s\-()]?\d{3}[\s\-()]?\d{2}[\s\-()]?\d{2})/g;

function normKzPhone(m: string): string | null {
  let d = m.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d.length >= 10 ? '+' + d : null;
}

/** Канонический текст публикации для дедупа: телефоны → +7, пробелы/регистр. */
export function canonicalAdText(text: string): string {
  AD_PHONE_RE.lastIndex = 0;
  const canon = String(text ?? '').replace(AD_PHONE_RE, (m) => normKzPhone(m) ?? m);
  return canon.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Полный ключ дедупа C4: область (zkId) + канонический текст. */
export function adDedupeKey(zkId: string, text: string): string {
  return `${zkId}|${canonicalAdText(text)}`;
}

/**
 * S2.1 (C5-задел). Структурная проверка ссылки решения на будущий
 * analysis_runs: hypothesisId без runId неоднозначна (гипотеза принадлежит
 * run) и отвергается. Существование/ownership/успех run и совпадение input —
 * серверная проверка S4 (таблицы analysis_runs ещё нет, доверенного run
 * сейчас нет — клиентский `realAI:true` provenance не даёт).
 */
export function assertAnalysisLink(
  link: { runId?: string; hypothesisId?: string },
  path: string,
): void {
  if (link.hypothesisId !== undefined && link.runId === undefined) {
    throw new Error(
      `${path}.hypothesisId: ссылка на гипотезу требует runId ` +
        `(гипотеза принадлежит run; проверка существования run — S4, analysis_runs)`,
    );
  }
}

const CodeEnum = z.enum(['R1', 'R2', 'R3', 'R4', 'R5', 'R6']);
const StatusEnum = z.enum(['confirmed', 'hypothesis', 'rejected', 'needs-verification']);
const KindEnum = z.enum(['publication', 'legal-review', 'observation', 'document']);

const IdField = (label: string) =>
  z.string().refine((v) => ID_RE.test(v), `${label}: неоднозначный идентификатор (допустимы латиница, цифры, дефис, 1–80 символов)`);

const CommissioningSchema=z.strictObject({source:z.string().trim().min(1),date:z.string().refine(isCalendarDate,'Нужна реальная дата материала'),text:z.string().trim().min(1)});

const EvidenceInputSchema = z.strictObject({
  id: IdField('evidence.id').optional(),
  zkId: IdField('evidence.zkId').optional(),
  kind: KindEnum.optional(),
  source: z.string(),
  date: z.string().refine(isDateLike, 'evidence.date: неверная календарная дата (нужна реальная YYYY-MM-DD)').optional(),
  adId: IdField('evidence.adId').optional(),
  quote: z.string().optional(),
  text: z.string().optional(),
  beforeCommissioning: CommissioningSchema.optional(),
  mediaIds: z.array(z.string().min(1)).optional(),
  runId: IdField('evidence.runId').optional(),
  hypothesisId: IdField('evidence.hypothesisId').optional(),
});

const PeriodSchema = z.strictObject({from:z.string().refine(isCalendarDate,'Нужна календарная дата начала периода'),to:z.string().refine(isCalendarDate,'Нужна календарная дата конца периода').optional()}).refine(period=>!period.to || period.from<=period.to,'Конец периода не может быть раньше начала');
const LegalBasisSchema = z.strictObject({
  period:PeriodSchema.optional(),
  type: z.enum(['unknown', 'absent', 'guarantee', 'mio-permit']),
  status: z.enum(['unknown', 'absent-verified', 'verified']),
  source: z.string(),
  checkedAt: z.string().refine(value => value === '' || isDateLike(value), 'legalBasis.checkedAt: неверная календарная дата (нужна реальная YYYY-MM-DD)'),
  reviewText: z.string(),
}).refine(lb => lb.status === 'unknown' || isDateLike(lb.checkedAt), 'Для проверенного основания укажите календарную дату проверки');

const ClaimedSourceSchema = z.strictObject({
  value: z.number().refine(Number.isFinite, 'readinessClaimedSource.value: нужно конечное число'),
  source: z.string(),
  date: z.string().refine(isDateLike, 'readinessClaimedSource.date: неверная календарная дата'),
});

const ReadinessEntrySchema = z.strictObject({
  value: z.number().refine(Number.isFinite, 'readinessSources.value: нужно конечное число'),
  source: z.string(),
  date: z.string(),
});

const EvidenceFullSchema = z.strictObject({
  id: IdField('evidence.id'),
  zkId: IdField('evidence.zkId'),
  kind: KindEnum,
  source: z.string(),
  date: z.string(),
  adId: IdField('evidence.adId').optional(),
  quote: z.string().optional(),
  text: z.string().optional(),
  beforeCommissioning: CommissioningSchema.optional(),
  mediaIds: z.array(z.string()).optional(),
  runId: IdField('evidence.runId').optional(),
  hypothesisId: IdField('evidence.hypothesisId').optional(),
});

const StateFactorSchema = z.strictObject({
  code: CodeEnum,
  status: StatusEnum,
  evidence: EvidenceFullSchema.optional(),
  reviewer: z.string().optional(),
  updatedAt: z.string().optional(),
});

const ComplexSchema = z.strictObject({
  id: IdField('complex.id'),
  name: z.string(),
  city: z.string(),
  address: z.string(),
  developer: z.string(),
  bin: z.string().nullable(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  demo: z.boolean().optional(),
  origin: z.string(),
  scenario: z.string().optional(),
  stage: z.string(),
  readinessClaimed: z.number().nullable(),
  readinessConfirmed: z.number().nullable(),
  readinessSources: z.array(ReadinessEntrySchema),
  readinessClaimedSource: ClaimedSourceSchema.nullable(),
  legalBasis: LegalBasisSchema,
  note: z.string(),
  factors: z.array(StateFactorSchema),
  events: z.array(z.strictObject({ date: z.string(), text: z.string() })),
  sources: z.array(z.strictObject({ title: z.string(), date: z.string(), url: z.string().optional() })),
  version: z.number().optional(),
});

const AdSchema = z.strictObject({
  id: IdField('ad.id'),
  zkId: IdField('ad.zkId'),
  platform: z.string(),
  account: z.string(),
  // S2.1 (C4-задел): неизвестная дата публикации — null, не captureAt.
  date: z.string().nullable().refine((v) => v === null || isDateLike(v), 'ad.date: неверная календарная дата (неизвестная — null)'),
  url: z.string(),
  captureAt: z.string().refine(isDateLike, 'ad.captureAt: неверная календарная дата'),
  text: z.string(),
  decision: z.string().optional(),
  analysis: z.looseObject({ engine: z.string(), realAI: z.boolean(), hypotheses: z.array(z.looseObject({ id: z.string().optional(), code: CodeEnum, quote: z.string(), reason: z.string() })) }).optional(),
  // S2.1 (стык 4): повторные фиксации того же текста в том же ЖК.
  sightings: z.array(z.strictObject({
    source: z.string(),
    date: z.string().nullable().refine((v) => v === null || isDateLike(v), 'ad.sightings.date: неверная календарная дата (неизвестная — null)'),
    url: z.string().optional(),
    captureAt: z.string().refine(isDateLike, 'ad.sightings.captureAt: неверная календарная дата'),
  })).optional(),
});

const MediaSchema = z.strictObject({
  id: IdField('media.id'),
  zkId: IdField('media.zkId'),
  name: z.string(),
  kind: z.string(),
  date: z.string().refine(isDateLike, 'media.date: неверная календарная дата'),
  note: z.string(),
  ready: z.number().nullable(),
  path: z.string(),
});

const FactorCommandSchema = z.strictObject({
  type: z.literal('factor'),
  zkId: IdField('zkId'),
  code: CodeEnum,
  status: StatusEnum,
  evidence: EvidenceInputSchema,
  comment: z.string(),
});
const AdCommandSchema = z.strictObject({
  type: z.literal('ad'),
  ad: AdSchema,
  /**
   * S4.2 (C5). Hypothesis-gate: модель извлекает ТОЛЬКО R2/R3 (остальные
   * коды — ручные решения, factor-командой). Объект урезан до {code,quote}
   * + опциональная парная ссылка на серверный run (runId/hypothesisId):
   * reason модели сюда класть запрещено (strict: неизвестные поля — отказ),
   * он идёт отдельно в modelReason и никогда не подставляется как comment
   * аналитика. Цитата — непустая после trim; вхождение в ad.text проверяет
   * parseCommand (структура) и domain/SQL (по workspace) — дважды.
   */
  hypothesis: z.strictObject({
    code: z.enum(['R2', 'R3']),
    quote: z.string().refine((q) => q.trim().length > 0, 'нужна дословная непустая цитата из текста публикации (Цитата отсутствует без точной подстроки)'),
    evidenceText: z.string().max(20000).optional(),
    beforeCommissioning: CommissioningSchema.optional(),
    runId: IdField('hypothesis.runId').optional(),
    hypothesisId: IdField('hypothesis.hypothesisId').optional(),
  }).optional(),
  decision: z.enum(['confirmed', 'rejected', 'saved']),
  comment: z.string(),
  // Read-only след модели для аудита: reason гипотезы хранится отдельно и
  // никогда не подставляется как решение аналитика (см. comment выше).
  modelReason: z.string().max(2000).optional(),
});
const MediaCommandSchema = z.strictObject({ type: z.literal('media'), media: MediaSchema });
const ReadinessCommandSchema = z.strictObject({
  type: z.literal('readiness'),
  zkId: IdField('zkId'),
  value: z.number().refine(Number.isFinite, 'readiness.value: нужно конечное число 0–100'),
  source: z.string(),
  date: z.string().refine(isDateLike, 'readiness.date: неверная календарная дата'),
});
const SignalCommandSchema = z.strictObject({
  type: z.literal('signal'),
  zkId: IdField('zkId'),
  status: z.enum(['draft', 'confirmed', 'returned']),
  comment: z.string(),
});
const ComplexCommandSchema = z.strictObject({ type: z.literal('complex'), complex: ComplexSchema });

const scopeFields = { complexId: IdField('complexId'), phaseId: IdField('phaseId').optional() };
const RelationInputSchema=z.strictObject({
  id:IdField('relation.id'),...scopeFields,fromId:z.string().min(1).max(1000),toId:z.string().min(1).max(1000),
  relationType:z.enum(['developer_of','authorized_company_of','contractor_of','advertises','covered_by','mentions','same_ad_account','located_on']),
  sourceArtifactIds:z.array(IdField('sourceArtifactId')).max(100),matchMethod:z.enum(['manual','exact-id','name','address']),
});
const RelationStoredSchema=RelationInputSchema.extend({verificationStatus:z.enum(['candidate','verified','rejected']),capturedAt:z.string(),actor:z.string(),reviewedBy:z.string().optional(),reviewedAt:z.string().optional(),reviewComment:z.string().optional()});
const GeometrySchema = z.strictObject({
  id:IdField('geometry.id'),...scopeFields,source:z.string().trim().min(1).max(2000),verified:z.boolean(),heightMeters:z.number().min(0).max(1000).optional(),
  coordinates:z.array(z.array(z.tuple([z.number().min(-180).max(180),z.number().min(-85.051129).max(85.051129)])).min(4).max(10000).refine(r=>r.length>=4 && r[0][0]===r[r.length-1][0] && r[0][1]===r[r.length-1][1],'Контур должен быть замкнут')).min(1).max(100).refine(rings=>rings.reduce((sum,r)=>sum+r.length,0)<=10000,'Не более 10 000 вершин'),
});
const PhaseObservationSchema=z.strictObject({value:z.number().min(0).max(100),source:z.string().trim().min(1),date:z.string().refine(isCalendarDate,'Нужна календарная дата наблюдения')});
const PhaseSchema = z.strictObject({
  id: IdField('phase.id'), complexId: IdField('complexId'), name: z.string().trim().min(1), legalBasis: LegalBasisSchema.optional(),period:PeriodSchema.optional(),
  readinessClaimed:z.number().min(0).max(100).nullable().optional(),readinessClaimedSource:PhaseObservationSchema.nullable().optional(),
  readinessConfirmed:z.number().min(0).max(100).nullable().optional(),readinessSources:z.array(PhaseObservationSchema).optional(),
}).superRefine((phase,ctx)=>{
  if(phase.readinessClaimed!=null && phase.readinessClaimedSource?.value!==phase.readinessClaimed) ctx.addIssue({code:'custom',message:'Для заявленной готовности очереди нужны совпадающее значение, источник и дата'});
  if(phase.readinessConfirmed!=null && phase.readinessSources?.at(-1)?.value!==phase.readinessConfirmed) ctx.addIssue({code:'custom',message:'Подтверждённая готовность очереди должна совпадать с последним наблюдением'});
});
const ArtifactInputSchema = z.strictObject({
  id: IdField('artifact.id'), ...scopeFields,
  kind: z.enum(['publication', 'document', 'relationship', 'event', 'observation', 'legal-review']),
  source: z.string().trim().min(1), text: z.string().min(1),
  origin: z.enum(['manual','import','demo','official']).optional(),
  availability: z.enum(['ok','unavailable','needs_auth']).optional(),
  pageNumber:z.number().int().min(1).max(100000).optional(),
  date: z.string().refine(isDateLike).optional(), adId: IdField('adId').optional(), mediaId: IdField('mediaId').optional(),
  url: z.string().url().refine(v => /^https?:\/\//.test(v)).optional(),
});
const ArtifactStoredSchema = ArtifactInputSchema.extend({capturedAt:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/i).optional(),bytes:z.number().int().nonnegative().optional()});
const ClaimInputSchema = z.strictObject({
  period:PeriodSchema.optional(),
  id: IdField('claim.id'), ...scopeFields, artifactId: IdField('artifactId'),
  code: z.enum(['R1','R2','R3','R4','R5','R6']), quote: z.string().trim().min(1),
  reason: z.string().optional(), runId: IdField('runId').optional(), hypothesisId: IdField('hypothesisId').optional(),
});
const CaseSchema = z.strictObject({
  period:PeriodSchema.optional(),
  id: IdField('case.id'), ...scopeFields, title: z.string().optional(), owner: z.string(),
  status: z.enum(['draft','confirmed','returned']), artifactIds: z.array(IdField('artifactId')),
  createdAt: z.string(), updatedAt: z.string(),
});
const AssertionSchema = z.strictObject({
  period:PeriodSchema.optional(),
  id: IdField('assertion.id'), caseId: IdField('caseId'), claimId: IdField('claimId'), code: z.enum(['R1','R2','R3','R4','R5','R6']),
  status: z.enum(['candidate','verified','rejected']), evidence: EvidenceFullSchema, actor: z.string(), at: z.string(), comment: z.string(),
});
const decisionComment = z.string().trim().min(1);
const SCHEMAS: Record<string, z.ZodType> = {
  'relation.register':z.strictObject({type:z.literal('relation.register'),relation:RelationInputSchema}),
  'relation.review':z.strictObject({type:z.literal('relation.review'),relationId:IdField('relationId'),status:z.enum(['verified','rejected']),comment:z.string().trim().min(1)}),
  'geometry.register':z.strictObject({type:z.literal('geometry.register'),geometry:GeometrySchema}),
  'phase.create': z.strictObject({ type: z.literal('phase.create'), phase: PhaseSchema }),
  'phase.update': z.strictObject({ type: z.literal('phase.update'), phase: PhaseSchema }),
  'artifact.register': z.strictObject({ type: z.literal('artifact.register'), artifact: ArtifactInputSchema }),
  'claim.propose': z.strictObject({ type: z.literal('claim.propose'), claim: ClaimInputSchema }),
  'case.create': z.strictObject({ type: z.literal('case.create'), id: IdField('case.id'), ...scopeFields, title: z.string().optional(),period:PeriodSchema.optional() }),
  'case.attach': z.strictObject({ type: z.literal('case.attach'), caseId: IdField('caseId'), artifactId: IdField('artifactId') }),
  'ai.review': z.strictObject({ type: z.literal('ai.review'), claimId: IdField('claimId'), decision: z.enum(['accepted','rejected']), comment: decisionComment }),
  'fact.review': z.strictObject({ type: z.literal('fact.review'), caseId: IdField('caseId'), claimId: IdField('claimId'), status: z.enum(['verified','rejected']), evidence: EvidenceInputSchema, comment: decisionComment }),
  'case.decide': z.strictObject({ type: z.literal('case.decide'), caseId: IdField('caseId'), status: z.enum(['confirmed','returned']), comment: decisionComment }),
  'case.reopen': z.strictObject({ type: z.literal('case.reopen'), caseId: IdField('caseId'), comment: decisionComment }),
  factor: FactorCommandSchema,
  ad: AdCommandSchema,
  media: MediaCommandSchema,
  readiness: ReadinessCommandSchema,
  signal: SignalCommandSchema,
  complex: ComplexCommandSchema,
};

/** Автор решения — сервер. Присланный reviewer отбрасывается отказом, а не молча. */
function assertNoReviewer(value: unknown, path: string): void {
  if (typeof value !== 'object' || value === null) return;
  for (const [k, v] of Object.entries(value)) {
    if (k === 'reviewer') throw new Error(`${path}: поле reviewer назначает сервер, присылать его запрещено`);
    if (typeof v === 'object' && v !== null && (k === 'evidence' || k === 'ad' || k === 'media' || k === 'complex' || k === 'hypothesis')) {
      assertNoReviewer(v, `${path}.${k}`);
    }
  }
}

function describeIssue(issue: z.core.$ZodIssue, commandType: string): string {
  const at = issue.path.length ? `${commandType}.${issue.path.join('.')}` : commandType;
  if (issue.code === 'unrecognized_keys') {
    const keys = (issue as unknown as { keys: string[] }).keys.join(', ');
    return `${at}: неизвестные поля запрещены: ${keys}`;
  }
  if (issue.code === 'invalid_value') {
    const values = (issue as unknown as { values: unknown[] }).values;
    if (String(at).endsWith('hypothesis.code')) return `${at}: гипотезы модели допустимы только R2/R3 (C5: остальное — ручные решения)`;
    if (String(at).endsWith('.code')) return `${at}: неизвестный код фактора (допустимы R1–R6)`;
    if (String(at).endsWith('.status')) return `${at}: неизвестный статус (confirmed/hypothesis/rejected/needs-verification/draft/returned)`;
    if (String(at).endsWith('.type') || at === commandType) return `${at}: неизвестный тип команды`;
    if (String(at).endsWith('.kind')) return `${at}: неизвестный вид доказательства`;
    if (String(at).endsWith('.decision')) return `${at}: неизвестное решение (confirmed/rejected/saved)`;
    return `${at}: недопустимое значение, допустимы: ${values.join('/')}`;
  }
  if (issue.code === 'invalid_type') return `${at}: ${issue.message}`;
  return `${at}: ${issue.message}`;
}

/** Семантика входной complex-команды сверх типов: пары, reviewText, claimed-источник, диапазоны. */
function checkComplexInput(complex: z.infer<typeof ComplexSchema>): void {
  const lb = complex.legalBasis;
  if (!isLegalBasisPair(lb.type, lb.status)) {
    throw new Error(`complex.legalBasis: несогласованная пара type=${lb.type}/status=${lb.status} (допустимы unknown/unknown, absent/absent-verified, guarantee/verified, mio-permit/verified)`);
  }
  if (lb.status !== 'unknown' && !lb.source.trim()) throw new Error('Укажите источник проверки основания');
  if (lb.status !== 'unknown' && !lb.reviewText.trim()) {
    throw new Error('complex.legalBasis.reviewText: сохраните описание области сверки и её результата (одна строка «проверено» недостаточна)');
  }
  if (complex.readinessClaimed != null) {
    if (!Number.isFinite(complex.readinessClaimed) || complex.readinessClaimed < 0 || complex.readinessClaimed > 100) {
      throw new Error('Готовность должна быть от 0 до 100');
    }
    const claimed = complex.readinessClaimedSource;
    if (!claimed || claimed.value !== complex.readinessClaimed || !claimed.source.trim() || !claimed.date) {
      throw new Error('complex.readinessClaimedSource: для заявленной готовности нужны совпадающее значение, источник и дата');
    }
  }
  for (const coord of [[complex.lat, 90, 'широта'], [complex.lng, 180, 'долгота']] as const) {
    const [v, max, label] = coord;
    if (v != null && (!Number.isFinite(v) || Math.abs(v) > max)) throw new Error(`Некорректная ${label}`);
  }
}

/**
 * Полный runtime-парсинг сырой команды. Возвращает нормализованную команду:
 * evidence factor-команды дополняется до полного Evidence.
 */
export function parseCommand(raw: unknown): ParsedCommand {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Неизвестный тип команды: команда должна быть объектом');
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec.type !== 'string' || !(rec.type in SCHEMAS)) {
    throw new Error(`Неизвестный тип команды: ${String(rec.type)}`);
  }
  assertNoReviewer(raw, String(rec.type));
  const parsed = SCHEMAS[rec.type].safeParse(raw);
  if (!parsed.success) {
    throw new Error(describeIssue(parsed.error.issues[0], String(rec.type)));
  }
  const data = parsed.data as Record<string, never>;
  if (rec.type === 'phase.create' || rec.type === 'phase.update') {
    const phase = data.phase as z.infer<typeof PhaseSchema>;
    if (phase.legalBasis) {
      const lb = phase.legalBasis;
      if (!isLegalBasisPair(lb.type,lb.status)) throw new Error('phase.legalBasis: несогласованная пара type/status');
      if (lb.status !== 'unknown' && (!lb.source.trim() || !lb.reviewText.trim())) throw new Error('Укажите источник и содержание проверки основания очереди');
    }
  }
  if (rec.type === 'artifact.register' && (data.artifact as z.infer<typeof ArtifactInputSchema>).origin === 'official') throw new Error('Официальное происхождение назначает доверенный серверный импорт; ручная регистрация не подтверждает официальный источник');
  if (rec.type === 'complex') checkComplexInput(data.complex as z.infer<typeof ComplexSchema>);
  if (rec.type === 'factor') {
    const f = data as unknown as { zkId: string; code: Code; status: FactorStatus; evidence: EvidenceInput; comment: string };
    const ev = f.evidence;
    if (ev.zkId !== undefined && ev.zkId !== f.zkId) {
      throw new Error('factor.evidence.zkId: доказательство относится к другому объекту (неоднозначный ID)');
    }
    const evidence: Evidence = {
      id: ev.id ?? crypto.randomUUID(),
      zkId: ev.zkId ?? f.zkId,
      kind: ev.kind ?? (ev.adId ? 'publication' : 'document'),
      source: ev.source,
      date: ev.date ?? today(),
      ...(ev.adId !== undefined ? { adId: ev.adId } : {}),
      ...(ev.quote !== undefined ? { quote: ev.quote } : {}),
      ...(ev.text !== undefined ? { text: ev.text } : {}),
      ...(ev.beforeCommissioning !== undefined ? {beforeCommissioning:ev.beforeCommissioning} : {}),
      ...(ev.mediaIds !== undefined ? { mediaIds: ev.mediaIds } : {}),
      // S2.1 (C5-задел): ссылка на серверный run переживает нормализацию.
      ...(ev.runId !== undefined ? { runId: ev.runId } : {}),
      ...(ev.hypothesisId !== undefined ? { hypothesisId: ev.hypothesisId } : {}),
    };
    // S2.1 (C5-задел): гипотеза без run неоднозначна — отказ до S4-проверки.
    assertAnalysisLink(evidence, 'factor.evidence');
    return { type: 'factor', zkId: f.zkId, code: f.code, status: f.status, evidence, comment: f.comment };
  }
  if (rec.type === 'ad') {
    // S2.1 (C5-задел): то же правило для гипотезы ad-команды.
    const parsed_ad = parsed.data as {
      ad: { text: string }; decision: string; modelReason?: string;
      hypothesis?: { code: string; quote: string; runId?: string; hypothesisId?: string };
    };
    const h = parsed_ad.hypothesis;
    if (h) {
      assertAnalysisLink(h, 'ad.hypothesis');
      // S4.2 (C5). runId/hypothesisId — строго парой: сиротский hypothesisId
      // срезан выше, runId без hypothesisId тоже неоднозначен (гипотеза
      // принадлежит run; существование run проверяет серверный SQL).
      if (h.runId !== undefined && h.hypothesisId === undefined) {
        throw new Error('ad.hypothesis.runId: ссылка на run требует hypothesisId (сиротские ссылки запрещены, runId не выдумывается)');
      }
      // S4.2. Цитата-в-тексте на уровне парсинга (паритет с domain/SQL):
      // confirm с выдуманной цитатой отбрасывается до workspace. Для
      // saved/rejected фактора не создаётся — проверяет domain при confirm.
      if (parsed_ad.decision === 'confirmed' && (!h.quote.trim() || !parsed_ad.ad.text.includes(h.quote))) {
        throw new Error('ad.hypothesis.quote: Цитата отсутствует в исходном тексте публикации (нужна точная подстрока ad.text)');
      }
    }
  }
  return parsed.data as ParsedCommand;
}

/* ------------------------------------------------------------------ */
/* Legacy seed (до S1.4): честная нормализация к новым типам без `as`. */
/* ------------------------------------------------------------------ */

const SeedEvidenceSchema = z.looseObject({
  kind: KindEnum.optional(),
  source: z.string().optional(),
  quote: z.string().optional(),
  date: z.string().optional(),
  adId: z.string().optional(),
  text: z.string().optional(),
});
const SeedFactorSchema = z.looseObject({
  code: CodeEnum,
  status: StatusEnum,
  evidence: SeedEvidenceSchema.optional(),
  reviewer: z.string().optional(),
  updatedAt: z.string().optional(),
});
const SeedComplexSchema = z.looseObject({
  id: z.string(),
  name: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  developer: z.string().optional(),
  bin: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  demo: z.boolean().optional(),
  origin: z.string().optional(),
  scenario: z.string().optional(),
  stage: z.string().optional(),
  readinessClaimed: z.number().nullable().optional(),
  readinessConfirmed: z.number().nullable().optional(),
  readinessSources: z.array(ReadinessEntrySchema).optional(),
  readinessClaimedSource: ClaimedSourceSchema.nullable().optional(),
  legalBasis: z.looseObject({
    type: z.string().optional(), status: z.string().optional(), source: z.string().optional(),
    checkedAt: z.string().optional(), reviewText: z.string().optional(),
  }).optional(),
  note: z.string().optional(),
  factors: z.array(SeedFactorSchema).optional(),
  events: z.array(z.looseObject({ date: z.string().optional(), text: z.string().optional() })).optional(),
  sources: z.array(z.looseObject({ title: z.string().optional(), date: z.string().optional(), url: z.string().optional() })).optional(),
});
const SeedAdSchema = z.strictObject({
  id: z.string(), zkId: z.string(), platform: z.string(), account: z.string(),
  date: z.string(), url: z.string(), captureAt: z.string(), text: z.string(),
});

/**
 * Нормализация legacy-записи seed к Complex. Недостающее заполняется
 * ТОЛЬКО derivation/defaults, не выдуманными фактами; полноценные
 * материалы и виды доказательств назначает S1.4 (seed integrity).
 */
export function normalizeSeedComplex(raw: unknown, ads: Ad[]): Complex {
  const s = SeedComplexSchema.parse(raw);
  const zkId = s.id;
  const adDate = (adId: string | undefined): string | undefined =>
    adId ? ads.find((a) => a.id === adId)?.captureAt : undefined;
  const lb = s.legalBasis ?? {};
  const readinessClaimed = s.readinessClaimed ?? null;
  const claimedFromSources = (s.readinessSources ?? []).find((r) => r.value === readinessClaimed);
  return {
    id: zkId,
    name: s.name ?? '', city: s.city ?? 'Өскемен', address: s.address ?? '',
    developer: s.developer ?? '', bin: s.bin ?? null,
    lat: s.lat ?? null, lng: s.lng ?? null,
    ...(s.demo !== undefined ? { demo: s.demo } : {}),
    origin: s.origin ?? 'seed', ...(s.scenario !== undefined ? { scenario: s.scenario } : {}),
    stage: s.stage ?? '',
    readinessClaimed,
    readinessConfirmed: s.readinessConfirmed ?? null,
    readinessSources: s.readinessSources ?? [],
    readinessClaimedSource:
      s.readinessClaimedSource ??
      (readinessClaimed != null && claimedFromSources
        ? { value: claimedFromSources.value, source: claimedFromSources.source, date: claimedFromSources.date }
        : null),
    legalBasis: {
      type: (['unknown', 'absent', 'guarantee', 'mio-permit'] as const).includes(lb.type as never) ? (lb.type as Complex['legalBasis']['type']) : 'unknown',
      status: (['unknown', 'absent-verified', 'verified'] as const).includes(lb.status as never) ? (lb.status as Complex['legalBasis']['status']) : 'unknown',
      source: lb.source ?? '', checkedAt: lb.checkedAt ?? '', reviewText: lb.reviewText ?? '',
    },
    note: s.note ?? '',
    factors: (s.factors ?? []).map((f) => ({
      code: f.code, status: f.status,
      evidence: {
        // S1.1-заглушка вида для legacy: adId → publication, иначе document.
        // Реальные виды/материалы фиксирует S1.4, ничего не додумывая.
        id: `seed-${zkId}-${f.code}`, zkId,
        kind: f.evidence?.kind ?? (f.evidence?.adId ? 'publication' : 'document'),
        source: f.evidence?.source ?? '',
        date: f.evidence?.date ?? adDate(f.evidence?.adId) ?? lb.checkedAt ?? '',
        ...(f.evidence?.adId ? { adId: f.evidence.adId } : {}),
        ...(f.evidence?.quote ? { quote: f.evidence.quote } : {}),
        ...(f.evidence?.text ? { text: f.evidence.text } : {}),
      },
      ...(f.reviewer ? { reviewer: f.reviewer } : {}),
      ...(f.updatedAt ? { updatedAt: f.updatedAt } : {}),
    })),
    events: (s.events ?? []).map((e) => ({ date: e.date ?? '', text: e.text ?? '' })),
    sources: (s.sources ?? []).map((x) => ({ title: x.title ?? '', date: x.date ?? '', ...(x.url ? { url: x.url } : {}) })),
  };
}

export function normalizeSeedAds(raw: unknown): Ad[] {
  if (!Array.isArray(raw)) throw new Error('Seed ADS должен быть массивом');
  return raw.map((a) => SeedAdSchema.parse(a));
}

/** Начальное демо-состояние из seed через нормализацию (без `as`). */
export function seedState(seed: { COMPLEXES: unknown; ADS: unknown }): Pick<AppState, 'complexes' | 'ads'> {
  const ads = normalizeSeedAds(seed.ADS);
  if (!Array.isArray(seed.COMPLEXES)) throw new Error('Seed COMPLEXES должен быть массивом');
  return { complexes: seed.COMPLEXES.map((c) => normalizeSeedComplex(c, ads)), ads };
}

/* ------------------------------------------------------------------ */
/* S2.1 (C2). Строгая схема persisted workspace v3 и проверка ссылок.  */
/*                                                                     */
/* Командные схемы выше не тронуты: здесь проверяются уже сохранённые  */
/* состояния (loadState / restore / import), а не входные команды.     */
/* Правила:                                                            */
/*  - schemaVersion обязан быть 3 (legacy v2 мигрирует ДО этой схемы,  */
/*    future version отбрасывается ДО неё с отдельным понятным отказом);*/
/*  - вложенные сущности строгие (неизвестные ключи запрещены), но в    */
/*    state-Complex допускаются документированные registryId/geoApprox/ */
/*    authOrg публичных снимков, а factor.evidence.date — любая строка */
/*    (legacy-пустышки не переписываются задним числом);               */
/*  - Media без bytes/sha256 валидны: отсутствие означает «только       */
/*    metadata», а не «проверено» (см. типы);                          */
/*  - ссылки проверяются отдельно в checkStateRefs: dangling zkId      */
/*    сущности/сигнала — отказ; dangling adId/mediaIds в НЕподтверждён- */
/*    ном факторе допустимы как provenance, в confirmed — отказ (такие */
/*    confirmed миграция обязана была снять до валидации).             */
/* ------------------------------------------------------------------ */

const LoadedEvidenceSchema = z.strictObject({
  id: IdField('evidence.id'),
  zkId: IdField('evidence.zkId'),
  kind: KindEnum,
  source: z.string(),
  date: z.string(),
  adId: IdField('evidence.adId').optional(),
  quote: z.string().optional(),
  text: z.string().optional(),
  beforeCommissioning: CommissioningSchema.optional(),
  mediaIds: z.array(z.string()).optional(),
  runId: IdField('evidence.runId').optional(),
  hypothesisId: IdField('evidence.hypothesisId').optional(),
});

const LoadedFactorSchema = z.strictObject({
  code: CodeEnum,
  status: StatusEnum,
  evidence: LoadedEvidenceSchema.optional(),
  reviewer: z.string().optional(),
  updatedAt: z.string().optional(),
  /** S1.4/S2.1 provenance: исходное решение до снятия (status/evidence/reason). */
  before: z.unknown().optional(),
});

const LoadedComplexSchema = z.strictObject({
  id: IdField('complex.id'),
  name: z.string(),
  city: z.string(),
  address: z.string(),
  developer: z.string(),
  bin: z.string().nullable(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  demo: z.boolean().optional(),
  origin: z.string(),
  scenario: z.string().optional(),
  /** Документированные поля публичных снимков (SQ-R##): часть схемы, не мусор. */
  registryId: z.string().optional(),
  geoApprox: z.boolean().optional(),
  authOrg: z.string().optional(),
  stage: z.string(),
  readinessClaimed: z.number().nullable(),
  readinessConfirmed: z.number().nullable(),
  readinessSources: z.array(ReadinessEntrySchema),
  readinessClaimedSource: ClaimedSourceSchema.nullable(),
  legalBasis: LegalBasisSchema,
  note: z.string(),
  factors: z.array(LoadedFactorSchema),
  events: z.array(z.strictObject({ date: z.string(), text: z.string() })),
  sources: z.array(z.strictObject({ title: z.string(), date: z.string(), url: z.string().optional() })),
  version: z.number().optional(),
});

const LoadedMediaSchema = z.strictObject({
  id: IdField('media.id'),
  zkId: IdField('media.zkId'),
  name: z.string(),
  kind: z.string(),
  date: z.string().refine(isDateLike, 'media.date: неверная календарная дата'),
  note: z.string(),
  ready: z.number().nullable(),
  path: z.string(),
  /** S2 (C3): опциональны — старые записи без них валидны. */
  bytes: z.number().nullable().optional(),
  sha256: z.string().optional(),
  capturedAt: z.string().optional(),
});

const LoadedSignalSchema = z.strictObject({
  basedOnRevision: z.number().nullable().optional(),
  reason: z.string().optional(),
  status: z.enum(['draft', 'confirmed', 'returned']),
  snapshot: LoadedComplexSchema.optional(),
  at: z.string(),
  reviewer: z.string(),
  comment: z.string(),
});

const LoadedSignalVersionSchema = z.strictObject({
  ads: z.array(AdSchema).optional(),
  decisionAudit: z.array(z.unknown()).optional(),
  id: z.string(),
  zkId: IdField('signalVersion.zkId'),
  revision: z.number(),
  status: z.enum(['draft', 'confirmed', 'returned']),
  at: z.string(),
  reviewer: z.string(),
  comment: z.string(),
  sourceVersion: z.number(),
  snapshot: LoadedComplexSchema.optional(),
  legacyIncomplete: z.boolean().optional(),
  basedOnRevision: z.number().nullable().optional(),
  // S2.4 (C6): идемпотентный commandId, оценка принятого snapshot,
  // манифест относящихся материалов (без signed URL), AI-provenance.
  commandId: z.string().optional(),
  score: z.number().optional(),
  zone: z.enum(['green', 'yellow', 'red']).optional(),
  weightsVersion: z.number().optional(),
  mediaManifest: z.array(z.strictObject({
    name:z.string().optional(),mediaKind:z.string().optional(),capturedAt:z.string().optional(),note:z.string().optional(),
    kind: z.enum(['ad', 'media']),
    id: z.string(),
    path: z.string().optional(),
    sha256: z.string().nullable().optional(),
    bytes: z.number().nullable().optional(),
  })).optional(),
  aiProvenance: z.array(z.strictObject({
    provider:z.string().optional(),model:z.string().optional(),promptVersion:z.string().optional(),inputHash:z.string().optional(),origin:z.string().optional(),reason:z.string().optional(),
    code: CodeEnum,
    runId: z.string(),
    hypothesisId: z.string().optional(),
  })).optional(),
});

const LoadedAuditSchema = z.strictObject({
  id: z.string(),
  commandId: z.string().optional(),
  zkId: z.string(),
  actorId: z.string().optional(),
  at: z.string(),
  reviewer: z.string(),
  action: z.string(),
  comment: z.string(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  evidence: z.unknown().optional(),
  details: z.unknown().optional(),
});

export const StateSchema = z.strictObject({
  relations:z.array(RelationStoredSchema).optional(),
  geometries:z.array(GeometrySchema).optional(),
  phases: z.array(PhaseSchema).optional(),
  artifacts: z.array(ArtifactStoredSchema).optional(),
  claims: z.array(ClaimInputSchema.extend({ quoteStart:z.number().int().nonnegative().optional(),quoteEnd:z.number().int().positive().optional(),triage: z.enum(['accepted','rejected']).optional(), triagedBy: z.string().optional(), triagedAt: z.string().optional(), triageComment: z.string().optional() })).optional(),
  assertions: z.array(AssertionSchema).optional(),
  cases: z.array(CaseSchema).optional(),
  caseSnapshots: z.array(z.strictObject({
    relations:z.array(RelationStoredSchema).optional(),
    period:PeriodSchema.optional(),
    imported:z.boolean().optional(),
    id: IdField('snapshot.id'), caseId: IdField('caseId'), ...scopeFields, revision: z.number().int().positive(),
    status: z.enum(['confirmed','returned']), actor: z.string(), at: z.string(), comment: z.string(),
    complex: LoadedComplexSchema, phase: PhaseSchema.optional(), assertions: z.array(AssertionSchema),
    artifacts: z.array(ArtifactStoredSchema),
    ads: z.array(AdSchema).optional(),
    mediaManifest: z.array(z.strictObject({
      kind:z.enum(['ad','media']),id:z.string(),name:z.string().optional(),mediaKind:z.string().optional(),capturedAt:z.string().optional(),note:z.string().optional(),
      path:z.string().optional(),sha256:z.string().nullable().optional(),bytes:z.number().nullable().optional(),
    })).optional(),
    score: z.number().min(0).max(100), zone: z.enum(['green','yellow','red']), weightsVersion: z.number(), limitations: z.array(z.string()), demo: z.boolean(),
  })).optional(),
  schemaVersion: z.literal(3),
  complexes: z.array(LoadedComplexSchema),
  ads: z.array(AdSchema),
  media: z.array(LoadedMediaSchema),
  signals: z.record(z.string(), LoadedSignalSchema),
  signalVersions: z.record(z.string(), z.array(LoadedSignalVersionSchema)),
  audit: z.array(LoadedAuditSchema),
});

function describeStateIssue(issue: z.core.$ZodIssue): string {
  const at = issue.path.length ? `state.${issue.path.join('.')}` : 'state';
  if (issue.code === 'unrecognized_keys') {
    const keys = (issue as unknown as { keys: string[] }).keys.join(', ');
    return `${at}: неизвестные поля запрещены: ${keys}`;
  }
  if (issue.code === 'invalid_value') {
    if (String(at).endsWith('.status')) return `${at}: неизвестный статус (confirmed/hypothesis/rejected/needs-verification/draft/returned)`;
    if (String(at).endsWith('.code')) return `${at}: неизвестный код фактора (допустимы R1–R6)`;
    if (String(at).endsWith('.kind')) return `${at}: неизвестный вид доказательства`;
    if (at === 'state.schemaVersion') return `${at}: ожидалась версия схемы 3`;
    return `${at}: недопустимое значение`;
  }
  if (issue.code === 'invalid_type') return `${at}: ${issue.message}`;
  return `${at}: ${issue.message}`;
}

/**
 * Строгая проверка ссылок уже спарсенного v3-состояния. Семантическую
 * достаточность (хватает ли материала на confirmed) решает миграция
 * снятием с provenance; здесь — структурная целостность:
 * orphan-сущности/сигналы (dangling zkId) — отказ всегда; dangling
 * adId/mediaIds и отсутствующая цитата — отказ только для confirmed
 * (миграция обязана была такие снять; ручная правка v3 — тоже отказ).
 */
export function checkStateRefs(state: AppState): void {
  checkInvestigationRefs(state);
  const complexIds = new Set(state.complexes.map((c) => c.id));
  const adsById = new Map(state.ads.map((a) => [a.id, a]));
  const mediaIds = new Set(state.media.map((m) => m.id));
  for (const ad of state.ads) {
    if (!complexIds.has(ad.zkId)) {
      throw new Error(`state.ads.${ad.id}: неизвестный zkId ${ad.zkId} — публикация не привязана ни к одному объекту`);
    }
  }
  for (const m of state.media) {
    if (!complexIds.has(m.zkId)) {
      throw new Error(`state.media.${m.id}: неизвестный zkId ${m.zkId} — файл не привязан ни к одному объекту`);
    }
  }
  for (const z of state.complexes) {
    for (const f of z.factors) {
      const ev = f.evidence;
      if (!ev) continue;
      if (ev.zkId !== z.id) {
        throw new Error(`state.complexes.${z.id}.factors.${f.code}: доказательство относится к другому объекту (${ev.zkId})`);
      }
      // S2.1 (C5-задел): структурная проверка ссылки на будущий analysis_runs
      // (существование run — серверная проверка S4, здесь только парность).
      assertAnalysisLink(ev, `state.complexes.${z.id}.factors.${f.code}.evidence`);
      if (f.status !== 'confirmed') continue;
      if (ev.adId !== undefined) {
        const ad = adsById.get(ev.adId);
        if (!ad) throw new Error(`state.complexes.${z.id}.factors.${f.code}: evidence.adId ${ev.adId} — публикация не найдена`);
        if (ad.zkId !== z.id) throw new Error(`state.complexes.${z.id}.factors.${f.code}: публикация ${ev.adId} относится к другому ЖК`);
        if (ev.quote !== undefined && !ad.text.includes(ev.quote)) {
          throw new Error(`state.complexes.${z.id}.factors.${f.code}: цитата отсутствует в исходном тексте публикации ${ev.adId}`);
        }
      }
      for (const mid of ev.mediaIds ?? []) {
        if (!mediaIds.has(mid)) throw new Error(`state.complexes.${z.id}.factors.${f.code}: evidence.mediaIds ${mid} — файл не найден`);
      }
    }
  }
  for (const [zkId, signal] of Object.entries(state.signals)) {
    if (!complexIds.has(zkId)) throw new Error(`state.signals.${zkId}: неизвестный zkId — сигнал без объекта`);
    if (signal.snapshot && signal.snapshot.id !== zkId) {
      throw new Error(`state.signals.${zkId}: snapshot относится к другому объекту (${signal.snapshot.id})`);
    }
  }
  for (const [zkId, versions] of Object.entries(state.signalVersions ?? {})) {
    if (!complexIds.has(zkId)) throw new Error(`state.signalVersions.${zkId}: неизвестный zkId — версии без объекта`);
    for (let i = 0; i < versions.length; i++) {
      const v = versions[i];
      const at = `state.signalVersions.${zkId}[${i}]`;
      if (v.zkId !== zkId) throw new Error(`${at}: версия ${v.id} относится к другому объекту (${v.zkId})`);
      // S2.4 (C6). Append-only инвариант в пути загрузки: revision строго
      // 1-based contiguous в порядке массива (переписывание/удаление истории —
      // отказ; непрерывность поверх триггера БД проверяется здесь же).
      if (!Number.isInteger(v.revision) || v.revision !== i + 1) {
        throw new Error(`${at}: revision обязана быть ${i + 1} (append-only, без пропусков и перестановок)`);
      }
      if (v.basedOnRevision !== undefined && v.basedOnRevision !== null) {
        if (!Number.isInteger(v.basedOnRevision) || v.basedOnRevision < 1 || v.basedOnRevision >= v.revision) {
          throw new Error(`${at}: basedOnRevision обязана указывать на более раннюю revision`);
        }
      }
      // Legacy-метка — только без snapshot (прошлое не реконструируется);
      // обычная версия — только со snapshot своего ЖК.
      if (v.legacyIncomplete === true) {
        if (v.snapshot !== undefined) {
          throw new Error(`${at}: legacyIncomplete-версия не может нести snapshot (прошлое не восстанавливается)`);
        }
      } else {
        if (!v.snapshot) throw new Error(`${at}: версия решения обязана нести snapshot (отсутствует только у legacyIncomplete)`);
        if (v.snapshot.id !== zkId) {
          throw new Error(`${at}: snapshot относится к другому объекту (${v.snapshot.id})`);
        }
      }
    }
  }
  for (const e of state.audit) {
    if (!complexIds.has(e.zkId)) throw new Error(`state.audit.${e.id}: неизвестный zkId ${e.zkId}`);
  }
}

/** Scope checks apply on every load/restore as well as during command execution. */
export function checkInvestigationRefs(state: AppState): void {
  const groups = [state.relations,state.geometries, state.phases, state.artifacts, state.claims, state.assertions, state.cases, state.caseSnapshots];
  for (const group of groups) if (group && new Set(group.map(x => x.id)).size !== group.length) throw new Error('state: повтор идентификатора расследования');
  const scope = (item: {complexId:string; phaseId?:string}) => {
    if (!state.complexes.some(z => z.id === item.complexId)) throw new Error('state: неизвестный объект расследования');
    if (item.phaseId && !state.phases?.some(p => p.id === item.phaseId && p.complexId === item.complexId)) throw new Error('state: неверная очередь расследования');
  };
  for (const phase of state.phases ?? []) scope(phase);
  for (const geometry of state.geometries ?? []) scope(geometry);
  for(const relation of state.relations ?? []) {
    scope(relation);
    if(relation.fromId===relation.toId || !relationEndpointExists(state,relation.fromId) || !relationEndpointExists(state,relation.toId)) throw new Error('state: неизвестная сторона связи');
    for(const id of relation.sourceArtifactIds) if(!state.artifacts?.some(a=>a.id===id && a.complexId===relation.complexId && a.phaseId===relation.phaseId)) throw new Error('state: источник связи вне области применимости');
    if(relation.verificationStatus==='verified' && (!relation.sourceArtifactIds.length || !relation.reviewedBy || !relation.reviewedAt || !relation.reviewComment?.trim())) throw new Error('state: связь не имеет документального подтверждения');
  }
  for (const artifact of state.artifacts ?? []) {
    scope(artifact);
    if (artifact.adId && !state.ads.some(ad => ad.id === artifact.adId && ad.zkId === artifact.complexId && ad.text === artifact.text)) throw new Error('state: артефакт не совпадает с публикацией');
    if (artifact.mediaId && !state.media.some(m => m.id === artifact.mediaId && m.zkId === artifact.complexId)) throw new Error('state: отсутствует файл артефакта');
  }
  for (const claim of state.claims ?? []) {
    scope(claim);
    const artifact=state.artifacts?.find(a => a.id === claim.artifactId);
    if (!artifact || artifact.complexId !== claim.complexId || artifact.phaseId !== claim.phaseId || !artifact.text.includes(claim.quote)) throw new Error('state: некорректный источник или цитата утверждения');
    if((claim.quoteStart!==undefined || claim.quoteEnd!==undefined) && (claim.quoteStart!==artifact.text.indexOf(claim.quote) || claim.quoteEnd!==artifact.text.indexOf(claim.quote)+claim.quote.length)) throw new Error('state: положение цитаты не соответствует оригиналу');
    const phase=state.phases?.find(p=>p.id===claim.phaseId);
    if(phase?.period && claim.period && !periodContains(phase.period,claim.period)) throw new Error('state: период утверждения вне очереди');
  }
  for (const item of state.cases ?? []) {
    scope(item);
    for (const id of item.artifactIds) if(!state.artifacts?.some(a => a.id === id && a.complexId === item.complexId && a.phaseId === item.phaseId)) throw new Error('state: материал не входит в область дела');
    const phase=state.phases?.find(p=>p.id===item.phaseId);
    if(phase?.period && item.period && !periodContains(phase.period,item.period)) throw new Error('state: период дела вне очереди');
  }
  for (const assertion of state.assertions ?? []) {
    const item=state.cases?.find(c => c.id === assertion.caseId);
    const claim=state.claims?.find(c => c.id === assertion.claimId);
    if (!item || !claim || claim.code !== assertion.code || claim.complexId !== item.complexId || claim.phaseId !== item.phaseId || !item.artifactIds.includes(claim.artifactId) || assertion.evidence.zkId !== item.complexId) throw new Error('state: проверка факта вне дела');
    const artifact=state.artifacts?.find(a=>a.id===claim.artifactId);
    if(assertion.evidence.quote !== claim.quote || assertion.evidence.adId !== artifact?.adId) throw new Error('state: доказательство не совпадает с исходным утверждением');
    if(JSON.stringify(assertion.period)!==JSON.stringify(item.period ?? claim.period)) throw new Error('state: период факта не соответствует делу и утверждению');
    for(const id of assertion.evidence.mediaIds ?? []) if(!state.media.some(m=>m.id===id && m.zkId===item.complexId)) throw new Error('state: файл доказательства не найден');
  }
  const revisions=new Map<string,number>();
  for (const snapshot of state.caseSnapshots ?? []) {
    const item=state.cases?.find(c => c.id === snapshot.caseId);
    if(!item || snapshot.complexId !== item.complexId || snapshot.phaseId !== item.phaseId || snapshot.complex.id !== item.complexId) throw new Error('state: снимок относится к другому делу');
    const expected=(revisions.get(item.id) ?? 0)+1;
    if(snapshot.revision !== expected) throw new Error('state: версии снимков должны идти последовательно');
    revisions.set(item.id,expected);
    const computed=computeScore(snapshot.complex.factors);
    if(snapshot.score!==computed.score || snapshot.zone!==computed.zone) throw new Error('state: скоринг снимка не соответствует подтверждённым факторам');
    for(const artifact of snapshot.artifacts) if(artifact.complexId !== item.complexId || artifact.phaseId !== item.phaseId) throw new Error('state: материал снимка относится к другому делу');
    for(const ad of snapshot.ads ?? []) if(ad.zkId!==item.complexId) throw new Error('state: публикация снимка относится к другому объекту');
    for(const assertion of snapshot.assertions) if(assertion.caseId!==item.id || assertion.evidence.zkId!==item.complexId) throw new Error('state: факт снимка относится к другому делу');
  }
}

/** Полная проверка v3-состояния: строгая схема + ссылки. Возвращает то же состояние типизированным. */
export function validateLoadedState(raw: unknown): AppState {
  const parsed = StateSchema.safeParse(raw);
  if (!parsed.success) throw new Error(describeStateIssue(parsed.error.issues[0]));
  const state = parsed.data as AppState;
  checkStateRefs(state);
  return state;
}
