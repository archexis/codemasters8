/**
 * Каталог ключей локальных хранилищ (localStorage / IndexedDB).
 *
 * Все строковые ключи workspace — только здесь: e2e-спеки и SQL-миграции
 * опираются на точные значения, поэтому ПЕРЕИМЕНОВАНИЕ КОНСТАНТ допустимо,
 * а СМЕНА ЗНАЧЕНИЙ — нет (молчаливый сброс workspace у пользователей).
 * Значения заморожены: новый ключ = новая константа со стабильным именем.
 */

/** DEMO-конверт workspace (state/version/receipts — одно значение). */
export const WORKSPACE_KEY = 'sq_svelte_demo_v2';

/** Намерение commit, сохранённое ДО отправки (повтор тем же ID после reload). */
export const PENDING_COMMAND_KEY = 'sq_pending_command_v1';

/** Staged-файлы commandId → paths (область будущей cleanup). */
export const STAGED_FILES_KEY = 'sq_staged_files_v1';

/** Очередь повтора очистки файлов (cleanup не удался — повторить позже). */
export const CLEANUP_RETRY_KEY = 'sq_cleanup_retry_v1';

/** Последний auth-пользователь сессии (защита от чужой сессии). */
export const SESSION_USER_KEY = 'sq_session_user_v1';

/** Web Lock мьютекса записи DEMO-конверта между вкладками. */
export const DEMO_LOCK_NAME = 'sq-demo-envelope-v1';

/** Таймаут ожидания Web Lock DEMO-конверта, мс. */
export const DEMO_LOCK_TIMEOUT_MS = 10000;

/** IndexedDB DEMO-байтов доказательств. */
export const DEMO_DB_NAME = 'sq-demo-evidence';

/** ObjectStore байтов в DEMO_DB_NAME. */
export const DEMO_DB_STORE = 'files';

/** Слепок конверта до авторемонта demo-артефактов (разбор споров). */
export const DEMO_ARTIFACT_REPAIR_BACKUP_KEY = 'sq_demo_before_artifact_repair_20261020';

/** Слепок конверта до автообновления retired demo-публикаций. */
export const DEMO_PUBLICATION_REFRESH_BACKUP_KEY = 'sq_demo_before_publication_refresh_20261020';
