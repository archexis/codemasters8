import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const output = 'C:/Users/BIGra/codemasters8/output/playwright/e2e-luna-20261019';

test('manual publication → human R2 verification → confirmed snapshot → reload → printable PDF', async ({ page }, info) => {
  const quote = 'Платная бронь квартиры 654 321 тенге до сдачи дома.';
  await page.goto('/#/publications?add=1&complex=SQ-001', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Текст объявления', { exact: true }).fill(quote);
  await page.getByLabel('Площадка', { exact: true }).fill(`Luna E2E ${info.project.name}`);
  await page.getByLabel('Дата публикации (пусто — не указана)', { exact: true }).fill('2026-10-19');
  await page.getByRole('button', { name: 'Сохранить материал без AI', exact: true }).click();
  await expect(page.getByText(/Материал сохранён|Публикация сохранена/).first()).toBeVisible();

  await page.goto('/#/complexes/SQ-001?tab=verification', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Начать расследование', exact: true }).click();
  await expect(page).toHaveURL(/#\/cases\/CASE-/);
  const manual = page.locator('details').filter({ has: page.getByText('Выделить утверждение вручную', { exact: true }) });
  await manual.locator('summary').click();
  await manual.getByLabel('Первичный материал').selectOption({ label: `Luna E2E ${info.project.name}` });
  await manual.getByLabel('Фактор').selectOption('R2');
  await page.getByLabel('Точная цитата', { exact: true }).fill(quote);
  await page.getByRole('button', { name: 'Создать кандидата', exact: true }).click();
  await expect(page.locator('.risk-score strong')).toHaveText('0');
  await page.getByLabel('Обоснование проверки факта', { exact: true }).fill('Источник и дословное предложение о платной брони проверены.');
  await page.getByRole('button', { name: 'Подтвердить факт R2', exact: true }).click();
  await expect(page.locator('.risk-score strong')).toHaveText('25');

  await page.getByRole('button', { name: 'Предпросмотр сигнала', exact: true }).click();
  await expect(page.locator('.case-signal-sheet')).toContainText(quote);
  await page.getByLabel('Обоснование решения', { exact: true }).fill('Первоисточник проверен, R2 подтверждён аналитиком.');
  await page.getByRole('button', { name: 'Подтвердить сигнал', exact: true }).click();
  await expect(page.locator('.case-signal-sheet')).toContainText('Версия 1');
  await expect(page.locator('.case-signal-sheet')).toContainText('Подтверждён');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Предпросмотр сигнала', exact: true }).click();
  await expect(page.locator('.case-signal-sheet .risk-score strong')).toHaveText('25');
  await expect(page.locator('.case-signal-sheet')).toContainText(quote);

  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.case-signal-sheet')).toBeVisible();
  await expect(page.getByRole('button', { name: /Печать \/ сохранить PDF/ })).toBeHidden();
  await mkdir(`${output}/pdf`, { recursive: true });
  const pdfPath = `${output}/pdf/confirmed-${info.project.name}.pdf`;
  await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
  await info.attach('printed-pdf-path', { body: pdfPath, contentType: 'text/plain' });
});

test('returned signal reason and version survive reload', async ({ page }) => {
  await page.goto('/#/complexes/SQ-002', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Начать расследование', exact: true }).click();
  await page.getByRole('button', { name: 'Предпросмотр сигнала', exact: true }).click();
  await page.getByLabel('Обоснование решения', { exact: true }).fill('Нужна дополнительная сверка исходных материалов.');
  await page.getByRole('button', { name: 'Вернуть на проверку', exact: true }).click();
  await expect(page.locator('.case-signal-sheet')).toContainText('Версия 1');
  await expect(page.locator('.case-signal-sheet')).toContainText('Возвращён');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Предпросмотр сигнала', exact: true }).click();
  await expect(page.locator('.case-signal-sheet')).toContainText('Нужна дополнительная сверка исходных материалов.');
});

test('WebGL fallback renders markers and opens a dossier preview', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type.includes('webgl')) return null;
      return original.apply(this, [type, ...args] as any);
    } as any;
  });
  await page.goto('/#/map', { waitUntil: 'domcontentloaded' });
  const map = page.getByRole('region', { name: 'Карта объектов', exact: true });
  await expect(map.getByLabel('Двумерная карта без WebGL')).toBeVisible();
  await expect(map.getByRole('button', { name: '2.5D', exact: true })).toBeDisabled();
  await expect(map.locator('.fallback-point').first()).toBeVisible();
  await map.locator('.fallback-point').first().click();
  await expect(map.getByRole('complementary', { name: 'Предпросмотр ЖК' })).toBeVisible();
  await expect(map.getByRole('button', { name: 'Открыть досье', exact: true })).toBeVisible();
});

test('WebGL fallback zoom control receives a real pointer click', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type.includes('webgl')) return null;
      return original.apply(this, [type, ...args] as any);
    } as any;
  });
  await page.goto('/#/map', { waitUntil: 'domcontentloaded' });
  const map = page.getByRole('region', { name: 'Карта объектов', exact: true });
  await expect(map.getByLabel('Двумерная карта без WebGL')).toBeVisible();
  const zoom = map.getByRole('button', { name: 'Приблизить', exact: true });
  await expect(zoom).toBeEnabled();
  const before = await page.locator('.map-caption').innerText();
  await zoom.click({ timeout: 5000 });
  const after = await page.locator('.map-caption').innerText();
  expect(await page.locator('.fallback-map').isVisible()).toBe(true);
  expect(before).toBeTruthy();
  expect(after).toBeTruthy();
});
