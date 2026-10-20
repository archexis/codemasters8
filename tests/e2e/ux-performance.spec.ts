import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { initialState } from '../../src/lib/domain';
import { loadStateFromText } from '../../src/lib/state-migrations';

test('D1 browser cached UI timing and five-cycle heap sanity', async ({ page, context }, info) => {
  test.setTimeout(180000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const state = initialState(); const original = state.complexes[0]; const originalAd = state.ads[0];
  state.complexes = Array.from({ length: 100 }, (_, i) => ({ ...structuredClone(original), factors: [], events: [], id: `D1-${String(i).padStart(3, '0')}`, name: `DEMO D1 объект ${i}`, lat: 49.984 + (i % 10) * .001, lng: 82.614 + Math.floor(i / 10) * .001 }));
  state.ads = Array.from({ length: 1000 }, (_, i) => ({ ...structuredClone(originalAd), id: `D1-AD-${i}`, zkId: state.complexes[i % 100].id, text: `DEMO публикация ${i}: бронь квартиры 500000 тенге.` }));
  state.audit = []; state.signals = {}; state.signalVersions = {}; state.cases = []; state.caseSnapshots = []; state.artifacts = []; state.claims = []; state.assertions = []; state.phases = []; state.media = []; state.relations = [];
  state.artifacts = Array.from({ length: 10000 }, (_, i) => ({ id: `D1-EVENT-${i}`, complexId: state.complexes[i % 100].id, kind: 'observation' as const, source: 'DEMO датированный осмотр', text: `DEMO событие наблюдения ${i}; автоматическая оценка готовности отсутствует.`, date: '2026-10-01', capturedAt: '2026-10-02T10:00:00.000Z', origin: 'demo' as const }));
  loadStateFromText(JSON.stringify(state));
  await page.addInitScript(data => { localStorage.setItem('sq_svelte_demo_v2', JSON.stringify({ envelope: 1, state: data, version: 0, receipts: {} })); sessionStorage.removeItem('saq-map-view-v1'); }, state);
  // Keep basemap networking out of cached control measurements. This is not a realistic raster/GPU FPS benchmark.
  await page.route('https://tile.openstreetmap.org/**', r => r.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') }));
  await page.goto('/#/map', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.map-caption')).toContainText('100 объектов');
  await expect(page.locator('.maplibregl-canvas,.fallback-map').first()).toBeVisible();
  await expect(page.locator('.map-wrap')).toHaveAttribute('data-map-ready', 'true', { timeout: 15000 });
  const mapRendering = await page.locator('.fallback-map').isVisible() ? 'dom-fallback' : 'maplibre-webgl';
  await page.getByRole('button',{name:'Слои и фильтры',exact:true}).click();
  const xray = await page.evaluate(async () => {
    const samples: number[] = [];
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.xray button')];
    for (let i = 0; i < 20; i++) { const start = performance.now(); buttons[i % buttons.length].click(); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); samples.push(performance.now() - start); }
    return samples;
  });
  await page.goto('/#/complexes/D1-000?tab=overview', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tab', { name: 'Обзор', exact: true })).toBeVisible();
  // Warm the lazy modules once, separately from the measured cached shell switches.
  await page.getByRole('tab', { name: 'Связи', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Граф связей выбранного объекта' })).toBeVisible();
  await page.getByRole('tab', { name: 'Хронология', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Сравнить два периода' })).toBeVisible();
  const session = await context.newCDPSession(page);
  await session.send('HeapProfiler.collectGarbage');
  const heapBefore = await session.send('Runtime.getHeapUsage');
  const shell = await page.evaluate(async () => {
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('.dossier-tabs [role=tab]')];
      const target = buttons.find(b => b.textContent?.trim() === (i % 2 ? 'Хронология' : 'Связи'))!;
      const start = performance.now(); target.click(); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); samples.push(performance.now() - start);
    }
    return samples;
  });
  for (let i = 0; i < 5; i++) {
    await page.getByRole('tab', { name: 'Связи', exact: true }).click(); await expect(page.getByRole('img', { name: 'Граф связей выбранного объекта' })).toBeVisible();
    await page.getByRole('tab', { name: 'Хронология', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Сравнить два периода' })).toBeVisible();
  }
  await session.send('HeapProfiler.collectGarbage');
  const heapAfter = await session.send('Runtime.getHeapUsage');
  const environment = await page.evaluate(() => ({ userAgent: navigator.userAgent, logicalCPUs: navigator.hardwareConcurrency, viewport: { width: innerWidth, height: innerHeight }, devicePixelRatio }));
  const stats = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return { p50Ms: sorted[Math.ceil(sorted.length * .5) - 1], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], samples: values }; };
  const result = { measuredAt: new Date().toISOString(), project: info.project.name, profile: { complexes: 100, publications: 1000, events: 10000, imageCacheMB: 0 }, environment, mapRendering, xrayCachedUI: stats(xray), dossierCachedShell: stats(shell), fiveFurtherTabCyclesHeap: { beforeUsedBytes: heapBefore.usedSize, afterUsedBytes: heapAfter.usedSize, deltaBytes: heapAfter.usedSize - heapBefore.usedSize, forcedGC: true }, errors, limitations: ['D1 entity/event counts; 5–10MB image cache is not included.', 'Headless Chromium on execution host; hardware is not asserted to match reference D1 PC.', 'Basemap tiles are stubbed with a tiny PNG to isolate cached UI controls.', 'Timings measure DOM control activation to two animation frames; map worker/GPU completion is not measured.', 'Cold-start timing, sustained FPS, WebGL draw calls, and actual device GPU memory are not measured.', 'Single browser process; 20 samples are a sanity check, not a production performance guarantee.'] };
  await mkdir('test-results/score-maxxing/artifacts/ux', { recursive: true });
  await writeFile(`test-results/score-maxxing/artifacts/ux/performance-${info.project.name}.json`, JSON.stringify(result, null, 2));
  await info.attach('D1-performance-sanity', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
});
