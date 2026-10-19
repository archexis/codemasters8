<script lang="ts">
  import { onMount } from 'svelte';
  import type { Map as MapType, GeoJSONSource, FillExtrusionLayerSpecification } from 'maplibre-gl';
  import type { Ad, Complex } from '../lib/types';
  import { zoneLabel } from '../lib/scoring';
  import { hasCoordinates, summarizeMap, buildingShapes, worldPoint, worldCoordinates, relatedMapPlaces, UNKNOWN_COLOR, type XRayTheme, type MapGeometry, type MapRelation } from '../lib/map-model';
  import 'maplibre-gl/dist/maplibre-gl.css';
  let { complexes, ads, geometry = [], relations = [], liveRegistryAvailable = false, onOpenDossier, onShowRelatedPlaces }: {
    complexes: Complex[]; ads?: Ad[]; geometry?: MapGeometry[]; relations?: MapRelation[]; liveRegistryAvailable?: boolean;
    onOpenDossier?: (complexId: string, phaseId?: string) => void; onShowRelatedPlaces?: (complexId: string) => void;
  } = $props();
  let container: HTMLDivElement;
  let map: MapType | undefined;
  let loaded = $state(false);
  let markersReady = $state(false);
  let fallback = $state(false);
  let warning = $state('');
  let satellite = $state(false);
  let dimensional = $state(false);
  let city3d = $state(false);
  let theme = $state<XRayTheme>('off');
  let query = $state('');
  let zone = $state('all');
  let selectedId = $state('');
  let selectedPhase = $state<string | undefined>();
  let relatedIds = $state<string[] | null>(null);
  let camera = $state({ lng: 82.614, lat: 49.984, zoom: 12, bearing: 0 });
  let width = $state(800);
  let listOpen = $state(false);
  let height = $state(520);
  const themes: { id: XRayTheme; title: string }[] = [{ id: 'off', title: 'Выкл' }, { id: 'legal', title: 'Правовой' }, { id: 'construction', title: 'Стройка' }, { id: 'advertising', title: 'Реклама' }];
  const summaries = $derived(complexes.filter(hasCoordinates).map(z => summarizeMap(z, theme, ads)));
  const visible = $derived(summaries.filter(z => (zone === 'all' || z.zone === zone) && (!relatedIds || relatedIds.includes(z.id)) && `${z.name} ${z.address} ${z.bin ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const selected = $derived(summaries.find(z => z.id === selectedId));
  const geojson = $derived({ type: 'FeatureCollection' as const, features: visible.map(z => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [z.lng, z.lat] }, properties: { id: z.id, color: z.color } })) });
  const footprints = $derived(buildingShapes(visible, geometry));
  const selectedBox = $derived(footprints.features.find(f=>f.properties.id===selectedId && (!selectedPhase || f.properties.phaseId===selectedPhase)));
  const selectedGeom = $derived(geometry.find(g => g.complexId===selected?.id && (!selectedPhase || !g.phaseId || g.phaseId===selectedPhase)));
  const center = $derived(worldPoint(camera.lng, camera.lat, Math.floor(camera.zoom)));
  const tiles = $derived.by(() => {
    const zoom = Math.floor(camera.zoom); const count = 2 ** zoom; const result = [];
    for (let x = Math.floor((center[0] - width / 2) / 256); x <= Math.floor((center[0] + width / 2) / 256); x++) {
      for (let y = Math.floor((center[1] - height / 2) / 256); y <= Math.floor((center[1] + height / 2) / 256); y++) {
        if (y >= 0 && y < count) result.push({ key: `${zoom}/${x}/${y}`, url: `https://tile.openstreetmap.org/${zoom}/${((x % count) + count) % count}/${y}.png`, x: x * 256 - center[0] + width / 2, y: y * 256 - center[1] + height / 2 });
      }
    }
    return result;
  });
  const fallbackPoints = $derived(visible.map(z => { const p = worldPoint(z.lng, z.lat, Math.floor(camera.zoom)); return { ...z, x: p[0] - center[0] + width / 2, y: p[1] - center[1] + height / 2 }; }).filter(p => p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height));
  function select(id: string, phase?: string) { selectedId = id; selectedPhase = phase || undefined; }
  function open(tab?: string) {
    if (!selected) return;
    if (onOpenDossier && !tab) onOpenDossier(selected.id, selectedPhase);
    else location.hash = `/complexes/${encodeURIComponent(selected.id)}${selectedPhase || tab ? `?${new URLSearchParams({ ...(selectedPhase ? { phase: selectedPhase } : {}), ...(tab ? { tab } : {}) })}` : ''}`;
  }
  function related() {
    if (!selected) return;
    const ids = relatedMapPlaces(selected.id, relations, summaries);
    relatedIds = [selected.id, ...ids];
    onShowRelatedPlaces?.(selected.id);
  }
  function pan(dx: number, dy: number) { const p = worldCoordinates(center[0] + dx, center[1] + dy, Math.floor(camera.zoom)); camera = { ...camera, lng: p[0], lat: p[1] }; }
  function changeZoom(delta: number) { camera = { ...camera, zoom: Math.max(3, Math.min(19, Math.floor(camera.zoom) + delta)) }; }
  function releaseWebGL(message: string) {
    if (map) { const c = map.getCenter(); camera = { lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing() }; }
    loaded = false; fallback = true; dimensional = false; warning = message; map?.remove(); map = undefined;
  }
  $effect(() => { const data = geojson; if (loaded) { markersReady = false; (map?.getSource('complexes') as GeoJSONSource | undefined)?.setData(data); } });
  $effect(() => { const data = footprints; if (loaded) (map?.getSource('footprints') as GeoJSONSource | undefined)?.setData(data); });
  function ensureSatellite() {
    if (!map || map.getSource('esri')) return;
    try {
      map.addSource('esri', { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Esri World Imagery' });
      const raster = { id: 'satellite', type: 'raster' as const, source: 'esri' };
      try { map.addLayer(raster, 'clusters'); } catch { map.addLayer(raster); }
    } catch { /* Спутник недоступен — базовая карта продолжает работать. */ }
  }
  $effect(() => { if (loaded && map) { if (satellite) ensureSatellite(); if (map.getLayer('satellite')) map.setLayoutProperty('satellite', 'visibility', satellite ? 'visible' : 'none'); } });
  function ensureTerrain() {
    if (!map || map.getSource('terrain-dem')) return;
    try {
      map.addSource('terrain-dem', { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 15, encoding: 'terrarium' });
    } catch { /* Без рельефа — город остаётся плоским. */ }
  }
  function ensureCity3D() {
    if (!map || map.getSource('openmaptiles')) return;
    try {
      map.addSource('openmaptiles', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
      const city: FillExtrusionLayerSpecification = { id: 'city3d-buildings', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', filter: ['>', ['coalesce', ['get', 'render_height'], 0], 0], paint: { 'fill-extrusion-color': '#ccd6cb', 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 12], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.88, 'fill-extrusion-vertical-gradient': true } };
      try { map.addLayer(city, 'buildings'); } catch { try { map.addLayer(city); } catch { /* Настоящие 3D-дома недоступны — остаются условные коробки. */ } }
    } catch { /* Настоящие 3D-дома недоступны — остаются условные коробки. */ }
  }
  $effect(() => {
    if (loaded && map) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      try {
        if (city3d) {
          // Настоящий 3D-город: реальные дома, рельеф и небо. Тяжёлые слои — только по первому включению.
          ensureCity3D(); ensureTerrain();
          try { map.setTerrain({ source: 'terrain-dem', exaggeration: 1.2 }); } catch { /* Рельеф недоступен. */ }
          try { (map as unknown as { setSky?: (s: object) => void }).setSky?.({ 'sky-color': '#8db4dd', 'horizon-color': '#e8eef0', 'fog-color': '#dfe6ea', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.5 }); } catch { /* Без неба. */ }
          if (map.getLayer('city3d-buildings')) map.setLayoutProperty('city3d-buildings', 'visibility', 'visible');
          map.easeTo({ pitch: 65, zoom: Math.max(map.getZoom(), 15), duration: reduce ? 0 : 600 });
        } else {
          try { map.setTerrain(null); } catch { /* Рельефа и не было. */ }
          try { (map as unknown as { setSky?: (s: null) => void }).setSky?.(null as never); } catch { /* Неба и не было. */ }
          if (map.getLayer('city3d-buildings')) map.setLayoutProperty('city3d-buildings', 'visibility', 'none');
          const flat = !dimensional;
          map.easeTo({ pitch: dimensional ? 55 : 0, zoom: flat ? map.getZoom() : Math.max(map.getZoom(), 14.5), bearing: flat ? 0 : map.getBearing(), duration: reduce ? 0 : 450 });
        }
        map.setLayoutProperty('buildings', 'visibility', (!dimensional && !city3d) ? 'none' : 'visible');
        const pts = (!dimensional && !city3d) ? 'visible' : 'none';
        for (const layer of ['points', 'clusters']) map.setLayoutProperty(layer, 'visibility', pts);
        map.setLayoutProperty('footprints-flat', 'visibility', (!dimensional && !city3d) ? 'visible' : 'none');
      } catch { /* Камера и слои остаются как были. */ }
    }
  });
  onMount(() => {
    let disposed = false;
    const startupTimer = window.setTimeout(() => { if (!disposed && !markersReady && !fallback) releaseWebGL('Основная карта не ответила вовремя. Включена функциональная 2D-карта.'); }, 8000);
    try {
      const saved = JSON.parse(sessionStorage.getItem('saq-map-view-v1') ?? 'null');
      if (saved && Array.isArray(saved.center) && saved.center.length === 2 && saved.center.every(Number.isFinite) && Math.abs(saved.center[0]) <= 180 && Math.abs(saved.center[1]) <= 85 && Number.isFinite(saved.zoom)) {
        camera = { lng: saved.center[0], lat: saved.center[1], zoom: Math.max(3, Math.min(19, saved.zoom)), bearing: Number.isFinite(saved.bearing) ? saved.bearing : 0 };
        theme = themes.some(t => t.id === saved.theme) ? saved.theme : 'off';
        zone = ['all', 'green', 'yellow', 'red'].includes(saved.zone) ? saved.zone : 'all';
        query = typeof saved.query === 'string' ? saved.query.slice(0, 200) : '';
        selectedId = typeof saved.selectedId === 'string' ? saved.selectedId : '';
        selectedPhase = typeof saved.selectedPhase === 'string' ? saved.selectedPhase : undefined;
        satellite = saved.satellite === true; dimensional = saved.dimensional === true; city3d = saved.city3d === true && saved.dimensional !== true;
      }
    } catch { /* Storage may be unavailable; the map remains usable. */ }
    const observer = new ResizeObserver(entries => { width = entries[0].contentRect.width; height = entries[0].contentRect.height; if (map) map.resize(); });
    observer.observe(container);
    const onWindowResize = () => { if (map) map.resize(); };
    window.addEventListener('resize', onWindowResize);
    // Первые секунды вёрстка ещё гуляет (шрифты, флекс): дотягиваем канвас до контейнера, пока размер не устаканится.
    const settle = window.setInterval(() => {
      try {
        if (!map || disposed) return;
        const cvs = map.getCanvas?.();
        if (!cvs) return;
        if (Math.abs(cvs.clientWidth - container.clientWidth) > 1 || Math.abs(cvs.clientHeight - container.clientHeight) > 1) map.resize();
      } catch { /* Следующий тик повторит. */ }
    }, 300);
    window.setTimeout(() => window.clearInterval(settle), 5000);
    function visibility() { if (document.hidden) map?.stop(); else map?.resize(); }
    document.addEventListener('visibilitychange', visibility);
    Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url')]).then(([ml, worker]) => {
      if (disposed || fallback) return;
      try {
        // Vite relocates the main module; its original relative worker URL cannot survive prebundling.
        ml.setWorkerUrl(worker.default);
        map = new ml.Map({ container, center: [camera.lng, camera.lat], zoom: camera.zoom, bearing: camera.bearing, maxPitch: 68, fadeDuration: 100, maxTileCacheSize: 80, style: {
          version: 8, sources: {
            osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' },
          }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
        } });
        map.addControl(new ml.NavigationControl({ visualizePitch: true, showCompass: true }), 'top-right');
        map.on('webglcontextlost', () => { if (!disposed) releaseWebGL('WebGL недоступен. Включена функциональная 2D-карта.'); });
        map.on('error', () => { warning = 'Часть картографических данных недоступна. Маркеры и список объектов работают.'; });
        map.on('moveend', () => { if (map) { const c = map.getCenter(); camera = { lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing() }; } });
        map.on('sourcedata', e => { if (e.sourceId === 'complexes' && e.isSourceLoaded) { markersReady = true; window.clearTimeout(startupTimer); } });
        map.on('style.load', () => {
          if (!map || disposed) return;
          map.addSource('complexes', { type: 'geojson', data: geojson, cluster: true, clusterMaxZoom: 14, clusterRadius: 45 });
          map.addSource('footprints', { type: 'geojson', data: footprints });
          map.addLayer({ id: 'footprints-flat', type: 'fill', source: 'footprints', filter:['==',['get','approximateFootprint'],false], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.45 } });
          map.addLayer({ id: 'buildings', type: 'fill-extrusion', source: 'footprints', layout: { visibility: dimensional ? 'visible' : 'none' }, paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.9, 'fill-extrusion-vertical-gradient':true } });
          map.addLayer({ id: 'clusters', type: 'circle', source: 'complexes', filter: ['has', 'point_count'], paint: { 'circle-color': '#183e33', 'circle-radius': ['step', ['get', 'point_count'], 17, 10, 23], 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
          map.addLayer({ id: 'points', type: 'circle', source: 'complexes', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': ['get', 'color'], 'circle-radius': 9, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
          for (const layer of ['points', 'footprints-flat', 'buildings']) {
            map.on('click', layer, e => { const p = e.features?.[0]?.properties; if (typeof p?.id === 'string') select(p.id, p.phaseId); });
            map.on('mouseenter', layer, () => { if (map) map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', layer, () => { if (map) map.getCanvas().style.cursor = ''; });
          }
          map.on('click', 'clusters', async e => {
            const f = e.features?.[0]; const active = map; if (!active || !f || f.geometry.type !== 'Point') return;
            try { const zoom = await (active.getSource('complexes') as GeoJSONSource).getClusterExpansionZoom(Number(f.properties.cluster_id)); if (!disposed && map === active) active.easeTo({ center: f.geometry.coordinates as [number, number], zoom }); } catch { /* Map may unmount during cluster expansion. */ }
          });
          loaded = true;
        try { map.resize(); } catch { /* Canvas подтянется следующим кадром. */ }
        window.setTimeout(() => { try { if (!disposed) map?.resize(); } catch { /* ignore */ } }, 600);
        });
      } catch { releaseWebGL('WebGL недоступен. Включена функциональная 2D-карта.'); }
    }).catch(() => { if (!disposed) releaseWebGL('Картографический модуль недоступен. Включена 2D-карта.'); });
    return () => {
      try { sessionStorage.setItem('saq-map-view-v1', JSON.stringify({ center: [camera.lng, camera.lat], zoom: camera.zoom, bearing: camera.bearing, theme, zone, query, selectedId, selectedPhase, satellite, dimensional, city3d })); } catch { /* Best-effort view persistence, no dossier data. */ }
      disposed = true; observer.disconnect(); window.clearInterval(settle); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('resize', onWindowResize); loaded = false; map?.stop(); map?.remove(); map = undefined;
      window.clearTimeout(startupTimer);
    };
  });
</script>
<section class="map-shell" aria-label="Карта объектов">
  <div class="map-wrap" data-map-ready={fallback || markersReady}>
    <div bind:this={container} class="map" aria-label="Карта объектов Өскемена"></div>
    <div class="map-tools map-float-top">
      <button class="small map-list-toggle" aria-expanded={listOpen} onclick={() => listOpen = !listOpen}>Список · {visible.length}</button>
      <input class="map-search" aria-label="Поиск ЖК, БИН или адреса на карте" placeholder="Поиск ЖК, БИН, адреса" bind:value={query} />
      <select aria-label="Базовая зона риска" bind:value={zone}><option value="all">Все зоны риска</option><option value="green">Зелёная</option><option value="yellow">Жёлтая</option><option value="red">Красная</option></select>
      <div class="segmented" aria-label="Подложка"><button aria-pressed={!satellite || fallback} onclick={() => satellite = false}>Карта</button><button disabled={fallback} aria-pressed={satellite && !fallback} onclick={() => satellite = true}>Спутник</button></div>
      <div class="segmented" aria-label="Размерность карты"><button title="Плоская карта: метки и контуры" aria-pressed={!dimensional && !city3d} onclick={() => { dimensional = false; city3d = false; }}>2D</button><button title="2.5D: условные объёмные коробки корпусов" disabled={fallback} aria-pressed={dimensional} onclick={() => { dimensional = true; city3d = false; }}>2.5D</button><button title="Настоящий 3D-город: реальные дома, рельеф и небо" disabled={fallback} aria-pressed={city3d} onclick={() => { city3d = true; dimensional = false; }}>3D</button></div>
      <div class="segmented xray" aria-label="Тема X-Ray"><span>X-Ray</span>{#each themes as t}<button aria-pressed={theme === t.id} onclick={() => theme = t.id}>{t.title}</button>{/each}</div>
    </div>
    {#if fallback}
      <div class="fallback-map" style:height="{height}px" aria-label="Двумерная карта без WebGL">
        {#each tiles as tile (tile.key)}<img class="tile" src={tile.url} alt="" width="256" height="256" style:left="{tile.x}px" style:top="{tile.y}px" draggable="false" />{/each}
        {#each fallbackPoints as point (point.id)}<button class="fallback-point" style:left="{point.x}px" style:top="{point.y}px" style:background={point.color} aria-label={`${point.name}: ${point.label}`} title={`${point.name}: ${point.label}`} onclick={() => select(point.id)}></button>{/each}
        <nav class="fallback-controls" aria-label="Перемещение карты"><button aria-label="Приблизить" onclick={() => changeZoom(1)}>+</button><button aria-label="Отдалить" onclick={() => changeZoom(-1)}>−</button><button aria-label="На север" onclick={() => pan(0, -160)}>↑</button><button aria-label="На запад" onclick={() => pan(-160, 0)}>←</button><button aria-label="На восток" onclick={() => pan(160, 0)}>→</button><button aria-label="На юг" onclick={() => pan(0, 160)}>↓</button></nav>
        <a class="attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
      </div>
    {/if}
    {#if !loaded && !fallback}<p class="map-status" role="status">Загрузка карты…</p>{/if}
    {#if warning}<p class="map-status" role="status">{warning}</p>{/if}
    {#if selected}
      <aside class="map-preview" aria-label="Предпросмотр ЖК">
        <div class="preview-top"><span class="preview-eyebrow">{selected.demo ? 'Демо · ' : ''}{selectedPhase ? `Очередь ${selectedPhase}` : 'Жилой комплекс'}</span><button class="close-preview" aria-label="Закрыть предпросмотр" onclick={() => selectedId = ''}>×</button></div>
        <h3>{selected.name}</h3>
        <p class="preview-sub">{selected.address}</p>
        <div class="preview-score"><strong>{selected.score}</strong><span class="legend-dot" role="img" aria-label={zoneLabel(selected.zone) + ' зона'} style:background={selected.color}></span></div>
        <p class="key-fact"><span class="legend-dot" style:background={selected.color}></span>{selected.label}</p>
        <dl class="preview-facts">
          <div><dt>Застройщик</dt><dd>{selected.developer}</dd></div>
          <div><dt>БИН</dt><dd>{selected.bin ?? 'Не указан'}</dd></div>
          <div><dt>Источник</dt><dd>{selected.source || 'Не зафиксирован'}</dd></div>
          <div><dt>Проверено</dt><dd>{selected.date || '—'}</dd></div>
          <div><dt>Публикации</dt><dd>{selected.publications ?? 'нет данных'}</dd></div>
        </dl>
        {#if selectedBox}
        <div class="preview-model">
          <strong>Корпус</strong>
          <p>{selectedBox.properties.approximateFootprint ? 'Контур — схема 60 × 44 м' : 'Контур проверен'} · высота {selectedBox.properties.height} м{selectedBox.properties.approximateHeight ? ' (условная)' : ''}</p>
          <p class="muted">Источник: {selectedGeom?.source ?? 'схема по координатам'}</p>
        </div>
        {/if}
        {#if (dimensional || city3d) && selectedBox && (selectedBox.properties.approximateFootprint || selectedBox.properties.approximateHeight)}<p class="preview-meta">{selectedBox.properties.approximateFootprint ? 'Контур и высота — схема, не обмер.' : 'Высота условная, контур проверен.'}</p>{/if}
        {#if selectedBox || theme === 'construction' || theme === 'advertising'}<button class="text-button" onclick={() => open(theme === 'advertising' ? 'verification' : 'timeline')}>{theme === 'advertising' ? 'Открыть публикации' : 'Смотреть прогресс в хронологии'} →</button>{/if}
        <div class="preview-actions"><button onclick={() => open()}>Открыть досье</button><button class="secondary" onclick={related}>Показать связи</button></div>
        {#if relatedIds}<p class="preview-meta">Связанных ЖК: {relatedIds.length - 1}.</p>{/if}
      </aside>
    {/if}
    {#if listOpen}
      <aside class="map-list-panel" aria-label="Список объектов">
        <div class="map-list-head"><strong>Объекты · {visible.length}</strong><button class="small" aria-label="Закрыть список" onclick={() => listOpen = false}>×</button></div>
        <div class="map-list-body">{#each visible as item (item.id)}<button class:active={item.id===selectedId} onclick={() => select(item.id)}><span>{item.name}</span><small>{item.label}</small></button>{:else}<p>Объектов по выбранным условиям нет.</p>{/each}</div>
      </aside>
    {/if}
    <div class="map-caption visually-hidden"><span>Өскемен · {visible.length} объектов{summaries.some(s => s.demo) ? ' · демо' : ''}</span>{#if relatedIds}<button class="small" onclick={() => relatedIds = null}>Все объекты</button>{/if}</div>
    <div class="map-legend map-legend-float visually-hidden" aria-live="polite">
    {#if theme === 'off'}<span>Базовая зона: зелёная / жёлтая / красная — по подтверждённым факторам</span>
    {:else if theme === 'legal'}<span><i style="background:#388068"></i> Проверенное основание</span><span><i style="background:#bf453e"></i> Проверенное отсутствие</span><span><i style:background={UNKNOWN_COLOR}></i> Требует проверки</span>
    {:else if theme === 'construction'}<span><i style="background:#388068"></i> Подтверждённая готовность</span><span><i style="background:#b47b11"></i> Разрыв ≥20 п.п.</span><span><i style:background={UNKNOWN_COLOR}></i> Нет измеренной готовности</span>
    {:else}<span><i style="background:#bf453e"></i> Проверено предложение денег</span><span><i style:background={UNKNOWN_COLOR}></i> Не подтверждено / нет данных</span>{/if}
  </div>
  </div>
</section>
<style>
  .map-shell{min-width:0}.map-tools{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;align-items:center}.map-tools input{flex:1;min-width:180px}.map-tools select{width:auto}.segmented{display:flex;gap:2px;padding:3px;border:0;border-radius:12px;background:rgba(0,0,0,0.06);align-items:center}.segmented button{background:transparent;box-shadow:none;border:0;border-radius:9px;color:#6e6e73;padding:7px 11px;font-size:13px;font-weight:600;white-space:nowrap}.segmented button[aria-pressed=true]{background:#fff;color:#1d1d1f;box-shadow:0 1px 4px rgba(0,0,0,0.16)}.segmented button:disabled{opacity:.4;cursor:not-allowed}.segmented span{font-size:11px;padding:0 7px}.map-wrap{position:relative;overflow:hidden}.map{flex:1 1 auto;height:auto;min-height:520px;width:100%}.map-status{pointer-events:none;position:absolute;left:12px;top:10px;right:100px;z-index:2;background:rgba(255,255,255,0.88);color:#1d1d1f;padding:9px 13px;border-radius:14px;box-shadow:0 4px 16px rgba(0,0,0,0.1);font-size:12.5px;margin:0}.map-preview{position:absolute;z-index:3;max-height:calc(100% - 105px);overflow:auto}.map-preview h3{margin:5px 25px 8px 0;font-size:21px;font-weight:700;letter-spacing:-0.01em}.map-preview p{font-size:12px;margin:7px 0}.map-preview .preview-meta{font-size:11px;color:#586858;line-height:1.5}.preview-eyebrow{font-size:12px;color:#4a463b;font-weight:500}.close-preview{position:absolute;right:8px;top:8px;padding:2px 9px;background:#fff;color:#17150e;font-size:22px;border:1px solid #e3dfd2}.preview-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;border-top:1px solid #e3dfd2;padding-top:12px}.preview-actions button{font-size:12px;padding:8px 10px}.key-fact{display:flex;gap:8px;align-items:center;font-size:13px;font-weight:650;margin:10px 0 2px;line-height:1.45}.key-fact .legend-dot{width:10px;height:10px}.legend-dot{width:10px;height:10px;flex-shrink:0;border-radius:50%}.text-button{background:none;border:0;color:#0071e3;font-size:12px;padding:7px 0;font-weight:600}.map-caption{z-index:1;bottom:25px;left:12px;max-width:calc(100% - 24px)}.map-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:#6e6e73;padding:6px 0}.map-legend span{display:flex;gap:5px;align-items:center}.map-legend i{height:10px;width:10px;border-radius:50%;display:inline-block}.fallback-map{position:absolute;inset:0;overflow:hidden;background:#eceef1}.tile{position:absolute;max-width:none;pointer-events:none}.fallback-point{position:absolute;transform:translate(-50%,-50%);width:18px;height:18px;border:2px solid white;border-radius:50%;padding:0;box-shadow:0 1px 5px rgba(0,0,0,0.3)}.fallback-controls{position:absolute;right:8px;top:8px;display:grid;grid-template-columns:repeat(2,34px);gap:6px}.fallback-controls button{padding:5px;background:rgba(255,255,255,0.92);color:#1d1d1f;border:0;border-radius:9px;box-shadow:0 1px 4px rgba(0,0,0,0.16)}.attribution{position:absolute;right:0;bottom:0;padding:2px 4px;font-size:10px;background:rgba(255,255,255,0.85);color:#6e6e73}@media(max-width:640px){.map{min-height:440px}.map-preview{right:8px;bottom:55px;width:calc(100% - 16px);max-height:330px;padding:12px}.map-tools{gap:6px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.map-tools::-webkit-scrollbar{display:none}.map-tools input{min-width:0;flex:1 1 140px;width:auto}.segmented button{padding:7px}.segmented{flex:0 0 auto}.xray{flex:0 0 auto}.map-caption{font-size:9px}}
</style>
