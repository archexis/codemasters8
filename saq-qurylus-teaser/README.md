# SAQ QURYLYS — NOTHING WITHOUT EVIDENCE

An editable Remotion production: **15 seconds · 450 frames · 30 fps · 1920 × 1080 · H.264 / yuv420p · stereo AAC**. Composition ID: `SAQQurylusTeaser`.

## Authenticity and release status

This is a **clearly labeled demonstration teaser using captures of the actual product**. The workspace contains the functioning SAQ QURYLYS interface, but its bundled project names, developers, documents, publications, assessments and confirmed facts are fictional demonstration data. Real Oskemen geography and site coordinates appear on the map. Product scenes display `ДЕМО · ВЫМЫШЛЕННЫЕ ДАННЫЕ` in addition to the original interface's own labels.

No official PDF or authentic government record was available. Scene 05 shows the real application's saved demo publication, not an invented official document. Scene 06 shows an **existing confirmed R3 demo fact** and its source, not a newly fabricated verification interaction. No application records were changed. The final wordmark is temporary editable typography because no separate official logo asset was supplied. Replace these materials with authorized production captures before representing this as a real investigation. See `public/assets/PROVENANCE.md` for exact capture routes and limitations.

The existing Svelte app and the pre-existing `saq-video/` project were preserved. This project is independent.

## Setup and preview

Node.js 20.19+, 22.13+, or 24+. Dependencies are pinned in `package-lock.json`.

```bash
npm ci
npm run dev
```

Open the URL printed by Remotion Studio and select `SAQQurylusTeaser`. A working session was started on port 3002 during production. The cover is a separate editable Still, `SAQQurylusCover`.

## Render and inspect

```bash
npm run typecheck
npm run frames
npm run render
npm run cover
python scripts/validate_render.py
python scripts/contact_sheet.py
```

`npm run render` renders a Remotion master at CRF 16, then normalizes it to the delivery specification at CRF 15 with 320 kbps stereo AAC. This final FFmpeg pass explicitly converts full-range source frames to limited-range BT.709 `yuv420p` and trims AAC padding, ensuring the MP4 container and both tracks are exactly 15.000 seconds. The intermediate `out/remotion-master.mp4` is retained for inspection. Remotion downloads its supported Chrome Headless Shell on first render. All product images, fonts and sound assets are bundled; subsequent renders do not contact live map services or data APIs. For offline machines, provision Remotion's browser cache or edit the render script to pass an installed browser with `--browser-executable`.

Python scripts require `numpy`, `Pillow` and `imageio-ffmpeg` (`python -m pip install numpy Pillow imageio-ffmpeg`). Playback and rendering do not require Python; the generated WAV stems are included. On Windows the export uses Remotion's bundled FFmpeg/FFprobe. Validation uses the full FFmpeg provided by `imageio-ffmpeg` (or a system installation) because Remotion's smaller binary omits analysis-oriented raw-video and PCM muxers. Other platforms need system FFprobe in addition to FFmpeg.

## Editing

- `src/config/timing.ts`: authoritative eight-scene boundaries, exactly matching the brief. Keep the registration in `src/Root.tsx` at 450 frames, 30 fps, 1920 × 1080.
- `src/config/theme.ts`: exact Russian editorial strings, palette and demo disclosure.
- `src/config/assets.ts`: asset paths, source crop rectangles, camera positions and highlight anchors. All source coordinates refer to original 1920 × 1080 screenshots.
- `src/scenes/Scenes.tsx`: eight independent scene components and the shared city camera. All motion derives from the current frame; no live timers or CSS animation.
- `src/components/Cinematic.tsx`: camera wrapper, whole-title entrance, cropped product frame, rectangular source selection and trace aligned to an existing graph edge.
- `src/components/AudioTimeline.tsx`: three independently editable, sample-aligned stereo stems.

The map is a captured genuine app view with a monochrome photographic grade. UI evidence plates preserve the actual interface colors and text. The graph trace emphasizes the existing source-to-object relationship. The confirmation highlight surrounds the real app's result and review metadata for one specific demo fact. The reverse shot traverses verification → source → graph → dossier → target → city using six four-frame cuts. The brand shot begins at frame 375, breathes in darkness for six frames, and holds still after frame 403.

### Replacing assets

1. Capture the corresponding real application state without repainting its content. Use 1920 × 1080 screenshots where possible.
2. Put images in `public/assets/` and update paths in `src/config/assets.ts`.
3. Adjust `CROPS`, `ANCHORS` and `CAMERAS` for the new screen layout. Update the graph trace path in `ConnectionTrace` if the actual relationship route changes.
4. For map imagery, retain the provider's attribution. The current city and target coordinates must be updated together if choosing a different object.
5. Set `ASSETS.logo` to the official logo's relative path when supplied, or keep `null` for the editable typographic wordmark.
6. Only change the demo disclosure after replacing **all** corresponding fictional records and verifying the source provenance. Update `PROVENANCE.md`.
7. Run the preview, render and visual review commands again. No timeline rewrite is needed.

## Music and sound design

The current version includes **Cinematic Tension 002 by Sascha Ende**, chosen by the user. Source: https://ende.app/en/song/12249-cinematic-tension-002. License: **CC BY 4.0**, https://creativecommons.org/licenses/by/4.0/. Attribution and modification notice are bundled in `public/audio/MUSIC-CREDITS.txt` and shown on the review page. Retain this attribution in the description or credits when publishing.

The composer's publicly supplied 128 kbps MP3 is bundled as `public/audio/cinematic-tension-002.mp3`; this is not a lossless source. `scripts/prepare_music.py` selects the excerpt beginning at source time 6.5 seconds, aligns the early pulse with the target shot, builds its level through the investigation and ends the music at video time 12.5 seconds. The clean brand impact remains separate. The original atmosphere and mechanical accents are reduced to make room for the music. All gains and source provenance are in `src/config/music.json`.

To recreate the edit: `python scripts/prepare_music.py`. The previous video containing only original sound design is retained locally as `out/saq-qurylus-teaser-original-sfx.mp4`.

The sound effects use original deterministic offline synthesis, with no voice-over. `scripts/synthesize_audio.py` uses a fixed random seed, 48 kHz stereo PCM and short gain envelopes. It builds a low industrial room tone, accelerating pulses, dry relay transients, source-selection impacts, an investigative confirmation hit, a reverse sweep and a clean final bass hit. Event frames and gains are in `src/config/audio-events.json`.

```bash
npm run audio
```

The three stems share a common normalization gain. Their combined pre-encode peak is approximately −1.21 dBFS, with six frames of silence from the frame-375 cut to the frame-381 logo impact. `out/audio-synthesis.json` records synthesis metadata. The encoded MP4 is separately checked for clipping and non-silent audio.

Inter is bundled locally with its SIL Open Font License in `public/fonts/OFL.txt`.

## Deliverables and QA

- `out/saq-qurylus-teaser.mp4`: full-resolution final video.
- `out/saq-qurylus-cover.png`: crisp 1920 × 1080 brand cover.
- `out/saq-qurylus-contact-sheet.png`: representative frames, including every scene and transition boundaries, extracted from the final MP4.
- `out/frames/`: full-size PNG review frames, including the thirteen requested frames.
- `out/validation.json` and `out/ffprobe.json`: measured export properties, complete-decode result, audio measurements and file checksum.

Production used the official `remotion-dev/skills` package: best-practices, create, markup, maps, render, docs and studio. Relevant composition, sequencing, font, audio, static-map and FFmpeg references were read before implementation. Documentation: https://www.remotion.dev/docs/ai/skills
