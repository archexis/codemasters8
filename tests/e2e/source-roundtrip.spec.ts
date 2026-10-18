/**
 * S3.4 (C4). Roundtrip источников: CSV из 4 строк (valid, bad date,
 * unknown ЖК, duplicate) → preview с точными причинами → valid сохранена →
 * reload → списки согласованы → повтор CSV без дублей.
 *
 * Создан воркером S3.2+S3.4, НЕ запускался (выполняет родитель после
 * слияния с S3.3). Опирается на testid S3.3 (csv-*) и строки S3.4
 * (csv-row-source/csv-row-dupe «Публикация/Фиксация»).
 */
import { expect, test, type Page } from '@playwright/test';

// Долгий сценарий (save + reload + re-import): mobile-проекту даём 120с
// вместо дефолтных 60с — предел среды, не логики.
test.setTimeout(120000);

const CSV = [
  'text,platform,account,date,url,zk',
  '"Бронь квартиры в строящемся доме — 500 000 тенге, сдача скоро (S3ROUND).",Krisha,test-acc,2026-10-11,https://krisha.kz/s3round-1,SQ-001',
  '"Продажи в строящемся доме, ключи в 2027 году, депозит 300 000 тенге (S3ROUND).",OLX,test-acc,2026-02-30,https://olx.kz/s3round-2,SQ-001',
  '"Обзор стройки: монолит растёт, бронь 200 000 тенге (S3ROUND).",Instagram,test-acc,,https://instagram.com/s3round-3,Неизвестный ЖК',
  '"Бронь квартиры в строящемся доме — 500 000 тенге, сдача скоро (S3ROUND).",Krisha,test-acc,2026-10-11,https://krisha.kz/s3round-1,SQ-001',
].join('\n');

const VALID_TEXT = 'Бронь квартиры в строящемся доме — 500 000 тенге, сдача скоро (S3ROUND).';

async function openCsv(page: Page) {
  await page.goto('/#/analyze/SQ-001');
  await page.getByText('Импорт из CSV').click();
  await page.getByTestId('csv-input').fill(CSV);
  await page.getByTestId('csv-preview').click();
  await expect(page.getByTestId('csv-row')).toHaveCount(4);
}

test('source roundtrip: preview → save valid → reload → re-import без дублей', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await openCsv(page);

  // Точные причины: bad date — ошибка строки; unknown ЖК — не сопоставлен;
  // duplicate (строка 5) пока без повтора — подсказок нет.
  await expect(page.locator('[data-rowid="csv-r2"]')).toContainText('Строка 3: неверная дата «2026-02-30» (нужна реальная YYYY-MM-DD)');
  await expect(page.locator('[data-rowid="csv-r2"] [data-testid="csv-select"]')).toBeDisabled();
  await expect(page.locator('[data-rowid="csv-r3"]')).toContainText('не найден — выберите вручную.');
  await expect(page.locator('[data-rowid="csv-r3"] [data-testid="csv-row-source"]')).toContainText('Публикация: не указана');
  await expect(page.locator('[data-rowid="csv-r1"] [data-testid="csv-row-source"]')).toContainText('Публикация: 2026-10-11');
  await expect(page.locator('[data-rowid="csv-r1"]')).toContainText('ЖК сопоставлен по ID');
  await expect(page.locator('[data-rowid="csv-r4"] [data-testid="csv-row-dupe"]')).toHaveCount(0);

  // Unknown-ЖК не наследует предыдущий выбор: объект и дата сброшены.
  await page.locator('[data-rowid="csv-r3"] [data-testid="csv-select"]').click();
  await expect(page.getByTestId('csv-active')).toContainText('Активна строка 4 (csv-r3)');
  await expect(page.getByTestId('csv-zk')).toHaveValue('');
  await expect(page.getByLabel('Дата публикации (пусто — не указана)')).toHaveValue('');

  // Valid: выбор → подтверждение ЖК → сохранение без анализа.
  await page.locator('[data-rowid="csv-r1"] [data-testid="csv-select"]').click();
  await expect(page.getByTestId('csv-active')).toContainText('Активна строка 2 (csv-r1)');
  await expect(page.getByTestId('csv-zk')).toHaveValue('SQ-001');
  await page.getByTestId('csv-confirm').click();
  await expect(page.getByTestId('csv-confirmed')).toContainText('ЖК подтверждён.');
  await page.getByTestId('csv-save').click();
  await expect(page.locator('[data-rowid="csv-r1"] [data-testid="csv-row-saved"]')).toContainText(/Сохранена как AD-/);

  // Reload: список и карточка согласованы — публикация/фиксация раздельно.
  await page.reload();
  await page.goto('/#/ads');
  await expect(page.getByText(VALID_TEXT)).toBeVisible();
  await page.goto('/#/detail/SQ-001');
  await expect(page.locator('.ad-item', { hasText: VALID_TEXT })).toContainText('Публикация: 2026-10-11');
  const pubsHeading = await page.getByRole('heading', { name: /Публикации ·/ }).textContent();

  // Повтор всего CSV: valid и duplicate — повторы, новых ad нет.
  await openCsv(page);
  await expect(page.locator('[data-rowid="csv-r1"] [data-testid="csv-row-dupe"]')).toContainText(/уже сохранён как AD-/);
  await expect(page.locator('[data-rowid="csv-r4"] [data-testid="csv-row-dupe"]')).toContainText(/уже сохранён как AD-/);
  await page.locator('[data-rowid="csv-r4"] [data-testid="csv-select"]').click();
  await page.getByTestId('csv-confirm').click();
  await page.getByTestId('csv-save').click();
  await expect(page.getByRole('alert')).toContainText(/уже сохранена \(AD-/);

  await page.goto('/#/detail/SQ-001');
  await expect(page.getByRole('heading', { name: /Публикации ·/ })).toHaveText(pubsHeading ?? '');

  expect(errors).toEqual([]);
});
