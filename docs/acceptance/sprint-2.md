# S2 — приёмка: PASS

Пакеты S2.1–S2.6 PASS. Проверки: `npm run check` 0 errors, `npm test`
201 passed (14 файлов), `npm run build` ok, E2E evidence-failures 12/12
(chromium+mobile, включая две DEMO-вкладки Web Locks), live
backup-isolation 3/3 (изоляция, expiry TTL, restore SHA256 + fake 0)
на локальном Supabase docker после `supabase db reset`.

Стыки: (1) S1→S2 FIXED и в DEMO (v3-конверт initialState/repository);
(2) null-date + runId/hypothesisId + миграция legacy — DONE (S2.1);
(3) backup/restore с analysis_runs-заделом и origin=imported — DONE (S2.5);
(4) dedupe zkId+canonicalText + sightings[] + undated+dated — DONE;
(5) signal-snapshot TS+SQL + legacyIncomplete + replay — DONE (S2.4).
Контракты C2/C3/C4/C5/C6 обновлены под решения.

Регистрация убрана: DEMO по умолчанию без логина, вход только
по выданной учётной записи; login-wall удалён; BackupPanel на #/backup.

Регрессия S0/S1 перепроверена (gates 0/1 exit 0 после refresh манифестов).
Следующий пакет: S3.1.
