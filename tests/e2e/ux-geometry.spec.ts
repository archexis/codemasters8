import { expect, test } from '@playwright/test';

test('2.5D replaces seed points with clickable schematic boxes and restores points in 2D',async({page})=>{
  await page.route('**/src/components/RiskMap.svelte*',async route=>{
    const response=await route.fetch();const source=await response.text();
    await route.fulfill({response,body:source.replace('map = new ml.Map(', 'map = window.__uxGeometryMap = new ml.Map(')});
  });
  await page.goto('/#/map',{waitUntil:'domcontentloaded'});
  await expect(page.locator('.map-wrap')).toHaveAttribute('data-map-ready','true',{timeout:15000});
  await page.getByRole('button',{name:'2.5D',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>{
    const map=(window as any).__uxGeometryMap;
    return {points:map.getLayoutProperty('points','visibility'),clusters:map.getLayoutProperty('clusters','visibility'),buildings:map.getLayoutProperty('buildings','visibility'),rendered:map.queryRenderedFeatures({layers:['buildings']}).length>0,zoom:map.getZoom()>=14.4};
  })).toMatchObject({points:'none',clusters:'none',buildings:'visible',rendered:true,zoom:true});
  const box=await page.evaluate(()=>{const map=(window as any).__uxGeometryMap;return map.getSource('footprints').serialize().data.features.find((f:any)=>f.properties.id==='SQ-001');});
  expect(box.properties).toMatchObject({height:36,approximateFootprint:true,approximateHeight:true});
  await page.evaluate(()=>{
    const map=(window as any).__uxGeometryMap;
    map.jumpTo({center:[82.6132,49.9841],zoom:17,pitch:55});
  });
  await expect.poll(()=>page.evaluate(()=>(window as any).__uxGeometryMap.queryRenderedFeatures({layers:['buildings']}).some((f:any)=>f.properties.id==='SQ-001'))).toBe(true);
  const canvas=page.locator('.maplibregl-canvas');const bounds=await canvas.boundingBox();
  await canvas.click({position:{x:bounds!.width/2,y:bounds!.height/2-12}});
  await expect(page.getByRole('complementary',{name:'Предпросмотр ЖК'})).toContainText('Условная 3D-коробка');
  await page.getByRole('button',{name:'2D',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>{
    const map=(window as any).__uxGeometryMap;return [map.getLayoutProperty('points','visibility'),map.getLayoutProperty('clusters','visibility'),map.getLayoutProperty('buildings','visibility')];
  })).toEqual(['visible','visible','none']);
});

test('manual GeoJSON import persists and feeds a real fill-extrusion layer', async ({ page }) => {
  // Capture the actual MapLibre instance in this test's served module only. The shipped component has no test globals.
  await page.route('**/src/components/RiskMap.svelte*', async route => {
    const response = await route.fetch(); const source = await response.text();
    await route.fulfill({ response, body: source.replace('map = new ml.Map(', 'map = window.__uxGeometryMap = new ml.Map(') });
  });
  await page.goto('/#/registries',{waitUntil:'domcontentloaded'});
  await page.getByRole('button', { name: 'Импорт GeoJSON', exact: true }).click();
  const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Контур для 2.5D-карты', exact: true }) });
  await form.getByLabel(/^ЖК/).selectOption('SQ-001');
  await form.getByLabel('Источник и дата проверки контура', { exact: true }).fill('DEMO геодезический контур · 2026-10-19');
  await form.getByLabel('Высота в метрах, если установлена', { exact: true }).fill('48');
  await form.getByLabel('GeoJSON Polygon (WGS84)', { exact: true }).fill(JSON.stringify({ type: 'Polygon', coordinates: [[[82.613, 49.984], [82.6135, 49.984], [82.6135, 49.9844], [82.613, 49.9844], [82.613, 49.984]]] }));
  await form.getByLabel('Я проверил контур и его источник', { exact: true }).check();
  await form.getByRole('button', { name: 'Сохранить контур', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('Контур сохранён');
  await page.reload({waitUntil:'domcontentloaded'});
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state.geometries);
  expect(saved).toHaveLength(1); expect(saved[0]).toMatchObject({ complexId: 'SQ-001', heightMeters: 48, verified: true });
  await page.goto('/#/map',{waitUntil:'domcontentloaded'});
  await expect(page.locator('.map-wrap')).toHaveAttribute('data-map-ready', 'true', { timeout: 15000 });
  await expect(page.getByRole('button', { name: '2.5D', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '2.5D', exact: true }).click();
  await page.evaluate(() => (window as any).__uxGeometryMap.jumpTo({ center: [82.6132, 49.9842], zoom: 16, pitch: 55 }));
  await expect.poll(() => page.evaluate(() => {
    const map = (window as any).__uxGeometryMap;
    return { type: map.getLayer('buildings')?.type, visibility: map.getLayoutProperty('buildings', 'visibility'), feature: map.getSource('footprints').serialize().data.features[0]?.properties, rendered: map.queryRenderedFeatures({ layers: ['buildings'] }).length > 0 };
  })).toMatchObject({ type: 'fill-extrusion', visibility: 'visible', feature: { id: 'SQ-001', height: 48 }, rendered: true });
});

test('new phase has unknown legal scope and does not inherit whole-complex factors', async ({ page }) => {
  await page.goto('/#/complexes/SQ-002',{waitUntil:'domcontentloaded'});
  await page.getByText('Очереди и применимость документов', { exact: true }).click();
  await page.getByLabel('Название новой очереди', { exact: true }).fill('DEMO отдельная очередь');
  await page.getByRole('button', { name: 'Добавить очередь', exact: true }).click();
  await expect(page).toHaveURL(/phase=PH-/);
  await expect(page.locator('.risk-score strong')).toHaveText('0');
  await expect(page.locator('.dossier-context')).toContainText('Правовое основание не установлено');
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.locator('.risk-score strong')).toHaveText('0');
  await expect(page.getByLabel('Область проверки')).toContainText('DEMO отдельная очередь');
});
