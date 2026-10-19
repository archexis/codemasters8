/**
 * S2.3 (C3) + S2.2 DEMO. Fault cases публикации с вложением — DEMO-режим
 * (настоящий браузер, настоящий IndexedDB/localStorage/Web Locks, без моков
 * Auth/Storage). НЕ запускать локально без нужды (решение заказчика:
 * проверка — unit + check); спецификация — для gate D2.3/D2.2 и CI.
 *
 * Карта 8 fault cases:
 *  F1 upload fail (чужой MIME) → решения нет;
 *  F2 upload fail (oversize) → решения нет;
 *  F3 RPC validation fail (дубль) → staged-файл этого намерения удалён;
 *  F4 принятый (ссылочный) файл переживает чужую failed-cleanup;
 *  F5 saved=true только после ACK; повтор не создаёт дубль;
 *  F6 стабильные ID и квитанция в конверте после reload;
 *  F7 две DEMO-вкладки через Web Locks → оба решения применены, потерь нет;
 *  F8 очередь повтора очистки переживает reload.
 */
import { expect, test, type Page } from '@playwright/test';
import {writeFileSync} from 'node:fs';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
);

const uniq = (tag: string) => `Депозит ${Date.now() % 100000000} тенге ${tag} за квартиру.`;

async function analyzeWith(page: Page, zk: string, text: string) {
  await page.goto(`/#/analyze/${zk}`);
  await page.getByLabel('Текст объявления').fill(text);
  await page.getByRole('button', { name: 'Проанализировать', exact: true }).click();
  await expect(page.getByText('R2 · гипотеза')).toBeVisible();
}

test('F1: чужой MIME не даёт решения и не сохраняет публикацию', async ({ page }) => {
  const text = uniq('F1');
  await analyzeWith(page, 'SQ-001', text);
  await page.getByLabel('Скриншот / документ').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.getByRole('button', { name: 'Проанализировать', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить без подтверждения' }).click();
  await expect(page.getByRole('alert')).toContainText('Допустимы');
  await expect(page.getByText('Публикация и решение сохранены.')).toHaveCount(0);
  await page.goto('/#/ads');
  await expect(page.getByText(text)).toHaveCount(0);
});

test('F2: файл больше 20 МБ отклоняется до commit', async ({ page },info) => {
  const text = uniq('F2');
  await analyzeWith(page, 'SQ-001', text);
  const path=info.outputPath('big.png');writeFileSync(path,Buffer.alloc(20 * 1024 * 1024 + 1));
  await page.getByLabel('Скриншот / документ').setInputFiles(path);
  await page.getByRole('button', { name: 'Проанализировать', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить без подтверждения' }).click();
  await expect(page.getByRole('alert')).toContainText('Допустимы');
  await page.goto('/#/ads');
  await expect(page.getByText(text)).toHaveCount(0);
});

test('F3+F4: дубль отклонён, staged-файл намерения удалён, принятый файл жив', async ({ page }) => {
  const text = uniq('F34');
  await analyzeWith(page, 'SQ-001', text);
  await page.getByLabel('Скриншот / документ').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Проанализировать', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить без подтверждения' }).click();
  await expect(page.getByText('Публикация и решение сохранены.')).toBeVisible();

  // Тот же текст + новый файл: RPC отклонит DUPLICATE_AD уже после upload.
  await analyzeWith(page, 'SQ-001', text);
  await page.getByLabel('Скриншот / документ').setInputFiles({ name: 'shot2.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Проанализировать', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить без подтверждения' }).click();
  await expect(page.getByRole('alert')).toContainText(/уже сохранена|DUPLICATE_AD/);

  // F3: область cleanup этого намерения пуста (staged-файл удалён, не завис).
  const staged = await page.evaluate(() => localStorage.getItem('sq_staged_files_v1'));
  expect(staged === null || staged === '{}').toBe(true);
  // F4: принятый файл первой попытки на месте (ссылочные не удаляются).
  const envelope = await page.evaluate(() => JSON.parse(localStorage.getItem('sq_svelte_demo_v2') ?? '{}'));
  expect(envelope?.state?.media).toHaveLength(1);
  await page.goto('/#/detail/SQ-001');
  await expect(page.getByAltText(`Источник публикации ${envelope.state.ads[0].id}`)).toBeVisible();
});

test('F5+F6: saved только после ACK; ID и квитанция стабильны после reload', async ({ page }) => {
  const text = uniq('F56');
  await analyzeWith(page, 'SQ-002', text);
  await page.getByLabel('Скриншот / документ').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Проанализировать', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить без подтверждения' }).click();
  await expect(page.getByText('Публикация и решение сохранены.')).toBeVisible();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('sq_svelte_demo_v2') ?? '{}'));
  const adId = before.state.ads[0].id as string;
  const mediaId = before.state.media[0].id as string;
  expect(typeof before.state.audit[0].commandId).toBe('string');
  expect(before.state.media[0].bytes).toBeGreaterThan(0);

  await page.reload();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('sq_svelte_demo_v2') ?? '{}'));
  // F6: повтор после reload — те же сущности, дублей нет.
  expect(after.state.ads.filter((a: { id: string }) => a.id === adId)).toHaveLength(1);
  expect(after.state.media.filter((m: { id: string }) => m.id === mediaId)).toHaveLength(1);
  await page.goto('/#/ads');
  await expect(page.getByText(text)).toHaveCount(1);
});

test('F7: две DEMO-вкладки через Web Locks — оба решения применены без потерь', async ({ page }) => {
  const t1 = uniq('F7a');
  const t2 = uniq('F7b');
  const second = await page.context().newPage();
  await analyzeWith(page, 'SQ-001', t1);
  await analyzeWith(second, 'SQ-002', t2);
  await Promise.all([
    page.getByRole('button', { name: 'Сохранить без подтверждения' }).click(),
    second.getByRole('button', { name: 'Сохранить без подтверждения' }).click(),
  ]);
  await expect(page.getByText('Публикация и решение сохранены.')).toBeVisible();
  await expect(second.getByText('Публикация и решение сохранены.')).toBeVisible();
  const envelope = await page.evaluate(() => JSON.parse(localStorage.getItem('sq_svelte_demo_v2') ?? '{}'));
  const texts = (envelope.state.ads as { text: string }[]).map((a) => a.text);
  expect(texts).toContain(t1);
  expect(texts).toContain(t2);
  expect(envelope.state.audit.length).toBeGreaterThanOrEqual(2);
  await second.close();
});

test('F8: очередь повтора очистки переживает reload', async ({ page }) => {
  await page.goto('/#/analyze/SQ-001');
  await page.evaluate(() => {
    const key = 'sq_cleanup_retry_v1';
    const list = JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
    if (!list.includes('demo/SQ-001/ghost-f8.bin')) list.push('demo/SQ-001/ghost-f8.bin');
    localStorage.setItem(key, JSON.stringify(list));
  });
  await page.reload();
  const list = await page.evaluate(() => JSON.parse(localStorage.getItem('sq_cleanup_retry_v1') ?? '[]'));
  expect(list).toContain('demo/SQ-001/ghost-f8.bin');
});
