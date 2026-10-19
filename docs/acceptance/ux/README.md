# UX implementation acceptance — 19 October 2026

## Final verification

- Full `npm test`: **341 tests passed**, 29 files (latest run after applicability, phase readiness, typed relations and legacy confirmation gates).
- `python -m pytest backend/tests -q`: **19 passed**; one dependency deprecation warning from the FastAPI test client.
- Combined target browser run: **24/26 passed** initially; two relation tests failed on an ambiguous test locator. After correcting the locator to match its label prefix, the same desktop/mobile relation tests passed **2/2**. All 26 scenarios have therefore passed; the relation correction changes only test selection, not application behavior.
- `ux-review.spec.ts` adds AI triage with unchanged risk, persisted publication filters, scope protection for forged phase query parameters, explicit contextual relation review without points, and dated case snapshots.
- Historical E2E tests about replaced screens have not been re-certified as passing; this record does not claim a fresh pass of the historical 92-test suite.

## Executed checks

- `npm run check`: zero errors and warnings.
- `npm run build`: passes, including a separately emitted MapLibre worker. Raster source failure does not block marker sources; startup/context-loss fallback retains 2D navigation.
- `npx vitest run tests/unit/map-model.test.ts --reporter=verbose`: 8 passing tests for legal uncertainty, readiness provenance, missing publication data, coordinate/footprint validation, bounded verified geolocated relations and Mercator fallback. D1 projection of 100 complexes / 1000 publications measured about 1.4 ms in Node; this is not browser FPS.
- `ux-target.spec.ts`: five flows, desktop and mobile: map/theme/preview/dossier with view retention; WebGL-disabled interactive 2D fallback; three main navigation sections and publication inspector; isolated case draft / blocked confirmation / returned snapshot / reopen; manual publication without AI → evidence ledger → manual claim → R2 verification → versioned signal surviving reload. Root's stable run passed 10/10 target cases alongside both performance profiles (12/12 combined).
- `ux-geometry.spec.ts`: desktop and mobile pass. Manual GeoJSON import persists across reload. Test instruments the served Svelte module only to inspect the real MapLibre instance: imported polygon feeds `footprints`, `buildings` is a visible `fill-extrusion` layer with height 48, and `queryRenderedFeatures` finds its rendered polygon. This checks extrusion rather than camera pitch alone. The second test creates a phase and verifies unknown legal scope and zero inherited factors after reload.

## D1 browser measurements

Latest machine-readable results: [desktop](performance-chromium.json), [mobile emulation](performance-mobile.json). Both identify `mapRendering: maplibre-webgl`; earlier fallback measurements have been replaced after fixing MapLibre's worker URL under Vite prebundling.

| Cached interaction | Desktop p50 / p95 | Mobile emulation p50 / p95 |
|---|---:|---:|
| X-Ray theme activation | 78.3 / 111.7 ms | 80.9 / 92.3 ms |
| Dossier relations / timeline shell | 33.0 / 34.1 ms | 33.3 / 34.4 ms |
| Heap change after five further tab cycles, forced GC | +403,428 bytes | +578,260 bytes |

Dataset: 100 synthetic DEMO complexes, 1000 publications, 10,000 observation events. Twenty samples per interaction. Browser: headless Chromium 156 on the execution Windows host (16 logical CPUs); mobile is browser emulation. Timings measure activation to two animation frames, not GPU completion. Tiles are stubbed to isolate controls. The 5–10 MB image cache, sustained pan/zoom FPS, D2 stress profile, real mobile hardware, long-session leaks and cold start are not measured. These results satisfy cached UI timing sanity targets in this setup; they do not prove the complete D1 hardware/FPS budget. Positive heap deltas are reported, not labelled a leak or proof of leak absence.

## Data and rendering boundaries

The map has one MapLibre engine, loaded lazily with its explicit bundled worker. On explicit user request, 2.5D now replaces points/clusters with clickable extruded boxes. Verified contours and measured heights take priority; otherwise a display-only 60 × 44 m rectangle is centred on the recorded object coordinates, with a labelled placeholder height of 36 m. These schematic shapes are never saved as verified geometry. The flat 2D layer continues to show only verified source contours. Imported contours retain complex and optional phase IDs. Sources/layers initialise independently of raster tile completion. Startup timeout and context loss release MapLibre before enabling DOM tile fallback; unmount disconnects observers/listeners and removes the renderer. View persistence stores camera, filters and selection, not dossier evidence.

X-Ray uncertainty uses slate with text, distinct from confirmed negative red. Legal and construction summaries require recorded provenance; absent publications differ from an empty loaded publication list. Geography is an orientation tool, not a legal conclusion. Related-place projection is bounded to verified relations whose target has coordinates.

## Visual artifacts

- [Desktop map](screenshots/desktop-map.png)
- [Desktop dossier](screenshots/desktop-dossier.png)
- [Mobile dossier](screenshots/mobile-dossier.png)

Basemap visibility depends on third-party tile availability and is not evidence of source verification. No live external registry availability is asserted by these checks.

## 2.5D boxes follow-up

`npm run check`: zero diagnostics. Map unit tests: 10/10. Geometry browser tests: 6/6 (desktop/mobile). Checks confirm default seed boxes render without GeoJSON import, point/cluster layers are hidden in 2.5D, a rendered box opens its approximate-geometry preview, 2D restores points, and imported measured geometry takes priority.
