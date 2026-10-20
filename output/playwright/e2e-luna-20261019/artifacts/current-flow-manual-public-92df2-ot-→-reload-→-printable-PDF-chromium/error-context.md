# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: current-flow.spec.ts >> manual publication → human R2 verification → confirmed snapshot → reload → printable PDF
- Location: output\playwright\e2e-luna-20261019\current-flow.spec.ts:6:1

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.fill: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByLabel('Текст объявления', { exact: true })
    - waiting for "http://127.0.0.1:5176/" navigation to finish...
    - navigated to "http://127.0.0.1:5176/#/publications?add=1&complex=SQ-001"

```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test';
  2   | import { mkdir } from 'node:fs/promises';
  3   | 
  4   | const output = 'C:/Users/BIGra/codemasters8/output/playwright/e2e-luna-20261019';
  5   | 
  6   | test('manual publication → human R2 verification → confirmed snapshot → reload → printable PDF', async ({ page }, info) => {
  7   |   const quote = 'Платная бронь квартиры 654 321 тенге до сдачи дома.';
  8   |   await page.goto('/#/publications?add=1&complex=SQ-001', { waitUntil: 'domcontentloaded' });
> 9   |   await page.getByLabel('Текст объявления', { exact: true }).fill(quote);
      |                                                              ^ Error: locator.fill: Test timeout of 60000ms exceeded.
  10  |   await page.getByLabel('Площадка', { exact: true }).fill(`Luna E2E ${info.project.name}`);
  11  |   await page.getByLabel('Дата публикации (пусто — не указана)', { exact: true }).fill('2026-10-19');
  12  |   await page.getByRole('button', { name: 'Сохранить материал без AI', exact: true }).click();
  13  |   await expect(page.getByText(/Материал сохранён|Публикация сохранена/).first()).toBeVisible();
  14  | 
  15  |   await page.goto('/#/complexes/SQ-001?tab=verification', { waitUntil: 'domcontentloaded' });
  16  |   await page.getByRole('button', { name: 'Начать расследование', exact: true }).click();
  17  |   await expect(page).toHaveURL(/#\/cases\/CASE-/);
  18  |   const manual = page.locator('details').filter({ has: page.getByText('Выделить утверждение вручную', { exact: true }) });
  19  |   await manual.locator('summary').click();
  20  |   await manual.getByLabel('Первичный материал').selectOption({ label: `Luna E2E ${info.project.name}` });
  21  |   await manual.getByLabel('Фактор').selectOption('R2');
  22  |   await page.getByLabel('Точная цитата', { exact: true }).fill(quote);
  23  |   await page.getByRole('button', { name: 'Создать кандидата', exact: true }).click();
  24  |   await expect(page.locator('.risk-score strong')).toHaveText('0');
  25  |   await page.getByLabel('Обоснование проверки факта', { exact: true }).fill('Источник и дословное предложение о платной брони проверены.');
  26  |   await page.getByRole('button', { name: 'Подтвердить факт R2', exact: true }).click();
  27  |   await expect(page.locator('.risk-score strong')).toHaveText('25');
  28  | 
  29  |   await page.getByRole('button', { name: 'Предпросмотр сигнала', exact: true }).click();
  30  |   await expect(page.locator('.case-signal-sheet')).toContainText(quote);
  31  |   await page.getByLabel('Обоснование решения', { exact: true }).fill('Первоисточник проверен, R2 подтверждён аналитиком.');
  32  |   await page.getByRole('button', { name: 'Подтвердить сигнал', exact: true }).click();
  33  |   await expect(page.locator('.case-signal-sheet')).toContainText('Версия 1');
  34  |   await expect(page.locator('.case-signal-sheet')).toContainText('Подтверждён');
  35  |   await page.reload({ waitUntil: 'domcontentloaded' });
  36  |   await page.getByRole('button', { name: 'Предпросмотр сигнала', exact: true }).click();
  37  |   await expect(page.locator('.case-signal-sheet .risk-score strong')).toHaveText('25');
  38  |   await expect(page.locator('.case-signal-sheet')).toContainText(quote);
  39  | 
  40  |   await page.emulateMedia({ media: 'print' });
  41  |   await expect(page.locator('.case-signal-sheet')).toBeVisible();
  42  |   await expect(page.getByRole('button', { name: /Печать \/ сохранить PDF/ })).toBeHidden();
  43  |   await mkdir(`${output}/pdf`, { recursive: true });
  44  |   const pdfPath = `${output}/pdf/confirmed-${info.project.name}.pdf`;
  45  |   await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
  46  |   await info.attach('printed-pdf-path', { body: pdfPath, contentType: 'text/plain' });
  47  | });
  48  | 
  49  | test('returned signal reason and version survive reload', async ({ page }) => {
  50  |   await page.goto('/#/complexes/SQ-002', { waitUntil: 'domcontentloaded' });
  51  |   await page.getByRole('button', { name: 'Начать расследование', exact: true }).click();
  52  |   await page.getByRole('button', { name: 'Предпросмотр сигнала', exact: true }).click();
  53  |   await page.getByLabel('Обоснование решения', { exact: true }).fill('Нужна дополнительная сверка исходных материалов.');
  54  |   await page.getByRole('button', { name: 'Вернуть на проверку', exact: true }).click();
  55  |   await expect(page.locator('.case-signal-sheet')).toContainText('Версия 1');
  56  |   await expect(page.locator('.case-signal-sheet')).toContainText('Возвращён');
  57  |   await page.reload({ waitUntil: 'domcontentloaded' });
  58  |   await page.getByRole('button', { name: 'Предпросмотр сигнала', exact: true }).click();
  59  |   await expect(page.locator('.case-signal-sheet')).toContainText('Нужна дополнительная сверка исходных материалов.');
  60  | });
  61  | 
  62  | test('WebGL fallback renders markers and opens a dossier preview', async ({ page }) => {
  63  |   await page.addInitScript(() => {
  64  |     const original = HTMLCanvasElement.prototype.getContext;
  65  |     HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
  66  |       if (type.includes('webgl')) return null;
  67  |       return original.apply(this, [type, ...args] as any);
  68  |     } as any;
  69  |   });
  70  |   await page.goto('/#/map', { waitUntil: 'domcontentloaded' });
  71  |   const map = page.getByRole('region', { name: 'Карта объектов', exact: true });
  72  |   await expect(map.getByLabel('Двумерная карта без WebGL')).toBeVisible();
  73  |   await expect(map.getByRole('button', { name: '2.5D', exact: true })).toBeDisabled();
  74  |   await expect(map.locator('.fallback-point').first()).toBeVisible();
  75  |   await map.locator('.fallback-point').first().click();
  76  |   await expect(map.getByRole('complementary', { name: 'Предпросмотр ЖК' })).toBeVisible();
  77  |   await expect(map.getByRole('button', { name: 'Открыть досье', exact: true })).toBeVisible();
  78  | });
  79  | 
  80  | test('WebGL fallback zoom control receives a real pointer click', async ({ page }) => {
  81  |   await page.addInitScript(() => {
  82  |     const original = HTMLCanvasElement.prototype.getContext;
  83  |     HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
  84  |       if (type.includes('webgl')) return null;
  85  |       return original.apply(this, [type, ...args] as any);
  86  |     } as any;
  87  |   });
  88  |   await page.goto('/#/map', { waitUntil: 'domcontentloaded' });
  89  |   const map = page.getByRole('region', { name: 'Карта объектов', exact: true });
  90  |   await expect(map.getByLabel('Двумерная карта без WebGL')).toBeVisible();
  91  |   const zoom = map.getByRole('button', { name: 'Приблизить', exact: true });
  92  |   await expect(zoom).toBeEnabled();
  93  |   const before = await page.locator('.map-caption').innerText();
  94  |   await zoom.click({ timeout: 5000 });
  95  |   const after = await page.locator('.map-caption').innerText();
  96  |   expect(await page.locator('.fallback-map').isVisible()).toBe(true);
  97  |   expect(before).toBeTruthy();
  98  |   expect(after).toBeTruthy();
  99  | });
  100 | 
```