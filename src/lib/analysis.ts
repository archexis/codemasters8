import { supabase } from './supabase';
import { parseAdText } from './parser';
import type { Analysis, Code } from './types';
import { z } from 'zod';
import { ID_RE } from './validation';
const schema = z.object({ engine: z.string(), realAI: z.boolean(), runId:z.string().optional(), inputHash:z.string().optional(), input:z.unknown().optional(), status:z.literal('succeeded').optional(), hypotheses: z.array(z.object({ id:z.string().optional(), code: z.enum(['R2', 'R3']), quote: z.string().refine(q=>!!q.trim()), reason: z.string().min(1) })).max(6) });
export async function analyze(input: AiRunInput, opts: {runId:string; signal:AbortSignal}): Promise<Analysis> {
  if (input.text.length > 20000) throw new Error('Максимум 20 000 символов');
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (opts.signal.aborted) throw new DOMException('Aborted','AbortError');
  if (!supabase || !session) {
    const run=demoRunFor(input);
    return {engine:run.engine,realAI:false,hypotheses:run.hypotheses};
  }
  const { data, error } = await supabase.functions.invoke('analyze', { body: { runId:opts.runId, input }, signal: AbortSignal.any([opts.signal,AbortSignal.timeout(45000)]) });
  if (error) {
    const detail = error.context instanceof Response ? await error.context.json().catch(()=>null) : null;
    throw new Error(`AI-анализ недоступен: ${detail?.error_code ?? error.message}. Для pending/failed после таймаута начните новый запуск.`);
  }
  const result = schema.parse(data);
  if (!result.runId || result.status!=='succeeded' || result.hypotheses.some(h => !h.id || !input.text.includes(h.quote))) throw new Error('Некорректный доверенный результат модели');
  return result;
}

/* ------------------------------------------------------------------ */
/* S4.1 (C5). Доверенный жизненный цикл analysis run (клиентская      */
/* модель; серверная проверка — Edge + таблица analysis_runs).        */
/*                                                                     */
/* Контракт C5:                                                        */
/*  - run проходит started → succeeded | failed; успеха из pending/    */
/*    failed нет («не выдавать успех» при crash после ответа LLM);     */
/*  - inputHash считается по точному сериализованному snapshot с       */
/*    фиксированным порядком полей; сам snapshot хранится;             */
/*  - гипотеза AI — только R2/R3, максимум 6, у каждой устойчивый ID,  */
/*    цитата — точная непустая подстрока входного текста;              */
/*  - решение ссылается runId/hypothesisId; hypothesisId без runId     */
/*    (сирота) отвергается; реальный provenance — из серверного run,   */
/*    клиентский `realAI:true` provenance не даёт;                     */
/*  - повтор прежнего runId с тем же input не делает второго           */
/*    provider-вызова (replay); тот же ID с другим input — 409;        */
/*  - DEMO хранит результат локально с явным origin='local-parser';    */
/*    импортированный provenance — origin='imported'.                  */
/*                                                                     */
/* Задел для validateLoadedState (S4): структурная парность ссылки     */
/* (сирота отвергается) уже проверяется validation.assertAnalysisLink; */
/* существование/ownership/успех run и совпадение input — серверная    */
/* проверка по analysis_runs; assertRunLinkPair ниже — та же парность  */
/* для decision-команд, чтобы проводка S4 не выдумывала runId.         */
/* ------------------------------------------------------------------ */

/** Явная константная версия prompt/schema AI-потока (C5: фиксированы). */
export const AI_PROMPT_VERSION = 's4-r2r3-v3';
export const AI_SCHEMA_VERSION = 1;
/** AI извлекает только R2/R3 (C5: R1/R4/R5/R6 требуют других материалов). */
export const AI_RUN_CODES: ReadonlyArray<Code> = ['R2', 'R3'];
export const AI_MAX_HYPOTHESES = 6;
export const AI_TEXT_LIMIT = 20000;

export type AiRunOrigin = 'server' | 'local-parser' | 'imported';
export type AiRunStatus = 'started' | 'succeeded' | 'failed';

