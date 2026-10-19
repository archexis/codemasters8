# S5 — журнал пакетов

- S5.1: TS/SQL требуют draft перед новым решением, явный пересмотр с причиной; receipt replay не добавляет revision. Draft хранит basedOnRevision и reason. Red reproducer: red.log; SQL/TS targeted: signal-unit.log. Экран Signal выбирает revision/direct query и единый frozen model; редактирование исторической revision отсутствует.
- S5.2: новые версии содержат полные ads, snapshot объекта, относящиеся media manifests, последние использованные решения и доверенный server AI provider/model/prompt/hash/reason. Экспорт выбранной revision читает только snapshot. Старые версии без ads честно incomplete. Проверки: signal-s5, signal-history, ai-provenance-sql; connected.json v1 byte-equivalent после снятия R2 и возврата. Исправлен соседний дефект seedState: explicit legal-review терялся при адаптации DEMO.
- S5.3: ID/revision/sourceVersion/автор/время/comment, объект/legal review, веса/score/zone, полные quote/publications/dates/capture/material IDs/provenance и disclaimer. Browser PDFs 3 fixtures и дополнительный connected PDF. Убрана live-история под историческим сигналом; print разрешает перенос больших блоков и URL.
- S5.4: connected synthetic новый объект с реальной legal review записью (содержание явно synthetic), настоящим AI и human decisions →70/red→v1→PDF/reload→R2 rejected→45/yellow→историческая v1 70/red→returned/reload/direct/mobile. Дополнительная R2 rejected ветка использует authenticated fixture только в одноразовой PGlite, score0, confirmation denied. Ordinary Analyze dedupe regression desktop/mobile проверяет retained ad ID для второго решения.

Неудачные прогоны сохранены: red.log, unit-first.log, unit-target.log, e2e-first-failed.log, e2e-second-failed.log, connected-first/second/third-failed.log. Причины: ожидаемые отсутствующие snapshot/transitions, Svelte proxy clone, kind потерянный DEMO adapter, exact selector и неоднозначный SQL status. Expectations не ослаблены; skip/only не добавлены.

AI бюджет: первые две неудачные connected попытки сделали по одному inference и потеряли test account при прежнем cleanup. Третий новый кейс сделал ровно один inference; после SQL ошибки был продолжен с тем же retained account/run, без повторного inference. Всего 3 provider вызова на три synthetic case попытки; это не 12-case eval повтор. Успешный case runId/input metadata и provider provenance — connected.json. Временный аккаунт удалён после PASS, production не затронут.

Локальная БД: backup .temp/s5-before.dump до migration up --local. Новая migration создана CLI; timestamp перенесён после зависимостей S4 из-за host clock. Затем заменены только её функции через psql для итераций, без reset/DML пользовательских workspace. Применённый итог совпадает с migration source. Чужой 5174 не трогался.

## Parent review revision-routing fix

Both negative reproducers repaired. See [fix report](../s5-review-fix/README.md): invalid/missing revisions recover without live fallback or render crash; targeted unit24/browser34, full unit305/E2E82, parent2 PASS, check/build PASS, fresh gates0–5 PASS. AI code/prompt/schema unchanged; no new paid inference. Historical acceptance archived; S6 not started.
