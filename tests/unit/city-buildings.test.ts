import { describe, it, expect } from 'vitest';
import { cityBuildingSource } from '../../src/lib/city-buildings';

const manifest = () => ({
  schemaVersion: 1, featureCount: 100, knownFloors: 90, unknownFloors: 10,
  measuredHeights: 0, metersPerFloor: 3.2, retrievedAt: '2026-10-21T00:00:00Z',
  source: 'https://gis.kgp.kz/arcgis/rest/services/KPSSU/Gray_basemap/FeatureServer/1',
  publisher: 'КПСиСУ', bounds: [82.4, 49.8, 82.9, 50.1],
  tiles: ['0123456789abcdef/{z}/{x}/{y}.pbf'], minzoom: 12, maxzoom: 15, sourceLayer: 'buildings',
});

describe('official city tiles', () => {
  it('keeps tiling lazy and resolves relative to a deployment subpath with literal tokens', () => {
    const { source } = cityBuildingSource(manifest(), 'https://example.org/app/city-buildings/manifest.json');
    expect(source.tiles).toEqual(['https://example.org/app/city-buildings/0123456789abcdef/{z}/{x}/{y}.pbf']);
    expect(source.bounds).toEqual([82.4, 49.8, 82.9, 50.1]);
    expect(source.attribution).toContain('КПСиСУ');
  });
  it('rejects partial counts and out-of-city geometry metadata', () => {
    expect(() => cityBuildingSource({ ...manifest(), featureCount: 101 }, 'https://example.org/manifest.json')).toThrow();
    expect(() => cityBuildingSource({ ...manifest(), bounds: [0, 0, 1, 1] }, 'https://example.org/manifest.json')).toThrow();
  });
  it('rejects untrusted tile URLs and source schemas', () => {
    for (const value of [{ tiles: ['https://elsewhere.org/{z}/{x}/{y}'] }, { schemaVersion: 2 }, { measuredHeights: 90 }, { sourceLayer: 'other' }]) {
      expect(() => cityBuildingSource({ ...manifest(), ...value }, 'https://example.org/manifest.json')).toThrow();
    }
  });
});
