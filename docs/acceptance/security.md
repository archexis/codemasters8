# S6 security matrix

Результат приёмки определяется final-L.log, final-U.log, final-F.log и sprint-6.json. Mock transport и настоящие сервисы ниже различены; mock не засчитывается за live inference.

| Actor/action | Проверка и свидетельство |
|---|---|
| Anonymous read/write/RPC/AI/download/API export | tests/live/security.spec.ts: реальные Auth/PostgREST/Storage/Edge/FastAPI, no rows/401/denied; backup-isolation.spec.ts |
| B → A workspace/zk/media/run ID | реальные чужие owner/path/private zk/run, RLS empty/403; ai-provenance-sql.test.ts проверяет foreign run link |
| A direct update workspace/audit; old RPC | real UPDATE version/data.audit/owner denied; old overload absent; database/idempotency SQL |
| Forged actor/reviewer/time | reviewer rejected; событие найдено по конкретному commandId, reviewer равен Auth email, время между отправкой и ответом; actor/time не дают полномочий |
| Referenced delete vs staged cleanup | actual media → confirmed R2 evidence.mediaIds → signal snapshot manifest id/path → delete сохраняет bytes; отдельный unreferenced staged файл удаляется |
| XSS/unsafe URL | s6-ux.spec.ts HTML/script в text/comment отображаются как строки, window sentinel отсутствует; domain.test.ts safeUrl и SQL/domain validation не допускают unsafe material links |
| MIME, >20 MiB, чужой owner path | actual Storage отказывает; browser F1/F2 не сохраняет публикацию/решение; MIME — заявленный тип, не magic-byte antivirus |
| Body bytes / text chars / quota | actual Edge: кириллица 60000 chars >100000 bytes →413; 20001 chars →422; 30 quota RPC, следующий analyze →429, failed journal; provider не вызывается после quota отказа по handler transport unit |
| Invalid/expired JWT API/Edge/RPC | реальные invalid и правильно подписанный expired local JWT →401; browser 401 fixture проверяет отсутствие потери формы |
| Timeout | реальный handler с controlled hanging provider transport →504, failed/pending replay без regex-success; сеть/DB недоступны → отдельные 503. Не симулируется live provider timeout путём платных зависаний |
| Logout/login + in-flight | red→green connected-regressions unit для late load/save; ai-review browser для late AI, session cancel; sessionGeneration до возврата/версии. UI очищает прошлое workspace при смене владельца, refresh той же учётки сохраняет форму |
| Offline/errors/no Web Locks | real browser offline сохраняет form values; Web Locks unavailable → write denied/read/export доступны; s6-locks regression + locks-red.log |

## Секреты

`tools/s6-secrets.mjs`: tracked+untracked nonignored scope, dist, все blobs доступной Git history; точные текущие server/provider bytes, ограниченные provider/secret key patterns и JWT role=service_role. Вывод — только path/type/presence. Обычные publishable/anon JWT не считаются server secret. Неизвестные форматы/внешние secret stores этот scan не аттестует.

`browser-secrets.json`: после реального connected login, refresh, offline и 401 — request URL/headers/body, localStorage/sessionStorage. Пользовательские session JWT в браузере необходимы и не являются service_role. Provider/writer bytes отсутствуют. Исходные env/status остаются игнорируемыми. Если scanner обнаружит действующий server secret в истории, сдача блокируется до отзыва/замены; удаление файла не является ротацией.

`npm-audit.json`: актуальный audit, 0 vulnerabilities всех severity; reachable findings нет. Массового обновления зависимостей не делалось.

## Границы

Локальная среда и synthetic данные. PGlite и одноразовые PostgreSQL БД используют тестовые auth/storage schemas; L использует настоящий Supabase. Production, внешний cloud, юридическая истинность synthetic материала и антивирусная проверка файлов не заявлены. Требования дополнительных модулей §11 остаются out-of-scope.
