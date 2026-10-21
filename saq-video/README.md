# SAQ QURYLYS — cinematic product film

Final MP4: `out/SAQ_QURYLYS_Cinematic_60s.mp4`.
Editable master: `src/Film.tsx`, registered in `src/Root.tsx`.

The real application UI is unchanged. Browser recordings show the isolated local DEMO for SQ-001, including an actual successful R2 review. No production authentication or database changes were used.

## Re-render from included assets

Node 22+ recommended. All used images, footage and original audio are included in `public/`.

```powershell
npm ci
node scripts/render.cjs
```

Open the editable timeline: `npm run dev -- --port=3007`.
Master composition ID: `SAQ-QURYLYS-60s`. Remotion 4.0.537 rejects underscores in composition IDs, so the requested `SAQ_QURYLYS_60s` is represented with hyphens. The output filename retains the requested underscores.

## Capture and QA

The application must be running on `http://127.0.0.1:5174`. Start it from the repository root with `npm run dev -- --port 5174`.

```powershell
npx playwright install chromium
python -m pip install -r requirements.txt
node scripts/capture.cjs
python scripts/prepare.py
node scripts/render.cjs
python scripts/qa.py
```

Raw browser captures: `out/raw/`. Current take and trim points: `out/capture-manifest.json`. Normalized editable CFR 30fps footage: `public/footage/`. Screenshots: `public/stills/`. Actual demo decision evidence: `out/demo-state-evidence.json`. Browser cursor overlays follow logged click positions; no product controls are fabricated.

Documents: `docs/storyboard.md`, `docs/narration.md`, `docs/discovery.md`, `docs/qa-report.md`.
QA evidence: `out/ffprobe.json`, `out/qa-evidence.json`, `out/frames/`, `out/contact-sheet.png`.

Current music: Awake by Tycho, using the audio file supplied by the user. The first 60 seconds are used with smooth fades and level normalization. Current audio is `public/atmosphere.wav`; original source is `public/music/tycho-awake.mp3`. Reproduce with `python scripts/tycho_music.py`. See `docs/music-license.md` for provenance. The current version does not use Motivator or the earlier synthesized music.

The film opens the saved original of a built-in fictional deposit publication. That publication has no external source URL. It does not claim a live external check or a real-world violation. The resulting signal stays a draft. X-Ray is excluded.
