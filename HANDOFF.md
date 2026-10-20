# HANDOFF — audit fixes 74e58aa..1d1bfa2: prove nothing broke

Date: 2026-10-20. Branch: main. Range pushed to origin/main.
Goal of this file: let the NEXT agent verify every claim below with exact
commands and expected outputs. If any check deviates, stop and investigate —
do not push.

## 1. What changed (each commit is an independent rollback unit)

```
git log --oneline 74e58aa..1d1bfa2   # expect the 10 below, oldest first
24f57cb fix(backend): worker logging, timeline guards, ocr tempdir scope, queue lock
20feab8 feat(api): limited body reader with pre-check, pdf magic sniff, security headers
cf34fa7 refactor(frontend): single scoring canon with parity test, storage keys catalog, grounding predicates
d9a3d2c chore(ci-docs): lint configs, timeouts-concurrency-backend-lint, docs canon freeze, portable paths
27da3b7 feat(security,e2e): HSTS + CSP report-only on edge and api; playwright retries + shard support
70b2e68 feat(api): wire generous rate limit 300/min on heavy GET projections with Retry-After
03c7161 chore(lint): ruff clean on backend/app; CI scoped to app
9630b63 feat(tests): coverage reporting (vitest v8 + pytest-cov in CI, no gates)
351c52c chore(lint): zero-error eslint; any-as-warn with cap 160 in CI
1d1bfa2 docs(tools,ci): tools README; manual live jobs documented
```

Rollback of one unit (example): `git revert --no-commit 70b2e68 && git commit -m "revert: rate limit"`.
Full rollback: `git revert --no-commit 74e58aa..1d1bfa2` (reverse order) or
`git reset --hard 74e58aa` (local only, then force-push only if coordinated).

## 2. Verification matrix (run in C:/Users/BIGra/codemasters8)

| # | Command | Expected | Notes |
| - | ------- | -------- | ----- |
| 1 | `C:/Users/BIGra/AppData/Local/Programs/Python/Python310/python.exe -m pytest backend/tests -q --tb=no -p no:warnings` | `5 failed, 42 passed` — SAME as pristine `74e58aa` | The 5 are pre-existing, see §3 |
| 2 | `npx tsc --noEmit` | empty output | |
| 3 | `npx eslint .` | `0 errors`, `154 warnings` (all `@typescript-eslint/no-explicit-any`) | `npm run lint` enforces `--max-warnings=160` |
| 4 | `C:/Users/BIGra/AppData/Local/Programs/Python/Python310/python.exe -m ruff check backend/app` | `All checks passed!` | needs `pip install ruff`; CI installs it |
| 5 | `npx vitest run` | `Test Files 38 passed (38)`, `Tests 400 passed (400)` (~70-150s) | PGlite/WASM per file, maxWorkers 1 |
| 6 | `npx vitest run tests/unit/scoring-parity.test.ts` | `13 passed` | guards WEIGHTS parity TS vs SQL |
| 7 | `python -c "import json; json.load(open('vercel.json'))"` | `VERCEL_JSON_OK` (print it) | |
| 8 | `git status --porcelain` | empty (after this file is committed) | |

Baseline proof for #1: `git stash push`, run pytest (expect same 5/42),
`git stash pop`. Done twice during this work; both matched.

## 3. Pre-existing failures (NOT caused by this range, fail on 74e58aa too)

- `test_document_jobs.py::test_worker_success_persists_only_extraction_candidate`
  + 3x `test_investigation_api.py` (pdf/snapshot tests):
  `ModuleNotFoundError: No module named 'reportlab'` — local Python 3.10 env
  lacks it. CI installs `backend/requirements.lock.txt` (pins
  `reportlab==4.4.3`), so CI is expected green. Local fix if needed:
  `Python310/python.exe -m pip install reportlab==4.4.3` (env-only, no repo change).
- `test_research.py::test_worker_prepares_candidates_without_browser_and_recovers_provider_failure`:
  `assert 'failed' == 'succeeded'` + logged `AttributeError` in
  `research_worker/collect_sources`. Real pre-existing bug, out of scope here.

## 4. Environment traps (read before running anything)

- `python`/`python3` on PATH are 3.14 WITHOUT pytest/fastapi. The working
  backend env is `C:/Users/BIGra/AppData/Local/Programs/Python/Python310/python.exe`
  (has fastapi/pytest/httpx/pypdf/pytest-cov/ruff-after-§5-install; NO reportlab).
  `pip` maps to yet another Python 3.10 — always use `Python310/python.exe -m`.
- CI uses Python 3.12 + `backend/requirements.lock.txt`. Keep code 3.10-compatible:
  `datetime.UTC` (3.11+) is banned via ruff ignores UP017/UP035 — use `timezone.utc`.
- Repo files are CRLF; git prints `LF will be replaced by CRLF` warnings — normal.
- `ruff format` is deliberately NOT enforced: it would rewrite 2000+ lines
  (quotes/CRLF). New backend files should still be `ruff format`-clean by hand.
- `npx tsc --noEmit` full-project only; per-file tsc gives false errors.
- Full `npx vitest run` in background exceeds the 600s foreground cap; it was
  run twice, ~70s each, green both times.
- `node tools/check-sprint-gate.mjs` without args prints usage — not a failure.

## 5. Deliberately NOT done (accepted risk, with reason)

- S2 residue: `media_path_referenced()` snapshot branch uses substring match.
  Exact match already guards `media` rows and evidence links; mediaManifest
  mirrors media rows. Worst case is a blocked delete of your own file, never
  a leak. Changing the policy blind (no live DB here) was riskier than leaving it.
- S6 storage-level magic bytes: buckets cannot sniff content. Covered by design:
  FastAPI sniffs every linked PDF (`is_pdf_bytes`), and direct storage uploads
  cannot become evidence without a media row (`MEDIA_NOT_FOUND` server check).
- Rate limiter is in-memory per process (300/min/IP+token, generous so the
  backend suite's ~56 GETs and dossier polling stay green). Exact enforcement
  needs a shared Redis counter — see TODO in `backend/app/rate_limit.py`.
- No coverage gates yet (reporting only), `any` as warn (cap 160),
  eslint skips `**/*.svelte` (Svelte 5 runes processor is a follow-up;
  `svelte-check` covers types), `tests/unit/backup.test.ts` keeps its own
  PGlite bootstrap (custom KNOWN_WIP_SKIP list).
- `verify-all` live jobs (`test:live`, `test:deepseek`, `test:local`, `gate`)
  need secrets/stands — documented in `ci.yml` header, run manually.

## 6. Review trail

- 4 parallel audit agents (backend/frontend/arch+security/tests+CI), then
  4 parallel fix agents; full transcripts:
  `C:\Users\BIGra\AppData\Local\hermes\cache\delegation\live\deleg_2ba367e4\task-{0..3}.log`
  `C:\Users\BIGra\AppData\Local\hermes\cache\delegation\live\deleg_21271b29\task-{0..3}.log`
- Caught during review: ruff `--fix` UP035 broke Python 3.10 compat
  (`datetime.UTC` import) — reverted + ignore with reason; ocr subprocess ran
  after its TemporaryDirectory was deleted — fixed to run inside.
