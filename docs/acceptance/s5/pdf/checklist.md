# PDF inspection checklist — PASS

Final browser PDFs rendered with bundled pypdfium2; text extracted with pypdf. I inspected all 15 pages via view_image after final rendering.

| Artifact | Pages inspected | Result |
|---|---|---|
| confirmed.pdf | confirmed-1.png, confirmed-2.png | PASS: ID PDF-confirmed, revision1, sourceVersion9, confirmed, score70/red, full materials/disclaimer |
| long.pdf | long-1.png through long-9.png (every page) | PASS: RU + Қазақша glyphs, quote >280 chars, long URL wraps, quote and publication span pages without clipping/overlap |
| returned.pdf | returned-1.png, returned-2.png | PASS: returned explicitly shown, score70 preserved, author/time/reason present |
| connected.pdf | connected-1.png, connected-2.png | PASS: actual synthetic connected version ID/zkId/revision1/sourceVersion5,70/red, legal review, dated beforeCommissioning, server AI model/prompt/hash/run/hypothesis |

Automatic text/ID/revision/score assertions: text-checks.json, *.txt. All 15 final PNG files are adjacent to their PDFs. No missing glyphs, clipped URL/quote, overlaps, live history, hidden status, or incomplete-card misrepresentation found. Ordinary whitespace at page endings is expected. Binary files remain manifests, not embedded bytes.

Issues found and corrected before final review: live object history appeared after historical card; removed from signal rendering. Root background produced a gray trailing area in fixture PDFs; print root background is now white. Initial failed screenshots/logs were retained in acceptance logs; final PDFs/PNGs reflect corrected output.

Reproduce: tests/e2e/signal-export.spec.ts generates the 3 DEMO print fixtures; tools/s5-investigation.mjs generates connected.pdf in its real case (provider is paid; do not rerun just for printing). tools/verify-s5-pdfs.py extracts text and renders every existing PDF; visual inspection is a separate human/agent step, not inferred from page.pdf success.
