/**
 * S2.5 (C3). Полный backup и restore: ZIP с manifest.json, workspace.json,
 * files/<mediaId>.<ext>. Чистые функции без сети/хранилищ: байты передаются
 * явно, ничего не отправляется внешнему сервису упаковки (ZIP собирается
 * локально, метод store без сжатия).
 *
 * Формат:
 *  - `manifest.json`: { version: 1, createdAt, schemaVersion, files: [{
 *    mediaId, archivePath, name, bytes, sha256 }] }
 *  - `workspace.json`: канонический AppState (IDs/связи/атрибуция).
 *  - `files/<mediaId>.<ext>`: байты каждого media из workspace.media.
 *
 * Лимиты MVP (отказ ДО записи/распаковки больших буферов):
 *  - суммарный распакованный размер ≤ 200 МБ;
 *  - число файлов ≤ 100.
 * Пути архива: никакого `../`, абсолютных путей и обратных слешей.
 *
 * Документированные преобразования импорта (C3, зеркало SQL restore_workspace):
 *  - активные confirmed → needs-verification;
 *  - текущие signals → draft;
 *  - complexes[].origin → 'imported' (исходная атрибуция — в import-событии);
 *  - история помечается imported (details.origin), добавляется import event;
 *  - receipts/квоты/авторизация из архива НЕ импортируются (в AppState их нет;
 *    чужие ключи отбрасываются).
 * Roundtrip сравнивает тексты/источники/IDs/связи/байты с учётом именно этой
 * таблицы — побитовая идентичность workspace НЕ заявляется.
 */

import type { AppState } from './types';

/** Версия формата backup-пакета. Не путать со schemaVersion workspace. */
export const BACKUP_FORMAT_VERSION = 1;
/** MVP-лимиты: отказ до записи при превышении. */
export const BACKUP_MAX_FILES = 100;
export const BACKUP_MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
/** Допустимый путь файла в архиве: files/<mediaId>.<ext>. */
export const BACKUP_FILE_PATH_RE = /^files\/[A-Za-z0-9-]{1,80}\.[A-Za-z0-9]{1,10}$/;
const MEDIA_ID_RE = /^[A-Za-z0-9-]{1,80}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export interface BackupFileEntry {
  mediaId: string;
  archivePath: string;
  name: string;
  bytes: number;
  sha256: string;
}

export interface BackupManifest {
  version: number;
  createdAt: string;
  /** schemaVersion исходного workspace (2 — legacy, 3 — канон). */
  schemaVersion: number;
  files: BackupFileEntry[];
}

export interface ValidatedBackup {
  manifest: BackupManifest;
  workspace: AppState;
  /** Байты по mediaId (ключи — manifest entries). */
  files: Map<string, Uint8Array>;
}

export interface RestorePreview {
  /** Активные confirmed, которые станут needs-verification. */
  confirmedToVerify: Array<{ zkId: string; code: string }>;
  /** Сигналы, которые станут draft. */
  signalsToDraft: string[];
  mediaCount: number;
  fileBytes: number;
  auditNote: string;
}

