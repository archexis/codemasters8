import type { Ad, Complex, Zone } from './types';
import { computeScore } from './scoring';

export type XRayTheme = 'off' | 'legal' | 'construction' | 'advertising';
export interface MapGeometry {
  /** Each contour belongs to one canonical complex and optional phase. Never infer footprints from markers. */
  complexId: string; phaseId?: string; verified: boolean; source: string;
  coordinates: [number, number][][]; heightMeters?: number;
}
export interface MapRelation { fromId: string; toId: string; verified: boolean }
export interface MapSummary {
  id: string; name: string; address: string; developer: string; bin: string | null;
  lng: number; lat: number; score: number; zone: Zone; demo: boolean;
  label: string; color: string; source: string; date: string; publications: number | null;
}
export const UNKNOWN_COLOR = '#687b90';
export interface MapRect { left: number; top: number; right: number; bottom: number }
/** Largest unobstructed rectangle, in map-local pixels. */
export function freeMapCenter(width: number, height: number, obstacles: MapRect[]): [number, number] {
  const boxes = obstacles.map(r => ({ left: Math.max(0, r.left), right: Math.min(width, r.right), top: Math.max(0, r.top), bottom: Math.min(height, r.bottom) })).filter(r => r.left < r.right && r.top < r.bottom);
  const edges = [...new Set([0, width, ...boxes.flatMap(r => [r.left, r.right])])].sort((a, b) => a - b);
  let bestArea = 0;
  let best: [number, number] = [width / 2, height / 2];
  for (let i = 0; i < edges.length - 1; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const left = edges[i], right = edges[j];
      const blocked = boxes.filter(r => r.left < right && r.right > left).sort((a, b) => a.top - b.top);
      let top = 0;
      for (const r of [...blocked, { top: height, bottom: height }]) {
        const area = (right - left) * (r.top - top);
        if (area > bestArea) { bestArea = area; best = [(left + right) / 2, (top + r.top) / 2]; }
        top = Math.max(top, r.bottom);
      }
    }
  }
  return best;
}
export const ZONE_COLORS = { green: '#388068', yellow: '#b47b11', red: '#bf453e' };
export function hasCoordinates(z: Complex): z is Complex & { lng: number; lat: number } {
  return typeof z.lng === 'number' && Number.isFinite(z.lng) && Math.abs(z.lng) <= 180 && typeof z.lat === 'number' && Number.isFinite(z.lat) && Math.abs(z.lat) <= 85.051129;
}
export function summarizeMap(z: Complex & { lng: number; lat: number }, theme: XRayTheme, ads?: Ad[]): MapSummary {
  const score = computeScore(z.factors);
  let label = 'Базовая зона риска'; let color = ZONE_COLORS[score.zone]; let source = ''; let date = '';
  const publications = ads ? ads.filter(a => a.zkId === z.id) : null;
  if (theme === 'legal') {
    const legal = z.legalBasis;
    const verified = !!legal.source && !!legal.checkedAt && !!legal.reviewText;
    label = 'Основание требует проверки'; color = UNKNOWN_COLOR;
    if (verified && legal.status === 'verified' && ['guarantee', 'mio-permit'].includes(legal.type)) {
      label = legal.type === 'guarantee' ? 'Проверена гарантия КЖК' : 'Проверено разрешение МИО'; color = '#388068';
    } else if (verified && legal.status === 'absent-verified' && legal.type === 'absent') { label = 'Подтверждено отсутствие основания'; color = '#bf453e'; }
    if (verified) { source = legal.source; date = legal.checkedAt; }
  } else if (theme === 'construction') {
    const observed = z.readinessSources.filter(s => Number.isFinite(s.value) && !!s.source && !!s.date).at(-1);
    label = 'Подтверждённая готовность неизвестна'; color = UNKNOWN_COLOR;
    if (observed && z.readinessConfirmed !== null && observed.value === z.readinessConfirmed) {
      label = `Подтверждённая готовность ${observed.value}%`; color = '#388068'; source = observed.source; date = observed.date;
      const claimed = z.readinessClaimedSource;
      if (claimed && claimed.source && claimed.date && claimed.value - observed.value >= 20) { label += ' · разрыв ≥20 п.п.'; color = '#b47b11'; }
    }
  } else if (theme === 'advertising') {
    const factor = z.factors.find(f => f.code === 'R2' && f.status === 'confirmed' && f.evidence?.source && f.evidence?.date);
    label = publications ? `Связанных публикаций: ${publications.length} · предложение денег не подтверждено` : 'Публикации не загружены'; color = UNKNOWN_COLOR;
    if (factor?.evidence) { label = 'Подтверждено предложение внести деньги'; color = '#bf453e'; source = factor.evidence.source; date = factor.evidence.date; }
  }
  return { id: z.id, name: z.name, address: z.address, developer: z.developer, bin: z.bin, lng: z.lng, lat: z.lat, score: score.score, zone: score.zone, demo: !!z.demo, label, color, source, date, publications: publications?.length ?? null };
}
export function validGeometry(g: MapGeometry): boolean {
  return g.verified && !!g.source && g.coordinates.length > 0 && g.coordinates.every(r => r.length >= 4 && r.every(p => p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 85.051129) && r[0][0] === r.at(-1)![0] && r[0][1] === r.at(-1)![1]);
}
/** Display-only boxes: approximate shapes never become verified survey data. */
export function buildingShapes(summaries: MapSummary[], geometry: MapGeometry[]) {
  const known = geometry.filter(g => validGeometry(g) && summaries.some(z => z.id === g.complexId));
  const shapes = known.map(g => ({
    id: g.complexId, phaseId: g.phaseId ?? '', coordinates: g.coordinates,
    height: Number.isFinite(g.heightMeters) && g.heightMeters! > 0 ? g.heightMeters! : 36,
    approximateFootprint: false, approximateHeight: !(Number.isFinite(g.heightMeters) && g.heightMeters! > 0),
  }));
  const covered = new Set(known.map(g => g.complexId));
  for (const z of summaries) {
    if (covered.has(z.id)) continue;
    // A 60 × 44 m schematic footprint centred on the object's recorded location.
    const dx = 30 / (111320 * Math.cos(z.lat * Math.PI / 180));
    const dy = 22 / 111320;
    const clampLat = (lat: number) => Math.max(-85.051129, Math.min(85.051129, lat));
    const clampLng = (lng: number) => Math.max(-180, Math.min(180, lng));
    const ring: [number, number][] = [
      [clampLng(z.lng-dx),clampLat(z.lat-dy)], [clampLng(z.lng+dx),clampLat(z.lat-dy)],
      [clampLng(z.lng+dx),clampLat(z.lat+dy)], [clampLng(z.lng-dx),clampLat(z.lat+dy)],
      [clampLng(z.lng-dx),clampLat(z.lat-dy)],
    ];
    shapes.push({id:z.id,phaseId:'',coordinates:[ring],height:36,approximateFootprint:true,approximateHeight:true});
  }
  return {type:'FeatureCollection' as const,features:shapes.map(s=>({
    type:'Feature' as const,geometry:{type:'Polygon' as const,coordinates:s.coordinates},
    properties:{id:s.id,phaseId:s.phaseId,height:s.height,approximateFootprint:s.approximateFootprint,approximateHeight:s.approximateHeight,color:summaries.find(z=>z.id===s.id)?.color ?? UNKNOWN_COLOR},
  }))};
}
export function worldPoint(lng: number, lat: number, zoom: number): [number, number] {
  const scale = 256 * 2 ** zoom; const sin = Math.sin(Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI / 180);
  return [(lng + 180) / 360 * scale, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale];
}
export function worldCoordinates(x: number, y: number, zoom: number): [number, number] {
  const scale = 256 * 2 ** zoom;
  return [((x / scale * 360) % 360 + 360) % 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * Math.max(0, Math.min(scale, y)) / scale))) * 180 / Math.PI];
}
/** Bound map relationships to checked links and geolocated entities only. Company roles never become invented map points. */
export function relatedMapPlaces(complexId: string, relations: MapRelation[], summaries: Pick<MapSummary, 'id'>[], limit = 30): string[] {
  const located = new Set(summaries.map(s => s.id));
  return [...new Set(relations.filter(r => r.verified && (r.fromId === complexId || r.toId === complexId)).map(r => r.fromId === complexId ? r.toId : r.fromId).filter(id => id !== complexId && located.has(id)))].slice(0, Math.max(0, Math.min(100, limit)));
}
