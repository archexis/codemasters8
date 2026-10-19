# S6 — локальная приёмка

S6.1 security, S6.2 UX, S6.3 clean-room и локальные проверки S6.5 выполнены. S6.4/D6.4 остаётся BLOCKED только по доступности нового candidate SHA адресату. Production deploy, push и отправка заявки не выполнялись.

## Исправленные дефекты

- Late load A после login B возвращал workspace A: session-red → green; generation guard до изменения version/возврата данных. In-flight save и initialize также проверяют сессию. Реальный браузер с удержанным ответом A подтверждает отсутствие данных A после B login.
- DEMO без Web Locks разрешал запись вопреки C2: locks-red → write denied, чтение/экспорт остаются.
- Refresh JWT той же учётки включал loading-screen и терял форму: final-L первого прогона воспроизвёл; TOKEN_REFRESHED той же учётки не размонтирует форму. Повтор L PASS.

Новые product-правки ограничены App.svelte/repository.ts. Остальной candidate включает ранее реализованные и проверенные S4/S5 dirty файлы, без redesign. Исторические отчёты сохраняются.

## Фактические проверки

Финальный последовательный runner tools/s6-profiles.mjs: T 0 diagnostics, U308/308, B PASS, E92/92 desktop/mobile, C1/1 mock HTTP, A9/9, F3/3 + Deno types, L7/7 real local Auth/RPC/Storage/API/Edge/browser. profiles.json содержит command/exit/start/end и точный source byte manifest каждого профиля. После него изменён только UX test: усилен полностью keyboard path и отказ tiles; ux-supplement.log/check-supplement.log — отдельные E/T, product code не менялся.

AI: ai-input-binding.json подтверждает неизменность handler/prompt/schema/canonical input/review contracts относительно принятого S5. Сохранены реальные 12-case eval и synthetic connected S5 investigation; новых платных inference в S6 нет. Browser transport fixtures не объявляются live AI.

Security matrix: ../security.md; secrets.json (working tracked/untracked + dist + 558 history blobs, known bytes + key patterns/JWT service_role), browser-secrets.json (real login/refresh/offline, requests/storage), npm-audit.json (0 vulnerabilities). Отрицательные SQL/RPC не меняют workspace; actual referenced snapshot file сохраняется после DELETE, own staged удаляется. Session/JWT/bytes/chars/quota, unsafe URLs/XSS/MIME/20MiB проверены. Таймаут provider проверен controlled transport, не платным live зависанием.

Clean room: .temp/s6-rc-1792346711014, initial npm ci и locked Python install; затем полный свежий source manifest без .env/dependencies/generated копирования. clean-runtime.json: T/B, pip check/A, 20 DEMO и 7 connected PASS из этой копии. Connected создаёт private synthetic новый case в отдельном временном аккаунте и восстанавливает backup в третье пустое workspace со сверкой SHA256 байтов; рабочая БД не reset. PostgreSQL fresh + legacy upgrade: две отдельные одноразовые БД, все16 migrations, удалены после проверки; postgres.json. Auth/storage bootstrap там тестовый, реальные сервисы покрывает L.

README, .env.example, RELEASE_RUNBOOK описывают trusted writer env, limits, unknown policy, backup/migrations/rollback. Runtime фактически Node24.18.0/npm11.16.0/Python3.11.0.

## Материалы и границы

DEMO_SCRIPT.md и demo/ показывают тот же synthetic S5-f1827716: карточка → публикация → v1 70/red → returned45/yellow. Screens явно REPLAY; исторический PDF этого же case — ../s5/pdf/connected.pdf (2 PNG pages). Визуально проверена читаемость v1 screenshot, ID/revision/score/quotes/provenance присутствуют. PDF S5 принят ранее; его повторный inference/рендер не требовался. Requirements-results.json содержит каждую строку mapping; §11 out-of-scope.

Неуспешные OOM/PGlite/ENOSPC, test harness corrections, автоматические отказы очистки и ошибочные эквивалентные обнуления documented environment-incidents.md. Удаление/обнуление после указания исходного чата прекращено. Рабочие данные и чужие dirty изменения сохранены.

Candidate создаётся только explicit path list; .agents/skills, skills-lock.json и docs/UI-UX-FRESH+NEW-FUNC не включаются. Candidate SHA, anonymous repository/commit checks, staged/dirty состояние и точная команда публикации — candidate.json. Репозиторий публичен, но это не доказывает доступность нового SHA. Gate6 обязан вернуть ненулевой exit до публикации; результат gate6.log. Полный diff и отчёт готовы для независимого родительского review.

Supplement: UX initial7/8 (navigation timeout), targeted WebGL1/1 PASS; stronger keyboard/tiles desktop+mobile4/4 PASS in clean-room. check-supplement0 diagnostics. Final source profile drift only this test, bound by SHA256 in reports. Staged secret pattern/JWT scan358 files PASS; exact current keys+history scan497 files PASS. Diff whitespace notes are historical log formatting/CRLF and pre-existing app.css trailing space; new S6 product/test lines pass cr-at-eol diff check.

