import seed from '../../src/lib/seed.json' with {type:'json'};
import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test.use({trace:'on'});

test('target map: one X-Ray theme, preview, dossier and retained view', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const target=seed.COMPLEXES.find(z=>z.id==='SQ-001')!;
  await page.route('**/src/components/RiskMap.svelte*',async route=>{
    const response=await route.fetch(),source=await response.text();
    await route.fulfill({response,body:source.replace('map = new ml.Map(', 'map = window.__targetMap = new ml.Map(')});
  });
  await page.goto('/#/map',{waitUntil:'domcontentloaded'});
  const map = page.getByRole('region', { name: 'Карта объектов', exact: true });
  await expect(map).toBeVisible();
  await expect(map.getByLabel('Поиск ЖК, БИН или адреса на карте')).toBeVisible();
  await expect(page.getByRole('button',{name:'Слои и фильтры',exact:true})).toHaveAttribute('aria-expanded','false');
  await map.getByLabel('Поиск ЖК, БИН или адреса на карте').fill(target.name);
  await expect(map.getByRole('button',{name:'Список · 1',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Слои и фильтры',exact:true}).click();
  await map.getByLabel('Поиск ЖК, БИН или адреса на карте').fill(seed.COMPLEXES.find(z=>z.id==='SQ-001')!.name);
  const started = Date.now();
  await map.getByRole('button', { name: 'Правовой', exact: true }).click();
  await expect(map.getByRole('button', { name: 'Правовой', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(map.getByRole('button', { name: 'Стройка', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(map.locator('.map-legend')).toContainText('Требует проверки');
  await expect(map.locator('.map-wrap')).toHaveAttribute('data-map-ready', 'true', { timeout: 15000 });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.keyboard.press('Escape');
  if (await map.locator('.fallback-map').isVisible()) await map.locator('.fallback-point').first().click();
  else {
    // Project the actual seed location; a camera-centre pixel is not a stable marker locator.
    await page.evaluate(({lat,lng})=>(window as any).__targetMap.jumpTo({center:[lng,lat],zoom:15}),target);
    await expect.poll(()=>page.evaluate(()=>(window as any).__targetMap.queryRenderedFeatures({layers:['points']}).some((f:any)=>f.properties.id==='SQ-001'))).toBe(true);
    const position=await page.evaluate(({lat,lng})=>{const p=(window as any).__targetMap.project([lng,lat]);return {x:p.x,y:p.y};},target);
    await map.locator('.maplibregl-canvas').click({position});
  }
  const preview = map.getByRole('complementary', { name: 'Предпросмотр ЖК' });
  await expect(preview).toContainText(seed.COMPLEXES.find(z=>z.id==='SQ-001')!.name);
  await expect(preview).toContainText('требует проверки');
  await expect(map.getByText('Загрузка карты…', { exact: true })).toHaveCount(0, { timeout: 15000 });
  await mkdir('test-results/score-maxxing/artifacts/ux/screenshots', { recursive: true });
  if (info.project.name === 'chromium') await page.screenshot({ path: 'test-results/score-maxxing/artifacts/ux/screenshots/desktop-map.png', fullPage: true });
  await preview.getByRole('button', { name: 'Открыть досье', exact: true }).click();
  await expect(page).toHaveURL(/#\/complexes\/SQ-001/);
  await expect(page.getByRole('heading', { name: seed.COMPLEXES.find(z=>z.id==='SQ-001')!.name, exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/score-maxxing/artifacts/ux/screenshots/${info.project.name === 'mobile' ? 'mobile' : 'desktop'}-dossier.png`, fullPage: true });
  await page.goto('/#/map',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Слои и фильтры',exact:true}).click();
  await expect(map.getByLabel('Поиск ЖК, БИН или адреса на карте')).toHaveValue(seed.COMPLEXES.find(z=>z.id==='SQ-001')!.name);
  await expect(map.getByRole('button', { name: 'Правовой', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await info.attach('map-interaction-sanity', { body: JSON.stringify({ browser: info.project.name, elapsedMs: Date.now() - started, note: 'End-to-end elapsed including route changes; not p95 or FPS' }), contentType: 'application/json' });
  expect(errors).toEqual([]);
});

test.describe('fallback acceptance',()=>{
 test('target map: disabled WebGL retains a usable 2D map, markers and zoom', async ({ page },info) => {
  await page.setViewportSize(info.project.name==='mobile'?{width:390,height:664}:{width:1280,height:720});
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type.includes('webgl')) return null;
      return original.apply(this, [type, ...args] as any);
    } as any;
  });
  await page.goto('/#/map',{waitUntil:'domcontentloaded'});
  const map = page.getByRole('region', { name: 'Карта объектов', exact: true });
  await expect(map.getByLabel('Двумерная карта без WebGL')).toBeVisible();
  await page.getByRole('button', { name: 'Слои и фильтры', exact: true }).click();
  await expect(map.getByRole('button', { name: '3D', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  const zoom=map.getByRole('button',{name:'Приблизить',exact:true});
  await expect(map.locator('.map-tools')).toBeHidden();
  expect(await zoom.evaluate(button=>{const r=button.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===button;})).toBe(true);
  await zoom.click();
  await map.getByRole('button', { name: 'Отдалить', exact: true }).click();
  await page.getByRole('button', { name: 'Слои и фильтры', exact: true }).click();
  await map.getByRole('button', { name: 'Реклама', exact: true }).click();
  await map.getByLabel('Поиск ЖК, БИН или адреса на карте').fill('Лунный сад');
  await page.keyboard.press('Escape');
  await expect(map.locator('.fallback-point')).toHaveCount(1);
  await map.locator('.fallback-point').click();
  await expect(map.getByRole('complementary', { name: 'Предпросмотр ЖК' })).toBeVisible();
  await page.screenshot({path:info.outputPath('fallback-map.png'),fullPage:true});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 });
});

test('target navigation: three top-level sections and publications original stays separate from score', async ({ page }) => {
  await page.goto('/#/publications',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('heading', { name: 'Публикации', exact: true })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Меню', exact: true });
  if (await menu.isVisible()) await menu.click();
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' });
  await expect(navigation.getByRole('link')).toHaveCount(3);
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Оригинал и гипотезы', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Оригинал публикации', exact: true })).toBeVisible();
  await expect(page.getByText('Принятие гипотезы не начисляет баллы. Факт проверяется в активном деле.')).toHaveCount(0);
  await page.getByRole('link', { name: 'Открыть проверку в досье', exact: true }).click();
  await expect(page).toHaveURL(/#\/complexes\/[^?]+\?.*tab=verification/);
});

test('target cases: isolated draft cannot confirm inherited facts and returned snapshot survives reload', async ({ page }) => {
  await page.goto('/#/complexes/SQ-001',{waitUntil:'domcontentloaded'});
  await page.getByRole('button', { name: 'Начать расследование', exact: true }).click();
  await expect(page).toHaveURL(/#\/cases\/CASE-/);
  await expect(page.locator('.case-toolbar')).toContainText('В работе');
  await page.getByRole('button', { name: 'Предпросмотр сигнала', exact: true }).click();
  await expect(page.locator('.case-signal-sheet .risk-score strong')).toHaveText('0');
  await page.getByLabel('Обоснование решения', { exact: true }).fill('Нужна ручная проверка первичных материалов.');
  await page.getByRole('button', { name: 'Подтвердить сигнал', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Нет подтверждённых факторов');
  await page.getByRole('button', { name: 'Вернуть на проверку', exact: true }).click();
  await expect(page.locator('.case-signal-sheet')).toContainText('Версия 1');
  await expect(page.locator('.case-signal-sheet')).toContainText('Возвращён');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('button', { name: 'Предпросмотр сигнала', exact: true }).click();
  await expect(page.locator('.case-signal-sheet')).toContainText('Нужна ручная проверка первичных материалов.');
  await page.getByLabel('Обоснование решения', { exact: true }).fill('Начать повторную сверку.');
  await page.getByRole('button', { name: 'Открыть пересмотр', exact: true }).click();
  await expect(page.locator('.case-signal-sheet')).toContainText('Предпросмотр черновика');
});

test('target vertical flow: manual publication becomes evidence and verified R2 in a versioned case', async ({ page }) => {
  const quote = 'Платная бронь квартиры 987 650 тенге до сдачи дома.';
  await page.goto('/#/publications?add=1&complex=SQ-001',{waitUntil:'domcontentloaded'});
  await page.getByLabel('Текст объявления', { exact: true }).fill(quote);
  await page.getByLabel('Площадка', { exact: true }).fill('Ручной источник E2E');
  await page.getByLabel('Дата публикации (пусто — не указана)', { exact: true }).fill('2026-10-19');
  await page.getByRole('button', { name: 'Сохранить материал без AI', exact: true }).click();
  await expect(page.getByText(/Материал сохранён|Публикация сохранена/).first()).toBeVisible();
  await page.goto('/#/complexes/SQ-001?tab=verification',{waitUntil:'domcontentloaded'});
  await page.getByRole('button', { name: 'Начать расследование', exact: true }).click();
  await expect(page).toHaveURL(/#\/cases\/CASE-/);
  await expect(page.locator('.case-toolbar')).toContainText('В работе');
  const manual = page.locator('details').filter({ has: page.getByText('Выделить утверждение вручную', { exact: true }) });
  await manual.locator('summary').click();
  await expect(manual).toHaveAttribute('open', '');
  await manual.getByLabel('Первичный материал').selectOption({ label: 'Ручной источник E2E' });
  await manual.getByLabel('Фактор').selectOption('R2');
  await page.getByLabel('Точная цитата', { exact: true }).fill(quote);
  await page.getByRole('button', { name: 'Создать кандидата', exact: true }).click();
  await expect(page.locator('.hypothesis').filter({ hasText: quote })).toContainText('Кандидат');
  await expect(page.locator('.risk-score strong')).toHaveText('35');
  await page.locator('.hypothesis').filter({has:page.locator('blockquote').filter({hasText:'Платная бронь квартиры 987 650'})}).getByLabel('Обоснование проверки факта', { exact: true }).fill('Дословная цитата содержит предложение платной брони.');
  await page.locator('.hypothesis').filter({has:page.locator('blockquote').filter({hasText:'Платная бронь квартиры 987 650'})}).getByRole('button',{name:'Подтвердить факт R2',exact:true}).click();
  await expect(page.locator('.risk-score strong')).toHaveText('25');
  await page.getByRole('button', { name: 'Предпросмотр сигнала', exact: true }).click();
  await expect(page.locator('.case-signal-sheet')).toContainText(quote);
  await page.getByLabel('Обоснование решения', { exact: true }).fill('Проверен первоисточник; подтверждён платёжный признак R2.');
  await page.getByRole('button', { name: 'Подтвердить сигнал', exact: true }).click();
  await expect(page.locator('.case-signal-sheet')).toContainText('Версия 1');
  await expect(page.locator('.case-signal-sheet')).toContainText('Подтверждён');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('button', { name: 'Предпросмотр сигнала', exact: true }).click();
  await expect(page.locator('.case-signal-sheet .risk-score strong')).toHaveText('25');
});
