# S6 — BLOCKED только публикация candidate

Закрыты S6.1/S6.2/S6.3 и локальная S6.5; D6.1/D6.2/D6.3/D6.5 PASS. D6.4 BLOCKED: candidate ещё не опубликован. [Полный журнал](s6/README.md), [машинный отчёт](sprint-6.json), [candidate](s6/candidate.json).

Финальные T/U308/B/E92/C1/A9/F3+types/L7 PASS; supplementary keyboard/tiles E/T отдельно. Clean-room DEMO20+connected7, fresh/upgrade PostgreSQL, restore bytes SHA256 PASS. AI12 retained with unchanged input hashes. Ошибки окружения и отклонённая очистка описаны отдельно; они не скрыты за PASS.

Готово локально; публикация/production deploy/отправка заявки не выполнялись. Следующий шаг — независимая проверка исходного чата, затем решение пользователя о публикации конкретного SHA.

Локальный candidate: f1494e2a166b7a4f53fd35dffb749b011066fbbe. Анонимный GitHub API: repo200, candidate422 (не опубликован). Gate6 exit1, только D6.4/publication BLOCKED. Команда для рассмотрения пользователем: git push origin f1494e2a166b7a4f53fd35dffb749b011066fbbe:refs/heads/codex/s6-release-candidate. Не выполнена.