/** Путь файла в архиве по mediaId и исходному имени. */
export function archivePathFor(mediaId: string, name: string): string {
  const tail = (name.split('.').pop() ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || 'bin';
  return `files/${mediaId}.${tail}`;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 байтов (SubtleCrypto: браузер и Node 18+; сеть не используется). */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('SHA-256 недоступен в этом окружении');
  const digest = await subtle.digest('SHA-256', data as unknown as ArrayBuffer);
  return hex(new Uint8Array(digest));
}

/* ---------- минимальный ZIP store (writer + reader, без зависимостей) ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntryInput {
  name: string;
  data: Uint8Array;
}

const te = () => new TextEncoder();
const td = () => new TextDecoder();

/**
 * Собрать ZIP (метод store, без сжатия). Имена — UTF-8 с флагом 0x0800.
 * Детерминирован кроме содержимого: фиксированная DOS-дата.
 */
export function createZipStore(entries: ZipEntryInput[]): Uint8Array {
  for (const e of entries) {
    if (e.name.length === 0 || e.name.length > 512) throw new Error(`BACKUP_BAD_ENTRY: ${e.name}`);
  }
  const nameBytes = entries.map((e) => te().encode(e.name));
  let size = 0;
  for (let i = 0; i < entries.length; i++) size += 30 + nameBytes[i].length + entries[i].data.length;
  const centralStartEstimate = size;
  size += entries.reduce((s, _, i) => s + 46 + nameBytes[i].length, 0) + 22;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let offset = 0;
  const centralOffsets: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    const name = nameBytes[i];
    const data = entries[i].data;
    centralOffsets.push(offset);
    view.setUint32(offset, 0x04034b50, true); offset += 4; // local header
    view.setUint16(offset, 20, true); offset += 2; // version needed
    view.setUint16(offset, 0x0800, true); offset += 2; // UTF-8 flag
    view.setUint16(offset, 0, true); offset += 2; // method store
    view.setUint16(offset, 0, true); offset += 2; // time
    view.setUint16(offset, 0x21, true); offset += 2; // date (1980-01-01)
    view.setUint32(offset, crc32(data), true); offset += 4;
    view.setUint32(offset, data.length, true); offset += 4;
    view.setUint32(offset, data.length, true); offset += 4;
    view.setUint16(offset, name.length, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2; // extra len
    out.set(name, offset); offset += name.length;
    out.set(data, offset); offset += data.length;
  }
  const centralStart = offset;
  void centralStartEstimate;
  for (let i = 0; i < entries.length; i++) {
    const name = nameBytes[i];
    const data = entries[i].data;
    view.setUint32(offset, 0x02014b50, true); offset += 4; // central header
    view.setUint16(offset, 20, true); offset += 2; // version made by
    view.setUint16(offset, 20, true); offset += 2; // version needed
    view.setUint16(offset, 0x0800, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2; // method store
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0x21, true); offset += 2;
    view.setUint32(offset, crc32(data), true); offset += 4;
    view.setUint32(offset, data.length, true); offset += 4;
    view.setUint32(offset, data.length, true); offset += 4;
    view.setUint16(offset, name.length, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2; // extra
    view.setUint16(offset, 0, true); offset += 2; // comment
    view.setUint16(offset, 0, true); offset += 2; // disk
    view.setUint16(offset, 0, true); offset += 2; // int attrs
    view.setUint32(offset, 0, true); offset += 4; // ext attrs
    view.setUint32(offset, centralOffsets[i], true); offset += 4;
    out.set(name, offset); offset += name.length;
  }
  const centralSize = offset - centralStart;
  view.setUint32(offset, 0x06054b50, true); offset += 4; // EOCD
  view.setUint16(offset, 0, true); offset += 2;
  view.setUint16(offset, 0, true); offset += 2;
  view.setUint16(offset, entries.length, true); offset += 2;
  view.setUint16(offset, entries.length, true); offset += 2;
  view.setUint32(offset, centralSize, true); offset += 4;
  view.setUint32(offset, centralStart, true); offset += 4;
  view.setUint16(offset, 0, true); offset += 2;
  return out.slice(0, offset);
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Прочитать ZIP (только store; сжатые entries недоверенного архива — отказ). */
export function parseZipStore(zip: Uint8Array): ZipEntry[] {
  if (zip.length < 22) throw new Error('BACKUP_NOT_ZIP: слишком короткий файл');
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  const scanStart = Math.max(0, zip.length - 65557);
  for (let i = zip.length - 22; i >= scanStart; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('BACKUP_NOT_ZIP: EOCD не найден');
  const count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralStart = view.getUint32(eocd + 16, true);
  if (centralStart + centralSize > zip.length) throw new Error('BACKUP_CORRUPT: каталог за пределами файла');
  // Лимит числа файлов — до выделения буферов.
  if (count > BACKUP_MAX_FILES) {
    throw new Error(`BACKUP_TOO_MANY_FILES: в пакете ${count} файлов, максимум ${BACKUP_MAX_FILES}`);
  }
  let total = 0;
  let p = centralStart;
  const metas: Array<{ name: string; method: number; size: number; crc: number; localOffset: number }> = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('BACKUP_CORRUPT: повреждён каталог');
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = td().decode(zip.slice(p + 46, p + 46 + nameLen));
    metas.push({ name, method, size, crc, localOffset });
    total += size;
    // Лимит суммарного размера — до распаковки/копирования.
    if (total > BACKUP_MAX_UNCOMPRESSED_BYTES) {
      throw new Error(`BACKUP_TOO_LARGE: распакованный размер превышает ${BACKUP_MAX_UNCOMPRESSED_BYTES} байт`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  const entries: ZipEntry[] = [];
  for (const m of metas) {
    if (m.method !== 0) throw new Error(`BACKUP_UNSUPPORTED_METHOD: ${m.name} требует распаковки, пакет не принят`);
    if (view.getUint32(m.localOffset, true) !== 0x04034b50) throw new Error('BACKUP_CORRUPT: повреждён локальный заголовок');
    const nameLen = view.getUint16(m.localOffset + 26, true);
    const extraLen = view.getUint16(m.localOffset + 28, true);
    const start = m.localOffset + 30 + nameLen + extraLen;
    const data = zip.slice(start, start + m.size);
    if (data.length !== m.size) throw new Error(`BACKUP_CORRUPT: обрезанные данные ${m.name}`);
    if (crc32(data) !== m.crc) throw new Error(`BACKUP_CORRUPT: CRC не сошёлся для ${m.name}`);
    entries.push({ name: m.name, data });
  }
  return entries;
}

/** Отказ при `../`, абсолютных путях и обратных слешах. */
export function assertSafeArchivePath(name: string): void {
  if (
    name.startsWith('/') || name.startsWith('\\') || name.includes('\\') ||
    /^[A-Za-z]:/.test(name) || name.split('/').includes('..') || name.includes('\0')
  ) {
    throw new Error(`BACKUP_BAD_PATH: запрещённый путь в архиве: ${name}`);
  }
}

/* ---------- сборка пакета ---------- */

/**
 * Собрать полный backup-пакет. Каждое media workspace обязано иметь байты:
 * отсутствующие байты — отказ (обычный полный restore; legacy missing mark —
 * отдельный путь и здесь не допускается).
 */
export async function buildBackup(
  state: AppState,
  filesByMediaId: Map<string, Uint8Array> | Record<string, Uint8Array>,
): Promise<{ zip: Uint8Array; manifest: BackupManifest }> {
  const files = filesByMediaId instanceof Map
    ? filesByMediaId
    : new Map(Object.entries(filesByMediaId));
  if (state.media.length > BACKUP_MAX_FILES) {
    throw new Error(`BACKUP_TOO_MANY_FILES: ${state.media.length} файлов, максимум ${BACKUP_MAX_FILES}`);
  }
  const manifestFiles: BackupFileEntry[] = [];
  let total = 0;
  const entries: ZipEntryInput[] = [];
  for (const m of state.media) {
    if (!MEDIA_ID_RE.test(m.id)) throw new Error(`BACKUP_BAD_ID: media ${m.id}`);
    const bytes = files.get(m.id);
    if (!bytes) throw new Error(`BACKUP_MISSING_BYTES: нет байтов для media ${m.id} (полный backup требует все файлы)`);
    total += bytes.length;
    if (total > BACKUP_MAX_UNCOMPRESSED_BYTES) {
      throw new Error(`BACKUP_TOO_LARGE: распакованный размер превышает ${BACKUP_MAX_UNCOMPRESSED_BYTES} байт`);
    }
    const archivePath = archivePathFor(m.id, m.name);
    manifestFiles.push({ mediaId: m.id, archivePath, name: m.name, bytes: bytes.length, sha256: await sha256Hex(bytes) });
    entries.push({ name: archivePath, data: bytes });
  }
  const schemaVersion = state.schemaVersion ?? 2;
  const manifest: BackupManifest = {
    version: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    schemaVersion,
    files: manifestFiles,
  };
  const zip = createZipStore([
    { name: 'manifest.json', data: te().encode(JSON.stringify(manifest)) },
    { name: 'workspace.json', data: te().encode(JSON.stringify(state)) },
    ...entries,
  ]);
  return { zip, manifest };
}

/* ---------- проверка пакета ---------- */

function parseJsonEntry(entries: ZipEntry[], name: string): unknown {
  const found = entries.find((e) => e.name === name);
  if (!found) throw new Error(`BACKUP_MISSING_ENTRY: в пакете нет ${name}`);
  try {
    return JSON.parse(td().decode(found.data));
  } catch {
    throw new Error(`BACKUP_CORRUPT: ${name} — не JSON`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Проверить весь пакет и ссылки (клиентская проверка; SQL повторяет её
 * серверно и ей не доверяет). Возвращает workspace + байты по mediaId.
 * Отказы: BACKUP_* с перечнем проблемных файлов.
 */
export async function validateBackupPackage(zip: Uint8Array): Promise<ValidatedBackup> {
  const entries = parseZipStore(zip);
  for (const e of entries) assertSafeArchivePath(e.name);
  const names = new Set(entries.map((e) => e.name));
  if (!names.has('manifest.json') || !names.has('workspace.json')) {
    throw new Error('BACKUP_MISSING_ENTRY: нужны manifest.json и workspace.json');
  }
  const rawManifest = parseJsonEntry(entries, 'manifest.json');
  if (!isRecord(rawManifest) || rawManifest.version !== BACKUP_FORMAT_VERSION) {
    throw new Error('BACKUP_UNSUPPORTED_VERSION: manifest.version должен быть 1');
  }
  if (!Array.isArray(rawManifest.files)) throw new Error('BACKUP_CORRUPT: manifest.files — не список');
  const manifest = rawManifest as unknown as BackupManifest;
  // Подписанные URL как постоянные ссылки не хранятся (C6): в пакете им не место.
  const manifestText = JSON.stringify(manifest);
  if (/signedUrl/i.test(manifestText)) throw new Error('BACKUP_BAD_MANIFEST: manifest не должен содержать подписанные URL');
  const byPath = new Map(entries.map((e) => [e.name, e.data]));
  const problems: string[] = [];
  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (const f of manifest.files) {
    if (!isRecord(f as unknown) || !MEDIA_ID_RE.test(String((f as BackupFileEntry).mediaId))) {
      problems.push(`плохая запись manifest: ${JSON.stringify(f).slice(0, 80)}`);
      continue;
    }
    const entry = f as BackupFileEntry;
    if (!BACKUP_FILE_PATH_RE.test(entry.archivePath) || entry.archivePath !== archivePathFor(entry.mediaId, entry.name)) {
      problems.push(`${entry.mediaId}: плохой archivePath ${entry.archivePath}`);
      continue;
    }
    const data = byPath.get(entry.archivePath);
    if (!data) {
      problems.push(`${entry.mediaId}: файл отсутствует в пакете (${entry.archivePath})`);
      continue;
    }
    total += data.length;
    if (total > BACKUP_MAX_UNCOMPRESSED_BYTES) {
      throw new Error(`BACKUP_TOO_LARGE: распакованный размер превышает ${BACKUP_MAX_UNCOMPRESSED_BYTES} байт`);
    }
    if (data.length !== entry.bytes) problems.push(`${entry.mediaId}: размер ${data.length} ≠ manifest ${entry.bytes}`);
    if (!SHA256_RE.test(entry.sha256)) {
      problems.push(`${entry.mediaId}: плохой sha256 в manifest`);
      continue;
    }
    const actual = await sha256Hex(data);
    if (actual !== entry.sha256) problems.push(`${entry.mediaId}: sha256 не сошёлся`);
    else files.set(entry.mediaId, data);
  }
  // Лишние файлы вне manifest — отказ (строгий пакет, без сюрпризов).
  for (const e of entries) {
    if (e.name === 'manifest.json' || e.name === 'workspace.json') continue;
    if (!BACKUP_FILE_PATH_RE.test(e.name)) problems.push(`неожиданный путь в пакете: ${e.name}`);
    else if (!manifest.files.some((f) => f.archivePath === e.name)) problems.push(`файл вне manifest: ${e.name}`);
  }
  if (problems.length > 0) throw new Error(`BACKUP_INVALID_FILES: ${problems.join('; ')}`);
  const rawWorkspace = parseJsonEntry(entries, 'workspace.json');
  if (!isRecord(rawWorkspace)) throw new Error('BACKUP_CORRUPT: workspace.json — не объект');
  const workspace = rawWorkspace as unknown as AppState;
  if (!Array.isArray(workspace.complexes) || !Array.isArray(workspace.ads) || !Array.isArray(workspace.media)) {
    throw new Error('BACKUP_CORRUPT: workspace.json без complexes/ads/media');
  }
  const schemaVersion = workspace.schemaVersion ?? 2;
  if (schemaVersion > 3) throw new Error(`BACKUP_FUTURE_SCHEMA: schemaVersion ${schemaVersion} не поддерживается`);
  // Ссылки: каждое media workspace — в пакете; evidence.mediaIds/adId — в workspace.
  const missingMedia = workspace.media.filter((m) => !files.has(m.id)).map((m) => m.id);
  if (missingMedia.length > 0) throw new Error(`BACKUP_MISSING_FILES: media без байтов: ${missingMedia.join(', ')}`);
  const mediaIds = new Set(workspace.media.map((m) => m.id));
  const adIds = new Set(workspace.ads.map((a) => a.id));
  const linkProblems: string[] = [];
  for (const z of workspace.complexes) {
    for (const f of z.factors ?? []) {
      const ev = f.evidence;
      if (ev?.adId && !adIds.has(ev.adId)) linkProblems.push(`${z.id}:${f.code} ссылается на отсутствующую публикацию ${ev.adId}`);
      for (const mid of ev?.mediaIds ?? []) {
        if (!mediaIds.has(mid)) linkProblems.push(`${z.id}:${f.code} ссылается на отсутствующий файл ${mid}`);
      }
    }
  }
  if (linkProblems.length > 0) throw new Error(`BACKUP_BAD_LINKS: ${linkProblems.join('; ')}`);
  return { manifest, workspace, files };
}

/* ---------- преобразования импорта (документированная таблица C3) ---------- */

/** Предпросмотр заранее показывает эти преобразования (S2.5). */
export function previewRestore(state: AppState): RestorePreview {
  const confirmedToVerify = state.complexes.flatMap((z) =>
    (z.factors ?? []).filter((f) => f.status === 'confirmed').map((f) => ({ zkId: z.id, code: f.code })),
  );
  const signalsToDraft = Object.entries(state.signals ?? {})
    .filter(([, s]) => s.status !== 'draft')
    .map(([zkId]) => zkId);
  return {
    confirmedToVerify,
    signalsToDraft,
    mediaCount: state.media.length,
    fileBytes: 0,
    auditNote:
      `Импорт: ${confirmedToVerify.length} активных confirmed → needs-verification, ` +
      `${signalsToDraft.length} сигналов → draft, история помечается imported. ` +
      `Receipts/квоты/авторизация не импортируются. Поддельные confirmed баллов не дают: ` +
      `очки начисляются только после нового серверного confirm.`,
  };
}

/**
 * Цель restore — пустое отдельное workspace, никакого merge: замена целиком.
 * Пустым считается workspace без пользовательских данных: нет публикаций,
 * файлов и audit-событий, нет подтверждённых/возвращённых сигналов.
 * Seed-комплексы (без решений) пустоту не нарушают — они заменяются целиком.
 */
export function isRestoreTargetEmpty(state: AppState): boolean {
  if (state.ads.length > 0 || state.media.length > 0 || state.audit.length > 0) return false;
  return !Object.values(state.signals ?? {}).some((s) => s.status !== 'draft');
}

/**
 * Применить документированные преобразования импорта. IDs/связи/тексты/
 * источники сохраняются; меняются только статусы и provenance. Возвращает
 * новое состояние (вход не мутируется).
 */
export function applyImportTransform(state: AppState, importer: string): AppState {
  const next = structuredClone(state) as AppState & Record<string, unknown>;
  // Receipts/квоты/авторизация из архива не импортируются — чужие ключи отбросить.
  for (const key of ['command_receipts', 'commandReceipts', 'ai_usage', 'aiUsage', 'auth', 'quotas']) {
    delete next[key];
  }
  const preview = previewRestore(state);
  for (const z of next.complexes as AppState['complexes']) {
    z.origin = 'imported';
    z.factors = (z.factors ?? []).map((f) =>
      f.status === 'confirmed' ? { ...f, status: 'needs-verification' as const } : f,
    );
  }
  for (const key of Object.keys(next.signals as AppState['signals'] ?? {})) {
    const s = (next.signals as AppState['signals'])[key];
    if (s.status !== 'draft') (next.signals as AppState['signals'])[key] = { ...s, status: 'draft' };
  }
  next.audit = (next.audit as AppState['audit']).map((e) => ({
    ...e,
    details: isRecord(e.details) ? { ...e.details, origin: 'imported' } : { previous: e.details ?? null, origin: 'imported' },
  }));
  const at = new Date().toISOString();
  (next.audit as AppState['audit']).unshift({
    id: `import-${at}`,
    commandId: `import-${at}`,
    zkId: (next.complexes as AppState['complexes'])[0]?.id ?? 'import',
    actorId: importer,
    at,
    reviewer: importer,
    action: 'import',
    comment:
      `Импорт backup (${preview.confirmedToVerify.length} confirmed → needs-verification, ` +
      `${preview.signalsToDraft.length} сигналов → draft, ${(next.complexes as AppState['complexes']).length} объектов, ` +
      `${(next.media as AppState['media']).length} файлов). Исходная атрибуция сохранена как provenance, ` +
      `серверных действий старого автора не выдаётся.`,
    details: { origin: 'imported', importedBy: importer, preview },
  });
  next.schemaVersion = 3;
  return next as AppState;
}