/** Входной snapshot run: те же поля, что фиксирует S4.3 (текст + мета). */
export interface AiRunInput {
  text: string; zkId: string; url: string; account: string;
  date: string | null; platform: string;
  attachments?: {name:string;size:number;type:string;lastModified:number}[];
}

export interface AiRunHypothesis {
  id: string; code: Code; quote: string; reason: string;
}

export interface AnalysisRun {
  id: string;
  input: AiRunInput;
  /** Хеш точного сериализованного snapshot (фиксированный порядок полей). */
  inputHash: string;
  status: AiRunStatus;
  hypotheses: AiRunHypothesis[];
  origin: AiRunOrigin;
  engine: string;
  promptVersion: string;
  errorCode: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** Ссылка decision-команды на доверенный run (ad.hypothesis / evidence). */
export interface RunLink {
  runId?: string; hypothesisId?: string; code: Code; quote: string;
}

/** Provenance принятого решения: только из проверенного серверного run. */
export interface DecisionProvenance {
  runId: string; hypothesisId?: string; code: Code; quote: string;
  engine: string; origin: AiRunOrigin;
}

/** Минимальное хранилище run для дедупа повторных runId (память/DEMO). */
export interface AnalysisRunStore {
  get(runId: string): AnalysisRun | undefined;
  set(run: AnalysisRun): void;
}

const uuid = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 2 ** 31).toString(36)}`;

/** cyrb53: детерминированный хеш без зависимостей (браузер и тесты). */
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Точная сериализация snapshot с фиксированным порядком полей.
 * Порядок ключей задан построением, а не порядком вхождения объекта.
 */
export function canonicalRunInput(input: AiRunInput): string {
  const q = (v: unknown): string => JSON.stringify(v ?? null);
  return JSON.stringify({text:input.text,zkId:input.zkId,url:input.url,account:input.account,date:input.date,platform:input.platform,...(input.attachments ? {attachments:input.attachments.map(a=>({name:a.name,size:a.size,type:a.type,lastModified:a.lastModified}))} : {})});
}

/** Хеш входного snapshot (hex). Тот же input → тот же хеш всегда. */
export function inputHashFor(input: AiRunInput): string {
  return cyrb53(canonicalRunInput(input)).toString(16).padStart(12, '0');
}

export function newRunId(): string {
  return uuid();
}

function assertRunId(id: string): void {
  if (!ID_RE.test(id)) throw new Error(`runId: неоднозначный идентификатор (допустимы латиница, цифры, дефис, 1–80 символов)`);
}

/** Новый run в статусе started: исполнитель вызова фиксируется до LLM. */
export function startAnalysisRun(
  input: AiRunInput,
  opts?: { runId?: string; origin?: AiRunOrigin; engine?: string },
): AnalysisRun {
  const text = String(input?.text ?? '');
  if (text.length > AI_TEXT_LIMIT) throw new Error(`Анализ: максимум 20 000 символов`);
  const zkId = String(input?.zkId ?? '');
  if (!ID_RE.test(zkId)) throw new Error('Анализ: zkId обязан быть идентификатором объекта');
  const id = opts?.runId ?? newRunId();
  assertRunId(id);
  const snapshot: AiRunInput = {
    text,
    zkId,
    url: String(input?.url ?? ''),
    account: String(input?.account ?? ''),
    date: input?.date ?? null,
    platform: String(input?.platform ?? ''),
  };
  return {
    id,
    input: snapshot,
    inputHash: inputHashFor(snapshot),
    status: 'started',
    hypotheses: [],
    origin: opts?.origin ?? 'server',
    engine: opts?.engine ?? AI_PROMPT_VERSION,
    promptVersion: AI_PROMPT_VERSION,
    errorCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
}

function assertProviderHypothesis(
  run: AnalysisRun,
  h: { id?: string; code: string; quote: string; reason: string },
  index: number,
  seenIds: Set<string>,
): AiRunHypothesis {
  const at = `hypotheses[${index}]`;
  if (!(AI_RUN_CODES as readonly string[]).includes(h.code)) {
    throw new Error(`${at}: AI извлекает только R2/R3, получено ${JSON.stringify(h.code)}`);
  }
  const quote = String(h.quote ?? '');
  if (!quote.trim()) throw new Error(`${at}: пустая цитата запрещена (нужна точная непустая подстрока текста)`);
  if (!run.input.text.includes(quote)) throw new Error(`${at}: цитата отсутствует в исходном тексте`);
  if (!String(h.reason ?? '').trim()) throw new Error(`${at}: reason модели обязателен`);
  const id = h.id ?? `${run.id}-h${index + 1}`;
  if (!ID_RE.test(id)) throw new Error(`${at}: неоднозначный hypothesisId`);
  if (seenIds.has(id)) throw new Error(`${at}: повтор hypothesisId ${id} внутри run`);
  seenIds.add(id);
  return { id, code: h.code as Code, quote, reason: String(h.reason) };
}

/**
 * started → succeeded. Проверяет код (только R2/R3), лимит 6, точные
 * непустые цитаты из входного текста и устойчивость ID. Из терминального
 * статуса успеха нет.
 */
export function succeedAnalysisRun(
  run: AnalysisRun,
  hypotheses: Array<{ id?: string; code: string; quote: string; reason: string }>,
): AnalysisRun {
  if (run.status !== 'started') throw new Error(`Run ${run.id}: успех выдаётся только из started (текущий ${run.status})`);
  if (!Array.isArray(hypotheses)) throw new Error('Run: hypotheses обязаны быть списком');
  if (hypotheses.length > AI_MAX_HYPOTHESES) {
    throw new Error(`Run: максимум ${AI_MAX_HYPOTHESES} гипотез, получено ${hypotheses.length}`);
  }
  const seen = new Set<string>();
  const checked = hypotheses.map((h, i) => assertProviderHypothesis(run, h, i, seen));
  return { ...run, status: 'succeeded', hypotheses: checked, finishedAt: new Date().toISOString() };
}

/** started → failed: сохраняется статус/причина, успеха не выдаётся. */
export function failAnalysisRun(run: AnalysisRun, errorCode: string): AnalysisRun {
  if (run.status !== 'started') throw new Error(`Run ${run.id}: failed фиксируется только из started (текущий ${run.status})`);
  const code = String(errorCode ?? '').trim();
  if (!code) throw new Error('Run: errorCode обязателен для failed');
  return { ...run, status: 'failed', errorCode: code, finishedAt: new Date().toISOString() };
}

/**
 * Парность ссылки (задел validateLoadedState): hypothesisId без runId —
 * сиротская ссылка, отвергается; runId не выдумывается.
 */
export function assertRunLinkPair(link: { runId?: string; hypothesisId?: string }, path: string): void {
  if (link.hypothesisId !== undefined && link.runId === undefined) {
    throw new Error(`${path}.hypothesisId: ссылка на гипотезу требует runId (сиротские ссылки отвергаются)`);
  }
}

/**
 * Проверка decision-ссылки по доверенному run: ownership/успех — серверная
 * сторона (analysis_runs); здесь — успех run, совпадение inputHash с
 * текущим snapshot, принадлежность hypothesisId run и заземление цитаты
 * в текущем тексте. Возвращает provenance либо null (ручное решение без
 * runId — AI-provenance нет). Клиентский `realAI:true` provenance не даёт.
 */
export function resolveDecisionProvenance(
  link: RunLink,
  run: AnalysisRun | null | undefined,
  currentInput: AiRunInput,
): DecisionProvenance | null {
  assertRunLinkPair(link, 'decision.hypothesis');
  if (link.runId === undefined) return null;
  if (!run || run.id !== link.runId) throw new Error(`Run ${link.runId}: доверенный run не найден (чужой ID не раскрывается)`);
  if (run.status !== 'succeeded') {
    throw new Error(`Run ${run.id}: решение по run в статусе ${run.status} запрещено (успех не выдаётся)`);
  }
  if (run.inputHash !== inputHashFor(currentInput)) {
    throw new Error(`Run ${run.id}: входной snapshot изменился (inputHash не совпал) — нужен новый запуск`);
  }
  let hypothesis: AiRunHypothesis | undefined;
  if (link.hypothesisId !== undefined) {
    hypothesis = run.hypotheses.find((h) => h.id === link.hypothesisId);
    if (!hypothesis) throw new Error(`Run ${run.id}: hypothesisId ${link.hypothesisId} в run отсутствует`);
    if (hypothesis.code !== link.code || hypothesis.quote !== link.quote) {
      throw new Error(`Run ${run.id}: ссылка не совпадает с гипотезой ${link.hypothesisId} (code/quote)`);
    }
  } else {
    hypothesis = run.hypotheses.find((h) => h.code === link.code && h.quote === link.quote);
    if (!hypothesis) throw new Error(`Run ${run.id}: гипотеза ${link.code} с такой цитатой в run отсутствует`);
  }
  if (!currentInput.text.includes(hypothesis.quote)) {
    throw new Error(`Run ${run.id}: цитата гипотезы отсутствует в текущем тексте`);
  }
  return {
    runId: run.id,
    ...(hypothesis.id ? { hypothesisId: hypothesis.id } : {}),
    code: hypothesis.code,
    quote: hypothesis.quote,
    engine: run.engine,
    origin: run.origin,
  };
}

export interface RunOnceResult {
  run: AnalysisRun;
  /** true — возвращён сохранённый результат/статус без нового provider-вызова. */
  replayed: boolean;
}

/**
 * Единый исполнитель runId (клиентская модель C5): повтор того же runId с
 * тем же input возвращает сохранённый результат без второго provider-вызова
 * и без траты квоты; тот же ID с другим input — 409; ошибка провайдера
 * фиксирует failed и пробрасывается (успех не выдаётся).
 */
export async function runAnalysisOnce(
  store: AnalysisRunStore,
  input: AiRunInput,
  provider: (input: AiRunInput) => AiRunHypothesis[] | Promise<AiRunHypothesis[]>,
  opts?: { runId?: string; origin?: AiRunOrigin; engine?: string },
): Promise<RunOnceResult> {
  const runId = opts?.runId ?? newRunId();
  const hash = inputHashFor({ ...input, date: input.date ?? null });
  const existing = store.get(runId);
  if (existing) {
    if (existing.inputHash !== hash) {
      throw new Error(`RUN_INPUT_CONFLICT (409): runId ${runId} уже занят другим входным snapshot`);
    }
    return { run: existing, replayed: true };
  }
  const started = startAnalysisRun(input, { runId, origin: opts?.origin, engine: opts?.engine });
  store.set(started);
  try {
    const hypotheses = await provider(started.input);
    const done = succeedAnalysisRun(started, hypotheses);
    store.set(done);
    return { run: done, replayed: false };
  } catch (e) {
    const code = e instanceof Error && /RUN_|409|цитат|reason|hypothes|максимум|только R2|пуст/i.test(e.message)
      ? 'PROVIDER_BAD_RESPONSE'
      : 'PROVIDER_ERROR';
    const failed = failAnalysisRun(started, code);
    store.set(failed);
    throw e;
  }
}

/**
 * DEMO-прогон локальным парсером: результат хранится локально с явным
 * origin='local-parser' (не серверный run, provenance не даёт).
 */
export function demoRunFor(input: AiRunInput): AnalysisRun {
  const started = startAnalysisRun(input, { origin: 'local-parser', engine: 'Локальный парсер RU/KZ (демо)' });
  try {
    const parsed = parseAdText(started.input.text);
    const hypotheses = parsed.payment.flagged
      ? [{ code: 'R2', quote: parsed.payment.quotes[0], reason: 'Обнаружено платёжное предложение. Требуется решение аналитика.' }]
      : [];
    return succeedAnalysisRun(started, hypotheses);
  } catch {
    return failAnalysisRun(started, 'LOCAL_PARSER_ERROR');
  }
}

/** Импортированный provenance: решения из backup — origin='imported'. */
export function markRunImported(run: AnalysisRun): AnalysisRun {
  return { ...run, origin: 'imported' };
}
