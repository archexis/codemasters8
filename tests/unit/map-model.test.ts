import { describe, expect, it } from 'vitest';
import seed from '../../src/lib/seed.json';
import type { Complex } from '../../src/lib/types';
import { hasCoordinates, summarizeMap, buildingShapes, validGeometry, worldPoint, worldCoordinates, relatedMapPlaces, freeMapCenter, UNKNOWN_COLOR, type MapGeometry } from '../../src/lib/map-model';

describe('free map center', () => {
  it('uses the full map when no panels overlap it', () => {
    expect(freeMapCenter(1000, 600, [])).toEqual([500, 300]);
  });
  it('centers beside the desktop preview and below the search', () => {
    expect(freeMapCenter(1000, 600, [
      { left: 0, top: 0, right: 300, bottom: 600 },
      { left: 300, top: 0, right: 1000, bottom: 80 },
    ])).toEqual([650, 340]);
  });
  it('centers above a mobile bottom sheet, between top and bottom overlays', () => {
    expect(freeMapCenter(400, 700, [
      { left: -10, top: 400, right: 410, bottom: 720 },
      { left: 0, top: 0, right: 400, bottom: 80 },
    ])).toEqual([200, 240]);
  });
  it('handles overlapping panels and ignores hidden off-map rectangles', () => {
    expect(freeMapCenter(1000, 600, [
      { left: 0, top: 0, right: 300, bottom: 450 },
      { left: 0, top: 400, right: 300, bottom: 600 },
      { left: 1200, top: 0, right: 1400, bottom: 600 },
    ])).toEqual([650, 300]);
  });
});

