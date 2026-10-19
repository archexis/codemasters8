# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ux-geometry.spec.ts >> new phase has unknown legal scope and does not inherit whole-complex factors
- Location: tests\e2e\ux-geometry.spec.ts:61:1

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByText('Очереди и применимость документов', { exact: true })
    2 × waiting for "http://127.0.0.1:5176/" navigation to finish...
      - navigated to "http://127.0.0.1:5176/#/complexes/SQ-002"
      - waiting for navigation to finish...
      - navigated to "http://127.0.0.1:5176/#/complexes/SQ-002"
      - waiting for "http://127.0.0.1:5176/" navigation to finish...
      - navigated to "http://127.0.0.1:5176/#/complexes/SQ-002"
      - waiting for "http://127.0.0.1:5176/" navigation to finish...
      - navigated to "http://127.0.0.1:5176/#/complexes/SQ-002"
      - waiting for "http://127.0.0.1:5176/" navigation to finish...
      - navigated to "http://127.0.0.1:5176/#/complexes/SQ-002"
    10 × waiting for "http://127.0.0.1:5176/" navigation to finish...
       - navigated to "http://127.0.0.1:5176/#/complexes/SQ-002"
    2 × waiting for navigation to finish...
      - navigated to "http://127.0.0.1:5176/#/complexes/SQ-002"
    2 × waiting for "http://127.0.0.1:5176/" navigation to finish...
      - navigated to "http://127.0.0.1:5176/#/complexes/SQ-002"
    - waiting for "http://127.0.0.1:5176/" navigation to finish...

