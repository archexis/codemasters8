import { supabase } from './supabase';
import { applyCommand, initialState } from './domain';
import type { Command } from './domain';
import type { AppState, Media } from './types';
import { FutureVersionError, RAW_BACKUP_KEY, V1_IMPORT_BACKUP_KEY, V1_STORAGE_KEY, loadStateFromText, migrateLegacyV1, previewLegacyV1 } from './state-migrations';
import type { LegacyV1Preview } from './state-migrations';
import { applyImportTransform, isRestoreTargetEmpty } from './backup';
import type { ValidatedBackup } from './backup';
import {
  CLEANUP_RETRY_KEY,
  DEMO_ARTIFACT_REPAIR_BACKUP_KEY,
  DEMO_DB_NAME,
  DEMO_DB_STORE,
  DEMO_LOCK_NAME,
  DEMO_LOCK_TIMEOUT_MS,
  DEMO_PUBLICATION_REFRESH_BACKUP_KEY,
  PENDING_COMMAND_KEY,
  SESSION_USER_KEY,
  STAGED_FILES_KEY,
  WORKSPACE_KEY,
} from './storage-keys';

export { FutureVersionError };

const KEY = WORKSPACE_KEY;
const PENDING_KEY = PENDING_COMMAND_KEY;
const STAGED_KEY = STAGED_FILES_KEY;
const CLEANUP_KEY = CLEANUP_RETRY_KEY;
const DEMO_LOCK = DEMO_LOCK_NAME;
const DEMO_OWNER = 'demo';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'application/pdf'];
const EXT_FOR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'application/pdf': 'pdf',
};
const ID_RE = /^[A-Za-z0-9-]{1,80}$/;

let version = 0;
let userId = '';
let sessionGeneration = 0;
const sessionListeners=new Set<()=>void>();
export function onSessionChange(listener:()=>void):()=>void {sessionListeners.add(listener); return ()=>{sessionListeners.delete(listener);};}
let sessionUser: string | null = null;
let tail: Promise<unknown> = Promise.resolve();
let lockDegraded = false;

/* ------------------------------------------------------------------ */
/* S2.2 (C2). Ошибки commit: stale-конфликт, смена сессии, неизвестный  */
/* исход (ответ потерян — повтор тем же commandId безопасен, файл НЕ    */
/* удалять). Все три — Error с message, совместимы со старыми catch.    */
/* ------------------------------------------------------------------ */

export class StaleConflictError extends Error {
  serverState: AppState;
  serverVersion: number;
  draft: Command;
  constructor(message: string, serverState: AppState, serverVersion: number, draft: Command) {
    super(message);
    this.name = 'StaleConflictError';
    this.serverState = serverState;
    this.serverVersion = serverVersion;
    this.draft = draft;
  }
}

export class SessionSupersededError extends Error {
  constructor(message = 'Сессия пользователя сменилась. Команда старой сессии отменена и не применена.') {
    super(message);
    this.name = 'SessionSupersededError';
  }
}

export class UnknownCommitResultError extends Error {
  commandId: string;
  constructor(message: string, commandId: string) {
    super(message);
    this.name = 'UnknownCommitResultError';
    this.commandId = commandId;
  }
}

/* ------------------------------------------------------------------ */
/* Хранилище ключей: браузерный localStorage, в node — память процесса */
/* (unit-тесты DEMO-пути без моков Auth/Storage: настоящий код,         */
/* настоящее сериализованное состояние).                                */
/* ------------------------------------------------------------------ */

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => { data.clear(); },
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
  } as Storage;
}

let fallbackStore: Storage | null = null;
export class StorageWriteError extends Error {
  constructor(public reason: 'quota' | 'unavailable', public cause: unknown) {
    super(reason === 'quota'
      ? 'Локальное хранилище заполнено. Изменения не сохранены; сохраните резервную копию и освободите место.'
      : 'Локальное хранилище недоступно. Изменения не сохранены; разрешите хранение данных в браузере.');
    this.name = 'StorageWriteError';
  }
}
function store(): Storage {
  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) return localStorage;
  } catch (e) { throw new StorageWriteError('unavailable', e); }
  // Memory is only for non-browser consumers (unit tests / CLI).
  if (typeof window !== 'undefined') throw new StorageWriteError('unavailable', undefined);
  if (!fallbackStore) fallbackStore = memoryStorage();
  return fallbackStore;
}