const complex = () => structuredClone(seed.COMPLEXES[0]) as Complex & { lng: number; lat: number };
describe('map summaries preserve uncertainty and evidence boundaries', () => {
  it('rejects absent, non-finite and out-of-range coordinates', () => {
    const z = complex();
    expect(hasCoordinates({ ...z, lng: NaN })).toBe(false);
    expect(hasCoordinates({ ...z, lat: 91 })).toBe(false);
    expect(hasCoordinates({ ...z, lat: null })).toBe(false);
    expect(hasCoordinates({ ...z, lng: 82.6, lat: 49.9 })).toBe(true);
  });
  it('does not paint missing legal data as a confirmed negative', () => {
    const z = complex(); z.legalBasis = { type: 'unknown', status: 'unknown', source: '', checkedAt: '', reviewText: '' };
    const unknown = summarizeMap(z, 'legal');
    expect(unknown.color).toBe(UNKNOWN_COLOR);
    z.legalBasis = { type: 'absent', status: 'absent-verified', source: '', checkedAt: '', reviewText: '' };
    expect(summarizeMap(z, 'legal').color).toBe(UNKNOWN_COLOR);
    z.legalBasis = { ...z.legalBasis, source: 'Акт сверки', checkedAt: '2026-10-19', reviewText: 'Проверено в указанной области' };
    expect(summarizeMap(z, 'legal').color).not.toBe(UNKNOWN_COLOR);
  });
  it('does not treat a readiness claim as measured progress', () => {
    const z = complex(); z.readinessConfirmed = 80; z.readinessSources = []; z.readinessClaimed = 80;
    expect(summarizeMap(z, 'construction').label).toContain('неизвестна');
    z.readinessSources = [{ value: 35, source: 'Осмотр', date: '2026-10-01' }]; z.readinessConfirmed = 35;
    expect(summarizeMap(z, 'construction').label).toContain('35%');
    expect(summarizeMap(z, 'construction').source).toBe('Осмотр');
  });
  it('distinguishes an empty publication query from publications not loaded', () => {
    expect(summarizeMap(complex(), 'advertising').publications).toBeNull();
    expect(summarizeMap(complex(), 'advertising', []).publications).toBe(0);
  });
  it('requires explicit, verified, closed footprints and finite coordinates', () => {
    const shape: MapGeometry = { complexId: 'SQ-001', phaseId: 'phase-1', verified: true, source: 'Survey', coordinates: [[[82, 49], [82.1, 49], [82.1, 49.1], [82, 49]]] };
    expect(validGeometry(shape)).toBe(true);
    expect(validGeometry({ ...shape, verified: false })).toBe(false);
    expect(validGeometry({ ...shape, coordinates: [[[82, 49], [82.1, 49], [82.1, 49.1], [83, 50]]] })).toBe(false);
    expect(validGeometry({ ...shape, coordinates: [[[82, 49], [NaN, 49], [82.1, 49.1], [82, 49]]] })).toBe(false);
  });
  it('places a display-only closed 3D box around an object without a survey contour', () => {
    const summary=summarizeMap(complex(),'off');
    const shape=buildingShapes([summary],[]).features[0];
    expect(shape.properties).toMatchObject({id:summary.id,height:36,approximateFootprint:true,approximateHeight:true,color:summary.color});
    const ring=shape.geometry.coordinates[0];
    expect(ring).toHaveLength(5);expect(ring[0]).toEqual(ring[4]);
    expect((ring[0][0]+ring[2][0])/2).toBeCloseTo(summary.lng,8);
    expect((ring[0][1]+ring[2][1])/2).toBeCloseTo(summary.lat,8);
    expect((ring[1][0]-ring[0][0])*111320*Math.cos(summary.lat*Math.PI/180)).toBeCloseTo(60,5);
    expect((ring[2][1]-ring[0][1])*111320).toBeCloseTo(44,5);
  });
  it('uses verified footprints and measured height instead of duplicating them with schematic boxes', () => {
    const summary=summarizeMap(complex(),'legal');
    const geometry:MapGeometry={complexId:summary.id,phaseId:'phase-1',verified:true,source:'Survey',heightMeters:48,coordinates:[[[82,49],[82.1,49],[82.1,49.1],[82,49]]]};
    const shapes=buildingShapes([summary],[geometry]);
    expect(shapes.features).toHaveLength(1);
    expect(shapes.features[0].geometry.coordinates).toEqual(geometry.coordinates);
    expect(shapes.features[0].properties).toMatchObject({height:48,phaseId:'phase-1',approximateFootprint:false,approximateHeight:false});
    expect(buildingShapes([summary],[{...geometry,heightMeters:undefined}]).features[0].properties).toMatchObject({height:36,approximateFootprint:false,approximateHeight:true});
    expect(buildingShapes([summary],[{...geometry,verified:false}]).features[0].properties.approximateFootprint).toBe(true);
  });
  it('uses reversible Web Mercator projection for the non-WebGL fallback', () => {
    for (const zoom of [3, 12, 19]) {
      const p = worldPoint(82.614, 49.984, zoom); const coordinates = worldCoordinates(...p, zoom);
      expect(coordinates[0]).toBeCloseTo(82.614, 7); expect(coordinates[1]).toBeCloseTo(49.984, 7);
    }
  });
  it('only maps unique, verified relations to geolocated neighbours', () => {
    const relations = [{ fromId: 'a', toId: 'b', verified: true }, { fromId: 'b', toId: 'a', verified: true }, { fromId: 'a', toId: 'c', verified: false }, { fromId: 'a', toId: 'company-without-location', verified: true }];
    expect(relatedMapPlaces('a', relations, [{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toEqual(['b']);
    expect(relatedMapPlaces('a', relations, [{ id: 'a' }, { id: 'b' }], 0)).toEqual([]);
  });
  it('D1 sanity: projects 100 complexes and 1000 publications without fetching dossier details', () => {
    const complexes = Array.from({ length: 100 }, (_, i) => ({ ...complex(), id: `D1-${i}` }));
    const ads = Array.from({ length: 1000 }, (_, i) => ({ zkId: `D1-${i % 100}` })) as Parameters<typeof summarizeMap>[2];
    const start = performance.now();
    const summaries = complexes.map(z => summarizeMap(z, 'advertising', ads));
    const duration = performance.now() - start;
    expect(summaries).toHaveLength(100); expect(summaries.every(s => s.publications === 10)).toBe(true);
    expect(summaries.every(s => !('factors' in s) && !('events' in s))).toBe(true);
    console.info(`D1 map read-model sanity: 100 complexes / 1000 publications in ${duration.toFixed(2)} ms (Node; not browser FPS)`);
    expect(duration).toBeLessThan(1000);
  });
});