```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test';
  2  | 
  3  | test('2.5D replaces seed points with clickable schematic boxes and restores points in 2D',async({page})=>{
  4  |   await page.route('**/src/components/RiskMap.svelte*',async route=>{
  5  |     const response=await route.fetch();const source=await response.text();
  6  |     await route.fulfill({response,body:source.replace('map = new ml.Map(', 'map = window.__uxGeometryMap = new ml.Map(')});
  7  |   });
  8  |   await page.goto('/#/map');
  9  |   await expect(page.locator('.map-wrap')).toHaveAttribute('data-map-ready','true',{timeout:15000});
  10 |   await page.getByRole('button',{name:'2.5D',exact:true}).click();
  11 |   await expect.poll(()=>page.evaluate(()=>{
  12 |     const map=(window as any).__uxGeometryMap;
  13 |     return {points:map.getLayoutProperty('points','visibility'),clusters:map.getLayoutProperty('clusters','visibility'),buildings:map.getLayoutProperty('buildings','visibility'),rendered:map.queryRenderedFeatures({layers:['buildings']}).length>0,zoom:map.getZoom()>=14.4};
  14 |   })).toMatchObject({points:'none',clusters:'none',buildings:'visible',rendered:true,zoom:true});
  15 |   const box=await page.evaluate(()=>{const map=(window as any).__uxGeometryMap;return map.getSource('footprints').serialize().data.features.find((f:any)=>f.properties.id==='SQ-001');});
  16 |   expect(box.properties).toMatchObject({height:36,approximateFootprint:true,approximateHeight:true});
  17 |   await page.evaluate(()=>{
  18 |     const map=(window as any).__uxGeometryMap;
  19 |     map.jumpTo({center:[82.6132,49.9841],zoom:17,pitch:55});
  20 |   });
  21 |   await expect.poll(()=>page.evaluate(()=>(window as any).__uxGeometryMap.queryRenderedFeatures({layers:['buildings']}).some((f:any)=>f.properties.id==='SQ-001'))).toBe(true);
  22 |   const canvas=page.locator('.maplibregl-canvas');const bounds=await canvas.boundingBox();
  23 |   await canvas.click({position:{x:bounds!.width/2,y:bounds!.height/2-12}});
  24 |   await expect(page.getByRole('complementary',{name:'Предпросмотр ЖК'})).toContainText('Условная 3D-коробка');
  25 |   await page.getByRole('button',{name:'2D',exact:true}).click();
  26 |   await expect.poll(()=>page.evaluate(()=>{
  27 |     const map=(window as any).__uxGeometryMap;return [map.getLayoutProperty('points','visibility'),map.getLayoutProperty('clusters','visibility'),map.getLayoutProperty('buildings','visibility')];
  28 |   })).toEqual(['visible','visible','none']);
  29 | });
  30 | 
  31 | test('manual GeoJSON import persists and feeds a real fill-extrusion layer', async ({ page }) => {
  32 |   // Capture the actual MapLibre instance in this test's served module only. The shipped component has no test globals.
  33 |   await page.route('**/src/components/RiskMap.svelte*', async route => {
  34 |     const response = await route.fetch(); const source = await response.text();
  35 |     await route.fulfill({ response, body: source.replace('map = new ml.Map(', 'map = window.__uxGeometryMap = new ml.Map(') });
  36 |   });
  37 |   await page.goto('/#/registries');
  38 |   await page.getByRole('button', { name: 'Импорт GeoJSON', exact: true }).click();
  39 |   const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Контур для 2.5D-карты', exact: true }) });
  40 |   await form.getByLabel(/^ЖК/).selectOption('SQ-001');
  41 |   await form.getByLabel('Источник и дата проверки контура', { exact: true }).fill('DEMO геодезический контур · 2026-10-19');
  42 |   await form.getByLabel('Высота в метрах, если установлена', { exact: true }).fill('48');
  43 |   await form.getByLabel('GeoJSON Polygon (WGS84)', { exact: true }).fill(JSON.stringify({ type: 'Polygon', coordinates: [[[82.613, 49.984], [82.6135, 49.984], [82.6135, 49.9844], [82.613, 49.9844], [82.613, 49.984]]] }));
  44 |   await form.getByLabel('Я проверил контур и его источник', { exact: true }).check();
  45 |   await form.getByRole('button', { name: 'Сохранить контур', exact: true }).click();
  46 |   await expect(form.getByRole('status')).toContainText('Контур сохранён');
  47 |   await page.reload();
  48 |   const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state.geometries);
  49 |   expect(saved).toHaveLength(1); expect(saved[0]).toMatchObject({ complexId: 'SQ-001', heightMeters: 48, verified: true });
  50 |   await page.goto('/#/map');
  51 |   await expect(page.locator('.map-wrap')).toHaveAttribute('data-map-ready', 'true', { timeout: 15000 });
  52 |   await expect(page.getByRole('button', { name: '2.5D', exact: true })).toBeEnabled();
  53 |   await page.getByRole('button', { name: '2.5D', exact: true }).click();
  54 |   await page.evaluate(() => (window as any).__uxGeometryMap.jumpTo({ center: [82.6132, 49.9842], zoom: 16, pitch: 55 }));
  55 |   await expect.poll(() => page.evaluate(() => {
  56 |     const map = (window as any).__uxGeometryMap;
  57 |     return { type: map.getLayer('buildings')?.type, visibility: map.getLayoutProperty('buildings', 'visibility'), feature: map.getSource('footprints').serialize().data.features[0]?.properties, rendered: map.queryRenderedFeatures({ layers: ['buildings'] }).length > 0 };
  58 |   })).toMatchObject({ type: 'fill-extrusion', visibility: 'visible', feature: { id: 'SQ-001', height: 48 }, rendered: true });
  59 | });
  60 | 
  61 | test('new phase has unknown legal scope and does not inherit whole-complex factors', async ({ page }) => {
  62 |   await page.goto('/#/complexes/SQ-002');
> 63 |   await page.getByText('Очереди и применимость документов', { exact: true }).click();
     |                                                                              ^ Error: locator.click: Test timeout of 60000ms exceeded.
  64 |   await page.getByLabel('Название новой очереди', { exact: true }).fill('DEMO отдельная очередь');
  65 |   await page.getByRole('button', { name: 'Добавить очередь', exact: true }).click();
  66 |   await expect(page).toHaveURL(/phase=PH-/);
  67 |   await expect(page.locator('.risk-score strong')).toHaveText('0');
  68 |   await expect(page.locator('.dossier-context')).toContainText('Правовое основание не установлено');
  69 |   await page.reload();
  70 |   await expect(page.locator('.risk-score strong')).toHaveText('0');
  71 |   await expect(page.getByLabel('Область проверки')).toContainText('DEMO отдельная очередь');
  72 | });
  73 | 
```