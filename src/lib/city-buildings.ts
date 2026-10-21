import type { VectorSourceSpecification } from 'maplibre-gl';

export interface CityBuildingManifest {
  schemaVersion: number;
  featureCount: number;
  knownFloors: number;
  unknownFloors: number;
  measuredHeights: number;
  metersPerFloor: number;
  retrievedAt: string;
  source: string;
  publisher: string;
  bounds: [number, number, number, number];
  tiles: string[];
  minzoom: number;
  maxzoom: number;
  sourceLayer: string;
}

/** Fail visibly on a partial/old-shape export instead of drawing plausible false heights. */
export function cityBuildingSource(value: unknown, manifestUrl: string): { manifest: CityBuildingManifest; source: VectorSourceSpecification } {
  if (!value || typeof value !== 'object') throw new Error('Missing city building manifest');
  const m = value as CityBuildingManifest;
  const counts = [m.featureCount, m.knownFloors, m.unknownFloors];
  if (m.schemaVersion !== 1 || !counts.every(n => Number.isSafeInteger(n) && n >= 0) ||
      m.featureCount === 0 || m.knownFloors + m.unknownFloors !== m.featureCount ||
      m.measuredHeights !== 0 || !Number.isFinite(m.metersPerFloor) || m.metersPerFloor < 2 || m.metersPerFloor > 6 ||
      !Array.isArray(m.bounds) || m.bounds.length !== 4 || !m.bounds.every(Number.isFinite) ||
      !(m.bounds[0] >= 82 && m.bounds[2] <= 84 && m.bounds[1] >= 49 && m.bounds[3] <= 51 && m.bounds[0] < m.bounds[2] && m.bounds[1] < m.bounds[3]) ||
      !Array.isArray(m.tiles) || m.tiles.length !== 1 || !/^[a-f0-9]{16}\/\{z\}\/\{x\}\/\{y\}\.pbf$/.test(m.tiles[0]) ||
      !Number.isInteger(m.minzoom) || !Number.isInteger(m.maxzoom) || m.minzoom < 0 || m.maxzoom > 22 || m.minzoom > m.maxzoom ||
      m.sourceLayer !== 'buildings' || typeof m.source !== 'string' || !m.source.startsWith('https://gis.kgp.kz/') ||
      typeof m.publisher !== 'string' || !Number.isFinite(Date.parse(m.retrievedAt))) {
    throw new Error('Invalid city building manifest');
  }
  // URL serialisation escapes braces; MapLibre needs literal template tokens.
  const tileUrl = new URL(m.tiles[0], manifestUrl).href.replace(/%7B/gi, '{').replace(/%7D/gi, '}');
  return { manifest: m, source: {
    type: 'vector', tiles: [tileUrl], bounds: m.bounds, minzoom: m.minzoom, maxzoom: m.maxzoom,
    attribution: '<a href="https://gis.kgp.kz/arcgis/rest/services/KPSSU/Gray_basemap/FeatureServer/1" target="_blank" rel="noopener">КПСиСУ · этажность</a>',
  } };
}
