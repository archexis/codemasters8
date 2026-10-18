<script lang="ts">
  import { onMount } from 'svelte';
  import type { Map as MapType, GeoJSONSource } from 'maplibre-gl';
  import type { Complex } from '../lib/types';
  import { computeScore } from '../lib/scoring';
  import 'maplibre-gl/dist/maplibre-gl.css';
  let { complexes }: { complexes: Complex[] } = $props();
  let container: HTMLDivElement;
  let map: MapType | undefined;
  let loaded = $state(false);
  let failed = $state('');
  let satellite = $state(false);
  const points = $derived(complexes.filter(z => typeof z.lng === 'number' && typeof z.lat === 'number' && Math.abs(z.lat) <= 90 && Math.abs(z.lng) <= 180));
  const geojson = $derived({ type: 'FeatureCollection' as const, features: points.map(z => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [z.lng!, z.lat!] }, properties: { id: z.id, name: z.name, zone: computeScore(z.factors).zone } })) });
  $effect(() => { const data = geojson; if (loaded) (map?.getSource('complexes') as GeoJSONSource | undefined)?.setData(data); });
  $effect(() => { const visible = satellite; if (loaded && map) { map.setLayoutProperty('satellite', 'visibility', visible ? 'visible' : 'none'); } });
  onMount(() => {
    let disposed = false;
    import('maplibre-gl').then(ml => {
      if (disposed) return;
      try {
        map = new ml.Map({ container, center: [82.614, 49.984], zoom: 12, style: {
          version: 8, sources: {
            osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' },
            esri: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Esri World Imagery' },
          }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }, { id: 'satellite', type: 'raster', source: 'esri', layout: { visibility: 'none' } }],
        } });
        map.addControl(new ml.NavigationControl(), 'top-right');
        map.on('error', () => { failed = 'Часть картографических данных недоступна. Список объектов работает.'; });
        map.on('load', () => {
          if (!map || disposed) return;
          map.addSource('complexes', { type: 'geojson', data: geojson, cluster: true, clusterMaxZoom: 14, clusterRadius: 45 });
          map.addLayer({ id: 'clusters', type: 'circle', source: 'complexes', filter: ['has', 'point_count'], paint: { 'circle-color': '#183e33', 'circle-radius': ['step', ['get', 'point_count'], 17, 10, 23], 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
          map.addLayer({ id: 'points', type: 'circle', source: 'complexes', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': ['match', ['get', 'zone'], 'red', '#cf453e', 'yellow', '#e3a82d', '#388068'], 'circle-radius': 9, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
          map.on('click', 'points', e => { const id = e.features?.[0]?.properties?.id; if (typeof id === 'string') location.hash = `/detail/${encodeURIComponent(id)}`; });
          map.on('click', 'clusters', async e => {
            const f = e.features?.[0]; if (!map || !f || f.geometry.type !== 'Point') return;
            const zoom = await (map.getSource('complexes') as GeoJSONSource).getClusterExpansionZoom(Number(f.properties.cluster_id));
            map.easeTo({ center: f.geometry.coordinates as [number, number], zoom });
          });
          map.on('mouseenter', 'points', () => { if (map) map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', 'points', () => { if (map) map.getCanvas().style.cursor = ''; });
          loaded = true;
        });
      } catch { failed = 'WebGL недоступен. Используйте список объектов.'; }
    }).catch(() => { failed = 'Не удалось загрузить карту'; });
    return () => { disposed = true; loaded = false; map?.remove(); map = undefined; };
  });
</script>
<div class="map-wrap">
  <div bind:this={container} class="map" aria-label="Карта объектов Өскемена"></div>
  <div class="map-caption"><span>ӨСКЕМЕН · {points.length} точек</span><button class="small" onclick={() => satellite = !satellite}>{satellite ? 'Карта' : 'Спутник'}</button></div>
  {#if failed}<p class="map-warning" role="status">{failed}</p>{/if}
</div>
<p class="muted text-xs">Без координат: {complexes.length - points.length}. Публичные координаты приблизительные. Дата спутникового снимка неизвестна.</p>
