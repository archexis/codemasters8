# UX architecture transition — implementation record

Date: 19 October 2026. Baseline commit: `29c4e754eaeeee949b73cf711abf7dddea585bb5`.

The target remains `docs/UI-UX-FRESH+NEW-FUNC/README.md` and documents 00–10. This record describes implemented code and reproducible checks, and does not replace the target or historical S0–S6 acceptance.

## Implemented paths

- `#/map`, `#/publications`, `#/registries` are the three global destinations. The account panel contains backup and authentication.
- `#/complexes/:id?phase=:phaseId&tab=overview|verification|relations|timeline&evidence=:artifactId` uses one dossier layout. `#/cases/:caseId?tab=...` uses the same layout and adds the investigation toolbar. Existing object links resolve to the dossier.
- The original owner-scoped `apply_command` boundary supports phases, immutable source artifacts, extracted claims, AI triage, fact reviews inside an active case, material links, decisions and reopening. AI triage does not award points. Each new case begins with its own assertions; legacy confirmed factors are not silently adopted.
- Phase legal bases and engineering observations are independent. Readiness requires sourced, dated claimed/measured values; measured observations are append-only. Changing phase observations appends a renewed-review requirement for R5 and preserves previous signal versions. A phase without its own observations never inherits whole-complex readiness. Unknown legal basis is neutral and never awards R1.
- Optional inclusive applicability periods are persisted on phases, claims, cases, reviewed assertions, legal bases and signal snapshots. Known case periods require covering claim periods; known phase bounds constrain cases and claims. R1 requires legal-review coverage for the selected period; dated R3 evidence must fall within it. Legacy records without periods remain readable, with an explicit limitation rather than an invented applicability date.
- Decisions freeze the complex, phase, checked assertions, source artifacts, publications and file manifests. Reopening and restoring require renewed verification; old decisions remain available.
- MapLibre has 2D/2.5D, three X-Ray themes, a floating preview, saved view state, a bounded footprint layer and an independent DOM-tile 2D fallback. Verified GeoJSON footprints can be imported with source and optional measured height. In 2.5D, points are replaced with display-only boxes; measured contours/heights take priority. Missing contours use a 60 × 44 m schematic footprint at the recorded coordinates, and unknown height is displayed as a clearly labelled 36 m placeholder. These shapes never become verified survey data.
- Publications support manual saving without AI, the existing authenticated live AI extraction, independent hypothesis triage, original inspection, combined filters and pagination. Model failure leaves manual work available.
- Registries include complexes, organizations derived from existing identifiers, documents and sources. Documents preserve originals; authenticated PDF parsing returns candidates and page numbers for review.
- Relations provide a bounded graph and a list with source references. Typed relationships persist against canonical complex, phase, BIN, publication, document and advertising-account identifiers. Registration creates a candidate; a separate human review requires scoped original materials and records actor, time and comment. Account/name matches remain candidates until reviewed. Related records are frozen in case snapshots; importing verified relations requires renewed review. Adding context to a case never awards risk points.
- Timeline separates event dates from capture dates, supports filtering/pagination and image selection. Comparison uses large side-by-side views and does not invent a readiness percentage or pixel difference.
- FastAPI preserves `/health`, `/api/summary`, `/api/export`; adds authenticated read projections, versioned PDF export and document processing. SQL additions are new migrations; historical migrations are unchanged.

## Validation and artifacts

Run:

```sh
npm run check
npm test
npm run build
npx playwright test tests/e2e/ux-target.spec.ts tests/e2e/ux-geometry.spec.ts tests/e2e/ux-review.spec.ts tests/e2e/ux-performance.spec.ts
backend/.venv/Scripts/python.exe -m pytest backend/tests -q
```

Target UX browser tests cover desktop and mobile, WebGL failure, map preview/dossier navigation, original publication inspection, independent case decisions, persistence after reload and the new-material → R2 → frozen signal path.

`docs/acceptance/ux/performance-*.json` records the measured dataset, host, timings and limitations. Screenshots are under `docs/acceptance/ux/screenshots/`. These files are observations from the current test run, not a guarantee of performance on the reference machine.

The historical E2E suite contains assertions about replaced screens and direct factor confirmation in Analyze. Passing new UX tests must not be described as a fresh pass of that historical suite.

## Remaining acceptance and architecture work

- The browser still uses the compatible workspace loader and local read adapters. Authenticated bounded read endpoints exist, but switching every screen to remote cursor/view loading is not complete. Server reads still derive from the owner-scoped JSONB workspace.
- Periods and phase observations are supported by commands and snapshots. Automatic reconciliation of overlapping legal documents, authoritative period extraction and integration with an official coverage registry remain future work. Unknown coverage is shown explicitly; it never establishes R1.
- Organizations still derive from existing source identifiers; a complete independent organization catalogue and automated reconciliation against authoritative role registries remain future work. Typed relationship records and their explicit review are persisted.
- Image previews use the existing private-media viewer. A thumbnail pipeline, validated image registration/pixel-diff and saved comparable-camera metadata are not complete. Side-by-side comparison remains available.
- The live model was not re-certified on new input in this run. Provider credentials and an authenticated running Supabase/Edge environment are required; DEMO continues to identify the local parser explicitly.
- Local Docker was unavailable during development. PGlite/API/browser checks do not replace a live migration, RLS/Storage/Edge integration run or deployment validation.
- The D1 sanity dataset includes 100 complexes, 1,000 publications and 10,000 events, with synthetic basemap tiles. The required 5–10 MB image cache, sustained map FPS, GPU resource cleanup, reference-device D1 and the complete D3 profile require additional measurements.
- The historical E2E acceptance suite and release gates must be migrated/re-run against the final candidate before declaring the full plan complete.

No production database migration, deployment, push, submission or external message is part of these local changes.
