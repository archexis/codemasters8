import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initialState } from '../../src/lib/domain';
import { constructionFrames } from '../../src/lib/construction-images';
import { dossierTimeline } from '../../src/lib/dossier-context';

describe('bundled construction illustrations', () => {
  it('ships four dated frames and thumbnails for every current demo complex', () => {
    const state = initialState();
    expect(state.complexes).toHaveLength(8);
    for (const complex of state.complexes) {
      const frames = constructionFrames(complex);
      expect(frames.map(frame => frame.date)).toEqual(['2026-05-20', '2026-07-20', '2026-09-20', '2026-10-20']);
      for (const frame of frames) {
        expect(existsSync(resolve('public', frame.image.slice(1)))).toBe(true);
        expect(existsSync(resolve('public', frame.thumbnail.slice(1)))).toBe(true);
      }
    }
  });

  it('does not assign fictional images to real objects, a reused identity, or a phase', () => {
    const complex = initialState().complexes[0];
    expect(constructionFrames({ ...complex, demo: false })).toEqual([]);
    expect(constructionFrames({ ...complex, name: 'Другой объект' })).toEqual([]);
    expect(constructionFrames(complex, 'phase-one')).toEqual([]);
    expect(constructionFrames(undefined)).toEqual([]);
  });

  it('exposes illustrations in chronology without creating evidence, capture dates or scores', () => {
    const state = initialState();
    const before = JSON.stringify(state);
    const events = dossierTimeline(state, state.complexes[0].id).filter(e => e.illustration);
    expect(events).toHaveLength(4);
    expect(events.map(e => e.occurredAt)).toEqual(['2026-10-20', '2026-09-20', '2026-07-20', '2026-05-20']);
    for (const event of events) {
      expect(event.capturedAt).toBeNull();
      expect(event.media).toBeUndefined();
      expect(event.artifactId).toBeUndefined();
    }
    expect(dossierTimeline(state, state.complexes[0].id, 'phase-one').filter(e => e.illustration)).toEqual([]);
    expect(JSON.stringify(state)).toBe(before);
  });
});
