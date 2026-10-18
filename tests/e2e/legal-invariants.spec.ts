import { expect, test } from '@playwright/test';

/**
 * S1.5 — правовые инварианты через browser-путь (прямые RPC corpus I01–I18
 * покрыты в S1.2 и здесь не дублируются).
 * База: SQ-003 = сценарий C (гарантия verified, R3 = 10, зелёная);
 * SQ-001 = сценарий A (R2 + R3 = 35).
 */
test('C: попытка подтвердить R1 блокирована, счёт остаётся зелёным', async ({ page }) => {
  await page.goto('/#/detail/SQ-003');
  await expect(page.locator('.risk-score strong')).toHaveText('10');
  await page.getByRole('combobox', { name: /^Фактор/ }).selectOption('R1');
  await page.getByLabel('Источник доказательства').fill('Ручная сверка');
  await page.getByLabel(/Содержание правовой сверки/).fill('Сверка гарантии единого оператора: основание подтверждено, отсутствие не установлено.');
  await page.getByLabel(/Комментарий аналитика/).fill('Попытка подтвердить R1 при действующей гарантии');
  await page.getByRole('button', { name: 'Сохранить решение' }).click();
  await expect(page.getByRole('alert')).toContainText('R1 требует');
  await expect(page.locator('.risk-score strong')).toHaveText('10');
});

test('новая публикация → R2 → счёт растёт', async ({ page }) => {
  const adText = 'Новая платная бронь 612 000 тенге для квартиры.';
  await page.goto('/#/analyze/SQ-003');
  await page.getByLabel('Текст объявления').fill(adText);
  await page.getByRole('button', { name: 'Проанализировать', exact: true }).click();
  await expect(page.getByText('R2 · гипотеза')).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить без подтверждения' }).click();
  await expect(page.getByText('Публикация и решение сохранены.')).toBeVisible();
  await page.goto('/#/detail/SQ-003');
  const adSelect = page.getByRole('combobox', { name: 'Публикация этого ЖК' });
  const newAdId = await adSelect.evaluate((sel: HTMLSelectElement, needle: string) => {
    const opt = [...sel.options].find((o) => o.text.includes(needle));
    return opt ? opt.value : '';
  }, '612 000');
  expect(newAdId).not.toBe('');
  await page.getByRole('combobox', { name: /^Фактор/ }).selectOption('R2');
  await page.getByLabel('Источник доказательства').fill('Ручная сверка публикации');
  await adSelect.selectOption(newAdId);
  await page.getByLabel(/Дословная цитата/).fill(adText);
  await page.getByLabel(/Комментарий аналитика/).fill('Платёжная формулировка дословно из новой публикации');
  await page.getByRole('button', { name: 'Сохранить решение' }).click();
  await expect(page.locator('.risk-score strong')).toHaveText('35');
});

test('снятие фактора → счёт падает', async ({ page }) => {
  await page.goto('/#/detail/SQ-001');
  await expect(page.locator('.risk-score strong')).toHaveText('35');
  await page.getByRole('combobox', { name: /^Фактор/ }).selectOption('R2');
  await page.getByRole('combobox', { name: 'Решение' }).selectOption('rejected');
  await page.getByLabel('Источник доказательства').fill('Ручная проверка');
  await page.getByRole('combobox', { name: 'Публикация этого ЖК' }).selectOption({ index: 1 });
  await page.getByLabel(/Дословная цитата/).fill('повторная сверка не подтвердила');
  await page.getByLabel(/Комментарий аналитика/).fill('Повторная сверка: платёжная формулировка не подтвердилась');
  await page.getByRole('button', { name: 'Сохранить решение' }).click();
  await expect(page.locator('.risk-score strong')).toHaveText('10');
  await expect(page.locator('.factor-row').filter({ hasText: 'R2' })).toContainText('Отклонён');
});

test('объяснение ошибки у поля: выдуманная цитата отклонена', async ({ page }) => {
  await page.goto('/#/detail/SQ-001');
  await expect(page.locator('.risk-score strong')).toHaveText('35');
  await page.getByRole('combobox', { name: /^Фактор/ }).selectOption('R2');
  await page.getByLabel('Источник доказательства').fill('Ручная проверка');
  await page.getByRole('combobox', { name: 'Публикация этого ЖК' }).selectOption({ index: 1 });
  await page.getByLabel(/Дословная цитата/).fill('выдуманная цитата не из текста');
  await page.getByLabel(/Комментарий аналитика/).fill('Проверка подсказки у поля');
  await page.getByRole('button', { name: 'Сохранить решение' }).click();
  await expect(page.getByRole('alert')).toContainText('Цитата отсутствует в исходном тексте');
  await expect(page.locator('.risk-score strong')).toHaveText('35');
});