function getItem(key: string): string | null {
  try { return store().getItem(key); } catch { return null; }
}
function setItem(key: string, value: string): void {
  try { store().setItem(key, value); } catch (e) {
    if (e instanceof StorageWriteError) throw e;
    const name = (e as { name?: string })?.name;
    throw new StorageWriteError(name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' ? 'quota' : 'unavailable', e);
  }
}
function removeItem(key: string): void {
  try { store().removeItem(key); } catch { /* ignore */ }
}

export function newCommandId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch { /* ниже запасной генератор */ }
  return `cmd-${Date.now().toString(36)}-${Math.floor(Math.random() * 2 ** 48).toString(36)}`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Сохранить исходную строку отдельно (отказ загрузки / миграция). Ключ workspace при этом НЕ трогается. */
function stashRawBackup(raw: string): void {
  setItem(RAW_BACKUP_KEY, raw);
}

/** Исходник, сохранённый при отказе загрузки (битый JSON / future / невалидные ссылки). */
export function readRawBackup(): string | null {
  return getItem(RAW_BACKUP_KEY);
}

/** Экспорт исходника в файл: future-version отказ и ручной разбор. */
export function downloadRawBackup(raw: string, filename = 'sq-workspace-source-backup.json'): void {
  const blob = new Blob([raw], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Есть ли в хранилище raw legacy v1. Только флаг для UI; loadState ключ v1 не читает и не пишет. */
export function hasLegacyV1Backup(): boolean {
  try {
    return getItem(V1_STORAGE_KEY) != null;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* S2.2 (C2). Сессия: generation растёт при logout/смене пользователя  */
/* (включая автоподписку временных аккаунтов connected-режима: любой   */
/* новый user id — новая сессия). Поздние ответы/очередь старой сессии  */
/* не могут заменить workspace новой.                                  */
/* ------------------------------------------------------------------ */

export function getSessionGeneration(): number {
  return sessionGeneration;
}

export function getSessionUser(): string | null {
  return sessionUser;
}

/**
 * Отметить текущий сеанс. Вызывает App при signOut/signIn (в т.ч. смене
 * временного аккаунта); repository также вызывает сам из loadState по факту
 * смены auth-пользователя, поэтому пропуск вызова в UI не ломает защиту.
 */
export function trackAuthSession(nextUserId: string | null): void {
  if (sessionUser !== nextUserId) {
    userId = '';
    sessionUser = nextUserId;
    sessionGeneration += 1;
    for(const listener of sessionListeners) listener();
    if (nextUserId == null) removeItem(SESSION_USER_KEY);
    else setItem(SESSION_USER_KEY, nextUserId);
  }
}

function queue<T>(work: () => Promise<T>): Promise<T> {
  const run = () => work();
  const next = tail.then(run, run);
  tail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/* ------------------------------------------------------------------ */
/* S2.2 (C2). Pending: намерение сохраняется ДО отправки, удаляется    */
/* после ACK. После reload — проверка/повтор того же ID (тот же        */
/* payload); изменённый payload или чужая сессия повторно не шлются.   */
/* ------------------------------------------------------------------ */

export interface PendingCommand {
  commandId: string;
  command: Command;
  expectedVersion: number;
  session: number;
  user: string;
  savedAt: string;
}

export function readPendingCommand(): PendingCommand | null {
  const raw = getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingCommand;
    if (!parsed || typeof parsed.commandId !== 'string' || !parsed.command) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePendingCommand(pending: PendingCommand): void {
  setItem(PENDING_KEY, JSON.stringify(pending));
}

export function clearPendingCommand(commandId?: string): void {
  if (!commandId) {
    removeItem(PENDING_KEY);
    return;
  }
  const cur = readPendingCommand();
  if (cur && cur.commandId === commandId) removeItem(PENDING_KEY);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

function canonicalEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/* ------------------------------------------------------------------ */
/* S2.2 (C2). DEMO-конверт: state/version/receipts — одно значение.    */
/* Чтение/запись сериализуются между вкладками Web Locks; без API —    */
/* запись блокируется; чтение/экспорт остаются доступными. Legacy      */
/* raw-state значение мигрирует в конверт при первой записи.           */
/* ------------------------------------------------------------------ */

interface DemoReceipt {
  payload: unknown;
  resultVersion: number;
}

interface DemoEnvelope {
  envelope: 1;
  state: AppState;
  version: number;
  receipts: Record<string, DemoReceipt>;
}

function isEnvelope(value: unknown): value is DemoEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v['envelope'] === 1 && typeof v['state'] === 'object' && v['state'] !== null && typeof v['version'] === 'number';
}

function readDemoEnvelope(fallback: AppState): DemoEnvelope {
  let raw = getItem(KEY);
  if (!raw) return { envelope: 1, state: fallback, version: 0, receipts: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    stashRawBackup(raw);
    throw new Error('Сохранённый workspace повреждён: не JSON. Исходник сохранён отдельно.');
  }
  // A previous demo refresh could leave a historical copy attached to new text.
  // Preserve that copy (and claims quoting it), but detach it from the changed ad
  // BEFORE strict validation, otherwise the repair can never be reached.
  const candidate = (isEnvelope(parsed) ? parsed.state : parsed) as Partial<AppState> | null;
  let repaired = false;
  if (candidate && candidate.schemaVersion === fallback.schemaVersion && Array.isArray(candidate.artifacts) && Array.isArray(candidate.ads)) {
    for (const artifact of candidate.artifacts) {
      if (artifact.origin !== 'demo' || !artifact.adId) continue;
      const ad = candidate.ads.find(item => item.id === artifact.adId && item.zkId === artifact.complexId);
      const bundled = fallback.ads.find(item => item.id === ad?.id && item.zkId === ad?.zkId);
      if (!ad || !bundled || artifact.text === ad.text) continue;
      if (ad.text !== bundled.text && !/^demo_project_\d+$/.test(ad.account)) continue;
      delete artifact.adId;
      repaired = true;
    }
  }
  if (repaired) {
    setItem(DEMO_ARTIFACT_REPAIR_BACKUP_KEY, raw);
    raw = JSON.stringify(parsed);
  }
  try {
    if (isEnvelope(parsed)) {
      if (!Number.isSafeInteger(parsed.version) || parsed.version < 0) throw new Error('Некорректная версия DEMO-конверта');
      const loaded = loadStateFromText(JSON.stringify(parsed.state));
      const env = { ...parsed, state: loaded.state, receipts: parsed.receipts ?? {} };
      if (loaded.migrated || repaired) {
        stashRawBackup(raw);
        writeDemoEnvelope(env);
      }
      return env;
    }
  } catch (e) {
    stashRawBackup(raw);
    throw e;
  }
  // Legacy raw-state (до конверта): строгая проверка S2.1, исходник — в backup.
  try {
    const { state, migrated, notes } = loadStateFromText(raw);
    if (migrated && notes.length > 0 && typeof console !== 'undefined') {
      console.info('[S2.1] миграция workspace v2→v3:', notes.join(' '));
    }
    if (migrated || repaired) {
      stashRawBackup(raw);
      // Мигрированное — сразу в рабочий ключ сырым состоянием v3 (ту же форму
      // читает loadState; в конверт превратится при первой записи).
      setItem(KEY, JSON.stringify(state));
    }
    return { envelope: 1, state, version: 0, receipts: {} };
  } catch (e) {
    stashRawBackup(raw);
    throw e;
  }
}

function writeDemoEnvelope(env: DemoEnvelope): void {
  setItem(KEY, JSON.stringify(env));
}

/** Refresh retired bundled publications without replacing user-created records. */
async function loadCurrentDemo(): Promise<DemoEnvelope> {
  const current = initialState();
  const needsRefresh = (env: DemoEnvelope) => env.state.ads.some(ad =>
    current.ads.some(fresh => fresh.id === ad.id && fresh.zkId === ad.zkId) &&
    (/^demo_project_\d+$/.test(ad.account) ||
      (ad.url.startsWith('https://example.invalid/projects/') && ad.text.startsWith('ВЫМЫШЛЕННЫЙ МАТЕРИАЛ.'))));
  const saved = readDemoEnvelope(current);
  if (!needsRefresh(saved)) return saved;
  return withDemoLock(() => {
    const env = readDemoEnvelope(current);
    if (!needsRefresh(env)) return env;
    const raw = getItem(KEY);
    if (raw) setItem(DEMO_PUBLICATION_REFRESH_BACKUP_KEY, raw);
    const replaced = new Set<string>();
    env.state.ads = env.state.ads.map(ad => {
      const fresh = current.ads.find(item => item.id === ad.id && item.zkId === ad.zkId);
      if (!fresh || !(/^demo_project_\d+$/.test(ad.account) ||
        (ad.url.startsWith('https://example.invalid/projects/') && ad.text.startsWith('ВЫМЫШЛЕННЫЙ МАТЕРИАЛ.')))) return ad;
      replaced.add(ad.id);
      return fresh;
    });
    env.state.artifacts = env.state.artifacts?.map(artifact => {
      if (!artifact.adId || !replaced.has(artifact.adId)) return artifact;
      const ad = env.state.ads.find(item => item.id === artifact.adId)!;
      if (artifact.text === ad.text) return artifact;
      const historical = { ...artifact };
      delete historical.adId;
      return historical;
    });
    // Old decisions cannot silently become grounded in a different publication.
    for (const complex of env.state.complexes) {
      for (const factor of complex.factors) {
        const evidence = factor.evidence;
        if (!evidence?.adId || !replaced.has(evidence.adId)) continue;
        const ad = env.state.ads.find(item => item.id === evidence.adId);
        if (evidence.quote && !ad?.text.includes(evidence.quote)) {
          if (factor.status === 'confirmed') factor.status = 'needs-verification';
          evidence.text = `${evidence.text ?? ''}\nЦитата из предыдущей версии DEMO: ${evidence.quote}`.trim();
          delete evidence.quote;
          delete evidence.adId;
        }
      }
    }
    env.version += 1;
    writeDemoEnvelope(env);
    return env;
  });
}

async function withDemoLock<T>(work: () => Promise<T> | T): Promise<T> {
  let locks: { request: (name: string, opts: unknown, fn: () => Promise<T> | T) => Promise<T> } | undefined;
  try {
    const nav = (globalThis as Record<string, unknown>)['navigator'] as
      | { locks?: { request: (name: string, opts: unknown, fn: () => Promise<T> | T) => Promise<T> } }
      | undefined;
    locks = nav?.locks;
  } catch {
    locks = undefined;
  }
  if (locks?.request) {
    return await locks.request(DEMO_LOCK, { mode: 'exclusive', timeout: DEMO_LOCK_TIMEOUT_MS }, work);
  }
  lockDegraded = true;
  if (typeof console !== 'undefined') {
    console.warn('[S6] Web Locks недоступны: DEMO доступен только для чтения/экспорта.');
  }
  throw new Error('Web Locks недоступны: запись DEMO заблокирована. Чтение и экспорт доступны; откройте приложение в браузере с Web Locks.');
}

export function isDemoLockDegraded(): boolean {
  return lockDegraded;
}

/**
 * S2.1 (C2). Загрузка с проверкой версии:
 *  - пусто → свежий канон v3 из seed (в памяти; ключ не трогаем до первой команды);
 *  - v2 → миграция v2→v3 (исходник — в отдельный backup, мигрированное — в рабочий ключ);
 *  - future version → понятный отказ (FutureVersionError с исходником), ключ НЕ перезаписывается;
 *  - битый JSON / невалидные ссылки → отказ, исходная строка сохранена отдельно и НЕ заменяется initialState.
 */
export async function loadState(): Promise<AppState> {
  if (!supabase) {
    const env = await loadCurrentDemo();
    version = env.version;
    return env.state;
  }
  const startedGeneration = sessionGeneration;
  const { data: { session } } = await supabase.auth.getSession();
  if (sessionGeneration !== startedGeneration) throw new SessionSupersededError();
  if (!session) {
    // Регистрации нет: без сессии — DEMO-конверт по умолчанию, а не пустая заглушка.
    userId = '';
    trackAuthSession(null);
    const env = await loadCurrentDemo();
    version = env.version;
    return env.state;
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (sessionGeneration !== startedGeneration) throw new SessionSupersededError();
  if (authError || !user) throw new Error('Войдите через Supabase Auth');
  // S2.2. Смена auth-пользователя (включая временные аккаунты) — новая сессия:
  // поздние ответы старой не заменят workspace новой.
  trackAuthSession(user.id);
  userId = user.id;
  const loadingGeneration = sessionGeneration;
  const { data, error } = await supabase.from('workspaces').select('data,version').eq('owner_id', userId).maybeSingle();
  if (sessionGeneration !== loadingGeneration) throw new SessionSupersededError();
  if (error) throw error;
  version = data?.version ?? 0;
  const serverRaw = data?.data ?? { schemaVersion: 3, complexes: [], ads: [], media: [], signals: {}, signalVersions: {}, audit: [] };
  try {
    return loadStateFromText(typeof serverRaw === 'string' ? serverRaw : JSON.stringify(serverRaw)).state;
  } catch (e) {
    if (e instanceof FutureVersionError) throw e;
    throw new Error(`Серверный workspace не прошёл проверку: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function initializeWorkspace(): Promise<AppState> {
  if (!supabase) return resetDemo();
  const generation = sessionGeneration;
  const { data, error } = await supabase.rpc('initialize_workspace');
  if (sessionGeneration !== generation) throw new SessionSupersededError();
  if (error) throw error;
  version = data.version;
  return data.data;
}

/* ------------------------------------------------------------------ */
/* S2.2 (C2). Commit: очередь вкладки, commandId на намерение, pending */
/* до ACK, sessionGeneration, STALE-восстановление с draft.            */
/* ------------------------------------------------------------------ */

export interface CommitResult {
  state: AppState;
  version: number;
  replayed: boolean;
  appliedVersion: number;
  commandId: string;
}

type TransportCommand = Command & { commandId?: string; mediaAttachment?: Media };

function takeCommandId(payload: TransportCommand, opts?: { commandId?: string }): { commandId: string; command: Command } {
  const commandId = opts?.commandId ?? payload.commandId ?? newCommandId();
  if (!ID_RE.test(commandId)) throw new Error('commandId: неоднозначный идентификатор (допустимы латиница, цифры, дефис, 1–80 символов)');
  const { commandId: _drop, ...rest } = payload;
  return { commandId, command: rest as Command };
}

/**
 * Транспортный commandId внутри объекта команды (commit prop App не менялся:
 * (command: Command) => Promise<void>). Repository извлекает его до
 * валидации и шлёт отдельным RPC-аргументом; в payload квитанции он НЕ входит.
 */
export function withCommandId(command: Command, commandId: string): Command {
  if (!ID_RE.test(commandId)) throw new Error('commandId: неоднозначный идентификатор');
  return { ...(command as unknown as Record<string, unknown>), commandId } as unknown as Command;
}

/**
 * S2.3 (C3). Вложение к ad-команде: одна команда несёт publication/evidence/
 * media/решение. Ключ mediaAttachment — транспорт repository↔SQL, строгие
 * TS-схемы команд его не знают (и не должны: валидация вложения — серверная).
 */
export function attachStagedMedia(command: Command, media: Media): Command {
  const clean: Record<string, unknown> = {};
  for (const k of ['id', 'zkId', 'name', 'kind', 'date', 'note', 'ready', 'path', 'bytes', 'sha256', 'capturedAt'] as const) {
    const v = (media as unknown as Record<string, unknown>)[k];
    if (v !== undefined) clean[k] = v;
  }
  return { ...(command as unknown as Record<string, unknown>), mediaAttachment: clean } as unknown as Command;
}

function splitAttachment(payload: Command): { command: Command; mediaAttachment?: Media } {
  const p = payload as TransportCommand;
  if (!p.mediaAttachment || typeof p.mediaAttachment !== 'object') return { command: payload };
  const { mediaAttachment: _drop, ...rest } = p;
  return { command: rest as Command, mediaAttachment: p.mediaAttachment };
}

/** Убрать null-значения опциональных полей целостности (строгая загрузка состояния null не примет). */
function sanitizeMediaForStore(media: Media): Media {
  const out = { ...(media as unknown as Record<string, unknown>) };
  for (const k of ['bytes', 'sha256', 'capturedAt'] as const) {
    if (out[k] === null || out[k] === undefined) delete out[k];
  }
  return out as unknown as Media;
}

function assertDemoMediaShape(media: Media, owner: string): void {
  if (!ID_RE.test(media.id)) throw new Error('INVALID_MEDIA_ID');
  if (!ID_RE.test(media.zkId)) throw new Error('INVALID_ID');
  const prefix = `${owner}/${media.zkId}/`;
  if (!media.path.startsWith(prefix)) throw new Error('INVALID_STORAGE_PATH');
  const rest = media.path.slice(prefix.length);
  const parts = media.path.split('/');
  if (parts.length !== 3 || parts[0] !== owner || parts[1] !== media.zkId) throw new Error('INVALID_STORAGE_PATH');
  if (!rest.startsWith(`${media.id}.`) || rest.length <= media.id.length + 1) throw new Error('INVALID_STORAGE_PATH');
  if (!ALLOWED_MIME.includes(media.kind)) throw new Error('INVALID_MEDIA_TYPE');
  if (typeof media.bytes === 'number' && media.bytes > MAX_FILE_BYTES) throw new Error('STORAGE_OBJECT_TOO_LARGE');
}

async function commitRemote(payload: Command, commandId: string): Promise<CommitResult> {
  const generation = sessionGeneration;
  let response: { data: unknown; error: { message: string; code?: string } | null; status?: number };
  try {
    response = (await supabase!.rpc('apply_command', {
      command: payload,
      expected_version: version,
      command_id: commandId,
    })) as unknown as { data: unknown; error: { message: string } | null };
  } catch (e) {
    // Сеть/таймаут: commit мог примениться — исход НЕИЗВЕСТЕН. Файл не удалять,
    // повторить тем же commandId (квитанция защитит от дубля).
    throw new UnknownCommitResultError(
      `Ответ сервера не получен (commandId ${commandId}); исход неизвестен — повторите отправку тем же ID, повтор безопасен.`,
      commandId,
    );
  }
  const { data, error } = response;
  if (sessionGeneration !== generation) throw new SessionSupersededError();
  if (error) {
    const message = error.message ?? String(error);
    // PostgREST often returns transport failures as { error, status: 0 }, not throws.
    if (response.status === 0 || ((response.status ?? 0) >= 500 && !/^P\d{4}$/.test(error.code ?? '')) || /fetch failed|failed to fetch|network|timeout|timed out/i.test(message)) {
      throw new UnknownCommitResultError(`Ответ сервера не получен (${commandId}); повторите отправку тем же ID.`, commandId);
    }
    if (/STALE_VERSION/.test(message)) {
      // S2.2. Явное восстановление: перечитать, сохранить draft, показать конфликт.
      // Решение НЕ применяется к новым фактам автоматически.
      const serverState = await loadState();
      throw new StaleConflictError(
        'Данные изменились в другой вкладке. Состояние обновлено; ваше решение сохранено как черновик — проверьте и подтвердите заново.',
        serverState,
        version,
        payload,
      );
    }
    if (/COMMAND_ID_REUSED/.test(message)) {
      throw new UnknownCommitResultError('Этот ID уже применён с другим содержимым. Перезагрузите состояние и проверьте решение перед новой отправкой.', commandId);
    }
    throw new Error(message);
  }
  const result = data as { data: AppState; version: number; replayed?: boolean; appliedVersion?: number; commandId?: string };
  version = result.version;
  return {
    state: result.data,
    version: result.version,
    replayed: result.replayed === true,
    appliedVersion: result.appliedVersion ?? result.version,
    commandId: result.commandId ?? commandId,
  };
}

async function commitDemo(base: AppState, payload: Command, commandId: string, reviewer: string): Promise<CommitResult> {
  return withDemoLock(async () => {
    // S2.2. Источник истины между вкладками — конверт (Web Locks держат мьютекс).
    const env = readDemoEnvelope(base);
    const prior = env.receipts[commandId];
    if (prior) {
      if (canonicalEqual(prior.payload, payload)) {
        version = env.version;
        return { state: env.state, version: env.version, replayed: true, appliedVersion: prior.resultVersion, commandId };
      }
      throw new Error('COMMAND_ID_REUSED: этот ID намерения уже использован с другим содержимым.');
    }
    const { command: cleanPayload, mediaAttachment } = splitAttachment(payload);
    // Локальное зеркало серверных проверок вложения (в SQL — check_evidence_media).
    let fullMedia: Media | undefined;
    if (mediaAttachment) {
      fullMedia = sanitizeMediaForStore(mediaAttachment);
      if (fullMedia.zkId !== commandZk(cleanPayload)) throw new Error('INVALID_ID: вложение относится к другому объекту.');
      assertDemoMediaShape(fullMedia, DEMO_OWNER);
      if (!(await demoBlobExists(fullMedia.path))) throw new Error('STORAGE_OBJECT_NOT_FOUND');
    }
    // media-команда: строгая локальная схема не знает bytes/sha256 — валидируем
    // без них, полные метаданные кладём в состояние после applyCommand.
    let localPayload = cleanPayload;
    let standaloneFull: Media | undefined;
    if (cleanPayload.type === 'media') {
      standaloneFull = sanitizeMediaForStore(cleanPayload.media);
      localPayload = { type: 'media', media: stripIntegrity(cleanPayload.media) };
    }
    // A different tab may have imported the same preview after it was prepared.
    // Creation intents must never turn into updates of an analyst's existing card.
    if (localPayload.type==='complex' && commandId.startsWith('registry-create-') && env.state.complexes.some(z=>z.id===localPayload.complex.id)) {
      throw new Error('Объект уже создан в другой вкладке. Получите новый предпросмотр импорта.');
    }
    const next = applyCommand(env.state, localPayload, reviewer, { commandId, sourceVersion: env.version });
    if (cleanPayload.type === 'artifact.register') {
      const artifact = next.artifacts?.find(a => a.id === cleanPayload.artifact.id);
      if (artifact) {
        const bytes = new TextEncoder().encode(artifact.text);
        artifact.bytes = bytes.byteLength;
        if (globalThis.crypto?.subtle) {
          const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
          artifact.sha256 = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
        }
      }
    }
    if (fullMedia) {
      next.media.push(fullMedia);
      if (cleanPayload.type === 'ad' && cleanPayload.decision === 'confirmed' && cleanPayload.hypothesis) {
        const factor = next.complexes.find(z => z.id === cleanPayload.ad.zkId)?.factors.find(f => f.code === cleanPayload.hypothesis!.code);
        if (factor?.evidence) factor.evidence.mediaIds = [...new Set([...(factor.evidence.mediaIds ?? []), fullMedia.id])];
      }
      const head = next.audit[0];
      if (head) {
        head.commandId = commandId;
        head.actorId = reviewer;
        head.details = structuredClone(payload);
      }
    } else if (standaloneFull && (standaloneFull.bytes !== undefined || standaloneFull.sha256 !== undefined)) {
      const stored = next.media.find((m) => m.id === standaloneFull!.id);
      if (stored) Object.assign(stored, sanitizeMediaForStore(standaloneFull));
      const head = next.audit[0];
      if (head) {
        head.commandId = commandId;
        head.actorId = reviewer;
      }
    } else {
      const head = next.audit[0];
      if (head) {
        head.commandId = commandId;
        head.actorId = reviewer;
      }
    }
    const appliedVersion = env.version + 1;
    const out: DemoEnvelope = {
      envelope: 1,
      state: next,
      version: appliedVersion,
      receipts: { ...env.receipts, [commandId]: { payload: structuredClone(payload), resultVersion: appliedVersion } },
    };
    writeDemoEnvelope(out);
    version = appliedVersion;
    return { state: next, version: appliedVersion, replayed: false, appliedVersion, commandId };
  });
}

function commandZk(command: Command): string {
  if (command.type === 'factor' || command.type === 'readiness' || command.type === 'signal') return command.zkId;
  if (command.type === 'ad') return command.ad.zkId;
  if (command.type === 'media') return command.media.zkId;
  if (command.type === 'complex') return command.complex.id;
  // Investigation commands reference cases/claims instead of accepting a raw
  // file attachment. Their artifacts link already committed media explicitly.
  throw new Error('Вложение допустимо только для команды объекта или публикации.');
}

function stripIntegrity(media: Media): Media {
  const { bytes: _b, sha256: _s, capturedAt: _c, ...rest } = media as Media & { bytes?: unknown; sha256?: unknown; capturedAt?: unknown };
  return rest as Media;
}

/**
 * S2.2. Commit с квитанцией: очередь вкладки, commandId на намерение, pending
 * до ACK, защита сессии, STALE-восстановление. Возвращает состояние; детали
 * квитанции — в commitCommand.
 */
export async function saveCommand(state: AppState, command: Command, reviewer: string, opts?: { commandId?: string }): Promise<AppState> {
  return (await commitCommand(state, command, reviewer, opts)).state;
}

export async function commitCommand(
  state: AppState,
  command: TransportCommand,
  reviewer: string,
  opts?: { commandId?: string },
): Promise<CommitResult> {
  const { commandId, command: payload } = takeCommandId(command, opts);
  // S2.2. Сессия фиксируется в момент постановки в очередь: команды,
  // поставленные до смены пользователя, после неё не выполняются.
  const enqueuedSession = sessionGeneration;
  const enqueuedUser = sessionUser || userId || DEMO_OWNER;
  writePendingCommand({
    commandId,
    command: structuredClone(payload) as Command,
    expectedVersion: version,
    session: enqueuedSession,
    user: enqueuedUser,
    savedAt: new Date().toISOString(),
  });
  return queue(async () => {
    if (sessionGeneration !== enqueuedSession) throw new SessionSupersededError();
    try {
      // Маршрут по владельцу, а не по наличию клиента: без сессии — DEMO-конверт.
      const owner = await requireOwner();
      const result = owner === DEMO_OWNER
        ? await commitDemo(state, payload, commandId, reviewer)
        : await commitRemote(payload, commandId);
      if (sessionGeneration !== enqueuedSession) throw new SessionSupersededError();
      if (result.commandId === commandId) clearPendingCommand(commandId);
      return result;
    } catch (e) {
      // Неизвестный исход / stale-конфликт / смена сессии: pending остаётся —
      // повтор тем же ID безопасен. Известный отказ валидации: pending тоже
      // остаётся (квитанции нет, повтор тем же ID с исправленным содержимым
      // допустим и не создаст дубль).
      throw e;
    }
  });
}

/**
 * S2.2. Повтор pending-намерения после reload/потери ответа: тот же
 * commandId и тот же payload, свежая версия. Изменённый payload и чужая
 * сессия — отказ без отправки.
 */
export async function retryPendingCommand(state: AppState, reviewer: string): Promise<CommitResult> {
  const pending = readPendingCommand();
  if (!pending) throw new Error('Нет незавершённых команд для повтора.');
  const currentUser = sessionUser || userId || DEMO_OWNER;
  if (pending.user !== currentUser) {
    throw new Error('Намерение принадлежит другой сессии — автоматический повтор запрещён. Создайте решение заново.');
  }
  if (!supabase) {
    return commitCommand(state, withCommandId(pending.command, pending.commandId), reviewer);
  }
  // Свежая версия перед повтором (квитанция сработает раньше stale check,
  // если commit уже был применён).
  await loadState();
  return commitCommand(state, withCommandId(pending.command, pending.commandId), reviewer);
}

/* ------------------------------------------------------------------ */
/* S2.3 (C3). Staged-файлы и очередь повтора очистки.                  */
/* ------------------------------------------------------------------ */

function readStaged(): Record<string, string[]> {
  try {
    const parsed: unknown = JSON.parse(getItem(STAGED_KEY) ?? '{}');
    if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, string[]>;
  } catch { /* ниже пусто */ }
  return {};
}

/** Пометить загруженный файл как staged для commandId (область будущей cleanup). */
export function stageFileForCommand(commandId: string, path: string): void {
  const all = readStaged();
  const list = Array.isArray(all[commandId]) ? all[commandId] : [];
  if (!list.includes(path)) list.push(path);
  all[commandId] = list;
  setItem(STAGED_KEY, JSON.stringify(all));
}

/** Подтвердить файл (после ACK): ссылка принята, из области cleanup убрать БЕЗ удаления. */
export function unstageFileForCommand(commandId: string, path?: string): void {
  const all = readStaged();
  if (!all[commandId]) return;
  if (!path) {
    delete all[commandId];
  } else {
    all[commandId] = all[commandId].filter((p) => p !== path);
    if (all[commandId].length === 0) delete all[commandId];
  }
  setItem(STAGED_KEY, JSON.stringify(all));
}

export function stagedPathsFor(commandId: string): string[] {
  const all = readStaged();
  return Array.isArray(all[commandId]) ? [...all[commandId]] : [];
}

/**
 * S2.3. Удалить ТОЛЬКО staged-файл этого commandId. Чужие/принятые файлы
 * здесь удалить нельзя (защита от «всегда удалять в catch»).
 */
export async function removeStagedFile(path: string, commandId: string): Promise<void> {
  if (!stagedPathsFor(commandId).includes(path)) {
    throw new Error('Файл не staged для этого решения — удаление запрещено.');
  }
  await removeFile(path);
  unstageFileForCommand(commandId, path);
}

/** Записать файл в очередь повтора очистки (cleanup не удался — повторить позже). */
export function recordCleanupRetry(path: string): void {
  let list: string[] = [];
  try {
    const parsed: unknown = JSON.parse(getItem(CLEANUP_KEY) ?? '[]');
    if (Array.isArray(parsed)) list = parsed.filter((p): p is string => typeof p === 'string');
  } catch { /* ниже перезапись */ }
  if (!list.includes(path)) list.push(path);
  setItem(CLEANUP_KEY, JSON.stringify(list));
}

export function listCleanupRetries(): string[] {
  try {
    const parsed: unknown = JSON.parse(getItem(CLEANUP_KEY) ?? '[]');
    if (Array.isArray(parsed)) return parsed.filter((p): p is string => typeof p === 'string');
  } catch { /* ниже пусто */ }
  return [];
}

/** Отложенная очистка: только свои неподключённые staged-файлы; успех убирает из очереди. */
export async function retryPendingCleanups(): Promise<{ removed: string[]; failed: { path: string; error: string }[] }> {
  const pending = listCleanupRetries();
  const removed: string[] = [];
  const failed: { path: string; error: string }[] = [];
  const keep: string[] = [];
  for (const path of pending) {
    try {
      await removeFile(path);
      removed.push(path);
    } catch (e) {
      keep.push(path);
      failed.push({ path, error: e instanceof Error ? e.message : String(e) });
    }
  }
  setItem(CLEANUP_KEY, JSON.stringify(keep));
  return { removed, failed };
}

/* ------------------------------------------------------------------ */

export async function resetDemo(): Promise<AppState> {
  try {
    if (typeof indexedDB !== 'undefined') {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(DEMO_DB_STORE, 'readwrite');
        tx.objectStore(DEMO_DB_STORE).clear();
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      });
    } else {
      memoryBlobs.clear();
    }
  } catch {
    /* хранилище недоступно — сбрасываем хотя бы ключи */
  }
  removeItem(KEY);
  removeItem(PENDING_KEY);
  removeItem(STAGED_KEY);
  removeItem(CLEANUP_KEY);
  version = 0;
  userId = '';
  return initialState();
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DEMO_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DEMO_DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const memoryBlobs = new Map<string, Blob>();

async function blobStore(mode: IDBTransactionMode, path: string, file?: File): Promise<Blob | undefined> {
  if (typeof indexedDB === 'undefined') {
    if (mode === 'readwrite') {
      if (file) memoryBlobs.set(path, file);
      else memoryBlobs.delete(path);
      return undefined;
    }
    return memoryBlobs.get(path);
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DEMO_DB_STORE, mode);
    const req = file ? tx.objectStore(DEMO_DB_STORE).put(file, path) : mode === 'readwrite' ? tx.objectStore(DEMO_DB_STORE).delete(path) : tx.objectStore(DEMO_DB_STORE).get(path);
    tx.oncomplete = () => {
      resolve(req.result as Blob | undefined);
      db.close();
    };
    tx.onerror = () => {
      reject(tx.error);
      db.close();
    };
  });
}

/** S2.5. Байты DEMO-файла для сборки backup (тот же IndexedDB/память, что у repository). */
export async function readDemoFileBytes(path: string): Promise<Uint8Array> {
  const blob = await blobStore('readonly', path);
  if (!blob) throw new Error(`Файл отсутствует в этом браузере: ${path}`);
  return new Uint8Array(await blob.arrayBuffer());
}

/** Read from the same owner/storage used by uploads, including logged-out DEMO. */
export async function readFileBytes(media: Media): Promise<Uint8Array> {
  const owner = await requireOwner();
  if (!supabase || owner === DEMO_OWNER) return readDemoFileBytes(media.path);
  const { data, error } = await supabase.storage.from('evidence').download(media.path);
  if (error || !data) throw new Error(`Файл ${media.id} не скачался: ${error?.message ?? 'пусто'}`);
  return new Uint8Array(await data.arrayBuffer());
}

/** Restore through the repository so paths, version and persisted state agree. */
export async function restoreDemoBackup(backup: ValidatedBackup): Promise<AppState> {
  return withDemoLock(async () => {
    const env = readDemoEnvelope(initialState());
    if (!isRestoreTargetEmpty(env.state)) throw new Error('Восстановление — только в пустое workspace');
    const imported = applyImportTransform(backup.workspace, 'demo');
    for (const media of imported.media) {
      const bytes = backup.files.get(media.id);
      if (!bytes) throw new Error(`Файл отсутствует в пакете: ${media.id}`);
      media.path = mediaPath(DEMO_OWNER, media.zkId, media.id, mediaExtFor(media.kind, media.name));
      await blobStore('readwrite', media.path, new File([bytes as unknown as BlobPart], media.name, { type: media.kind }));
    }
    // Validate before publishing the restored workspace; never ACK an unloadable state.
    const state = loadStateFromText(JSON.stringify(imported)).state;
    const restoredVersion = env.version + 1;
    writeDemoEnvelope({ envelope: 1, state, version: restoredVersion, receipts: {} });
    version = restoredVersion;
    return state;
  });
}

async function demoBlobExists(path: string): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return memoryBlobs.has(path);
  const blob = await blobStore('readonly', path);
  return blob != null;
}

async function requireOwner(): Promise<string> {
  if (userId) return userId;
  if (!supabase) return DEMO_OWNER;
  // Регистрации нет: без сессии владелец — DEMO (локальный конверт).
  // Серверная защита connected-данных — RLS/политики, а не эта функция.
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return DEMO_OWNER;
    userId = user.id;
    return userId;
  } catch {
    return DEMO_OWNER;
  }
}

/** Чистый конструктор стабильного пути C3 <owner>/<zk>/<mediaId>.<ext>. */
export function mediaPath(owner: string, zkId: string, mediaId: string, ext: string): string {
  return `${owner}/${zkId}/${mediaId}.${ext}`;
}

export function mediaExtFor(mimeType: string, fileName: string): string {
  const canonical = EXT_FOR_MIME[mimeType];
  if (canonical) return canonical;
  return fileName.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'bin';
}

async function sha256Hex(file: File): Promise<string | null> {
  try {
    const subtle = (globalThis as Record<string, unknown>)['crypto'] as
      | { subtle?: { digest: (alg: string, data: ArrayBuffer) => Promise<ArrayBuffer> } }
      | undefined;
    if (!subtle?.subtle) return null;
    const digest = await subtle.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/**
 * S2.3 (C3). Upload ДО финального DB-commit. mediaId стабилен на намерение:
 * retry передаёт прежний mediaId — путь не меняется. Возвращает метаданные
 * целостности (bytes/sha256); сервер их перепроверяет по Storage metadata.
 */
export async function uploadFile(file: File, zkId: string, opts?: { mediaId?: string }): Promise<Media> {
  if (!ALLOWED_MIME.includes(file.type) || file.size > MAX_FILE_BYTES || file.size <= 0) {
    throw new Error('Допустимы JPG, PNG, WebP, MP4, PDF до 20 МБ');
  }
  if (!ID_RE.test(zkId)) throw new Error('Неизвестный объект');
  const id = opts?.mediaId && ID_RE.test(opts.mediaId) ? opts.mediaId : newCommandId().replace(/^cmd-/, '').slice(0, 36);
  const owner = await requireOwner();
  const path = mediaPath(owner, zkId, id, mediaExtFor(file.type, file.name));
  if (supabase && owner !== DEMO_OWNER) {
    const { error } = await supabase.storage.from('evidence').upload(path, file, { contentType: file.type });
    if (error) {
      // Retry a lost upload response only when the existing bytes really match.
      if (!/exists|duplicate|already|409/i.test(error.message)) throw error;
      const { data: existing, error: readError } = await supabase.storage.from('evidence').download(path);
      if (readError || !existing || existing.size !== file.size) throw error;
      const actual = new Uint8Array(await existing.arrayBuffer());
      const expected = new Uint8Array(await file.arrayBuffer());
      if (!actual.every((b, i) => b === expected[i])) throw error;
    }
  } else await blobStore('readwrite', path, file);
  return {
    id,
    zkId,
    path,
    name: file.name,
    kind: file.type,
    date: todayISO(),
    note: '',
    ready: null,
    bytes: file.size,
    sha256: await sha256Hex(file),
    capturedAt: new Date().toISOString(),
  };
}

export async function removeFile(path: string) {
  const owner = await requireOwner();
  if (supabase && owner !== DEMO_OWNER) {
    const { error } = await supabase.storage.from('evidence').remove([path]);
    if (error) throw error;
  } else {
    const env = readDemoEnvelope(initialState());
    if (env.state.media.some(m => m.path === path)) throw new Error('Файл уже связан с сохранёнными данными — удаление запрещено.');
    await blobStore('readwrite', path);
  }
}

export async function mediaUrl(media: Media): Promise<string> {
  const owner = await requireOwner();
  if (supabase && owner !== DEMO_OWNER) {
    const { data, error } = await supabase.storage.from('evidence').createSignedUrl(media.path, 300);
    if (error) throw error;
    return data.signedUrl;
  }
  const blob = await blobStore('readonly', media.path);
  if (!blob) throw new Error('Файл не найден в этом браузере');
  return URL.createObjectURL(blob);
}

/**
 * S2.1. Legacy sq_state_v1 — отдельная команда импорта из файла с preview.
 * Ключ v1 в хранилище НЕ читается и НЕ изменяется (raw backup нетронут):
 * читается только текст файла, выбранный пользователем. Текст файла
 * сохраняется отдельно (V1_IMPORT_BACKUP_KEY) для разбора споров.
 */
export function previewLegacyV1File(fileText: string): LegacyV1Preview {
  let raw: unknown;
  try {
    raw = JSON.parse(fileText);
  } catch {
    throw new Error('Файл v1 повреждён: не JSON.');
  }
  return previewLegacyV1(raw);
}

export function importLegacyV1File(fileText: string): AppState {
  let raw: unknown;
  try {
    raw = JSON.parse(fileText);
  } catch {
    throw new Error('Файл v1 повреждён: не JSON.');
  }
  const { state } = migrateLegacyV1(raw);
  setItem(V1_IMPORT_BACKUP_KEY, fileText);
  setItem(KEY, JSON.stringify(state));
  return state;
}
