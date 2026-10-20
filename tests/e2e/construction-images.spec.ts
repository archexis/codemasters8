import { expect, test } from '@playwright/test';
import seed from '../../src/lib/seed.json' with { type: 'json' };

test('all eight objects show only their latest construction image', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const complex of seed.COMPLEXES) {
    await page.goto('/#/complexes/' + complex.id, { waitUntil: 'load' });
    await expect(page.getByRole('heading', { name: complex.name, exact: true })).toBeVisible();
    const gallery = page.getByRole('region', { name: 'Последнее изображение строительства' });
    await expect(gallery.getByRole('button')).toHaveCount(0);
    await expect(gallery.locator('img')).toHaveCount(1);
    const image = gallery.locator('.construction-image img');
    await expect(image).toHaveAttribute('src', new RegExp(complex.id + '_drone_2026-10-20.webp$'));
    await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).naturalWidth), { timeout: 15000 }).toBe(1600);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('chronology filters, selects and compares synthetic frames without adding evidence', async ({ page }, info) => {
  await page.goto('/#/complexes/SQ-001?tab=timeline', { waitUntil: 'load' });
  const rows = page.locator('.illustration-event');
  await expect(rows).toHaveCount(4, { timeout: 15000 });
  await rows.last().getByRole('button', { name: 'Показать кадр', exact: true }).click();
  const gallery = page.getByRole('region', { name: 'Последнее изображение строительства' });
  await expect(gallery.locator('.construction-image img')).toHaveAttribute('src', /2026-10-20.webp$/);
  await expect(rows.last().locator('.construction-image img')).toHaveAttribute('src', /2026-05-20.webp$/);
  await page.locator('.filters input[type=date]').first().fill('2026-09-01');
  await expect(rows).toHaveCount(2);
  await page.locator('.filters input[type=date]').last().fill('2026-09-30');
  await expect(rows).toHaveCount(1);
  await page.getByRole('button', { name: 'Сравнить снимки', exact: true }).click();
  const comparison = page.getByRole('dialog', { name: 'Сравнение снимков' });
  await expect(comparison).toBeVisible();
  await expect(comparison.locator('img')).toHaveCount(2);
  await expect(comparison.locator('img').first()).toHaveAttribute('src', /2026-05-20.webp$/);
  await expect(comparison.locator('img').last()).toHaveAttribute('src', /2026-10-20.webp$/);
  for (const image of await comparison.locator('img').all()) {
    await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).naturalWidth), { timeout: 15000 }).toBe(1600);
  }
  await expect(comparison).toContainText('условными датами');
  await page.screenshot({ path: info.outputPath('construction-comparison.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(comparison).not.toBeVisible();
  await page.getByRole('button', { name: 'Начать расследование', exact: true }).click();
  await expect(page).toHaveURL(/#\/cases\/CASE-/);
  await expect(page.locator('.illustration-event')).toHaveCount(4);
  await expect(page.locator('.illustration-event').getByRole('button', { name: 'Добавить событие в дело' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('construction-timeline.png'), fullPage: true });
});
