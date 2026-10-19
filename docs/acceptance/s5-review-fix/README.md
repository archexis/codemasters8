# S5 parent review fix

Two defects repaired: explicit missing/invalid signal revisions cannot fall back to the live card; export validates expected revision failures before calling buildExport in render. Both show a recoverable alert and a link to the current signal, without print/export/download controls. Other buildExport exceptions are not swallowed. Shared small query parser rejects empty, nonpositive, noninteger, unsafe, malformed and duplicate revision parameters. Dropdown selection still drives both the frozen view and export href.

Durable regression: tests/e2e/signal-revision.spec.ts (desktop/mobile) and tests/unit/signal-revision.test.ts. Original .temp parent reproducer preserved.

Validation: check 0 errors/warnings; targeted unit 24 PASS; full unit 305 PASS; targeted browser AI/signal/export 34 PASS; parent reproducer 2 PASS; build PASS. Full browser regression: 82 PASS, recorded in e2e-independent.log. e2e.log is a redundant concurrent attempt which failed because the already-running independent regression owned port 5176; no assertions were weakened.

Only routing validation/error UI changed. Valid printable card markup/CSS and snapshot/export construction were unchanged; existing 15-page visual inspection in s5/pdf/checklist.md remains applicable. Existing print fixture browser assertions reran successfully (the fixture suite also regenerates its three PDFs). No new PDF visual claim is made.

AI code, prompt and schema unchanged; no paid AI request made. Historical connected/provider and backend/SQL evidence retained from S5. Affected accumulated frontend regression rerun: check, all unit, build, all desktop/mobile E2E. No new claims of backend/cloud/edge execution. Dirty changes preserved; no reset/deploy/push or S6. Reports before this fix archived in history/s5-before-review-fix. Current source manifests updated only after successful affected regression.

Gates 0–5: PASS with fresh source manifests (gates.log). Stopped for parent independent review.
