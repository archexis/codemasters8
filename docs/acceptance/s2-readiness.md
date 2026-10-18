# S2 readiness (анализ 2026-10-18, read-only, проверки не запускались)

Порядок S2.1→S2.6 из S2.md подтверждён, менять нечего: версии → receipts →
атомарность файлов → история → backup → изоляция. Каждый следующий опирается
на предыдущий (receipts нужны fault-тестам; снимки бессмысленны без целых
байтов; backup — без миграций/снимков).

Критичные конфликты C2/C3 с текущим кодом:
1. AppState без schemaVersion/signalVersions; AuditEvent без
   commandId/before/after/snapshot (types.ts).
2. Старая сигнатура apply_command(command, expected_version) — обход; нужна
   command_id + таблица command_receipts, receipt-lookup ДО stale-check.
3. Repository: module-level version, commit без очереди/retry; поздний ответ
   старого пользователя перезапишет новый workspace (App.svelte).
4. Analyze: commit(ad) ДО uploadFile + saved=true до файла — инвертировать;
   новый UUID при каждом upload ломает retry (нужны прежние IDs).
5. Media без bytes/sha256; SQL верит клиентскому path; DELETE policy позволяет
   удалить файл, на который ссылаются evidence/snapshot; удаление в catch
   запрещено при timeout-unknown.
6. Export API называть «экспортом данных», не backup.

Риски по пакетам: S2.1 — молчаливый сброс битых данных в loadState, legacy v1
не парсится; S2.2 — канонический JSONB для payload (порядок ключей), перестановка
receipt/stale ломает STALE-тесты; S2.3 — разорванная двухкомандная запись;
S2.4 — snapshot только минимум (не structuredClone всего Complex),
отклонённая команда не должна сбрасывать в draft; S2.5 — preview не валидация,
поддельный confirmed только через needs-verification в SQL; S2.6 — проверка
ссылок в policy хрупкая, signed-URL expiry флапает через кэш, DEMO-изоляция
только логическая.

Переиспользовать из S1: normalizeSeedComplex/Ads, isCalendarDate, ID_RE,
LEGAL_BASIS_PAIRS, словарь кодов ошибок, audit «Авто-отзыв», bucket evidence.
S1.5-конфликт (strict-схемы vs Analyze reason) задевает S2.1: новые поля S2
(bytes/sha256) не должны ломать загрузку старых workspace.
