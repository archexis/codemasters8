import { expect, test } from '@playwright/test';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');

test('lost commit ACK replays the identical publication and keeps its attachment', async ({ page }) => {
  // Inject a lost ACK after the real repository transaction: no mocked persistence.
  let injected = false;
  await page.route('**/src/lib/repository.ts', async route => {
    const response = await route.fetch();
    const original = await response.text();
    const needle = 'return (await commitCommand(state, command, reviewer, opts)).state;';
    expect(original).toContain(needle);
    injected = true;
    const body = original.replace(needle, `
      const committed = (await commitCommand(state, command, reviewer, opts)).state;
      if (!globalThis.__reviewDroppedAck) {
        globalThis.__reviewDroppedAck = true;
        throw new UnknownCommitResultError('Review: ответ сервера потерян, повторите отправку', 'review-lost-ack');
      }
      return committed;
    `);
    await route.fulfill({ response, body });
  });
  await page.goto('/#/analyze/SQ-001');
  const text = `Бронь квартиры — 521 000 тенге. Проверка retry ${Date.now()}.`;
  await page.getByLabel('Текст объявления').fill(text);
  await page.getByLabel('Скриншот / документ').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Проанализировать', exact: true }).click();
  await page.getByRole('button', { name: 'Проанализировать', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить без подтверждения', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('ответ сервера потерян');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!));
  await page.getByRole('button', { name: 'Сохранить без подтверждения', exact: true }).click();
  await expect(page.getByText('Публикация и решение сохранены.')).toBeVisible();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!));
  expect(injected).toBe(true);
  expect(after.version).toBe(before.version);
  expect(after.state.ads.filter((a: { text: string }) => a.text === text)).toHaveLength(1);
  expect(after.state.media).toHaveLength(1);
  expect(after.receipts).toEqual(before.receipts);
  await page.reload();
  await page.goto('/#/detail/SQ-001');
  await expect(page.getByAltText(`Источник публикации ${after.state.ads[0].id}`)).toBeVisible();
});

test('confirmed publication includes its attachment in exported signal materials', async ({ page }) => {
  await page.goto('/#/analyze/SQ-001');
  await page.getByLabel('Текст объявления').fill(`Бронь квартиры — 522 000 тенге. Проверка export ${Date.now()}.`);
  await page.getByLabel('Скриншот / документ').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Проанализировать', exact: true }).click();
  await page.getByRole('button', { name: 'Проанализировать', exact: true }).click();
  await page.getByLabel('Обоснование аналитика').fill('Проверены текст и скриншот');
  await page.getByRole('button', { name: 'Подтвердить R2', exact: true }).click();
  await expect(page.getByText('Публикация и решение сохранены.')).toBeVisible();
  await page.goto('/#/signal/SQ-001');
  await page.getByLabel('Обоснование решения').fill('Проверены материалы сигнала');
  await page.getByRole('button', { name: 'Подтвердить сигнал', exact: true }).click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state.signalVersions['SQ-001']?.length ?? 0)).toBe(1);
  const env = await page.evaluate(() => JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!));
  const latest = env.state.signalVersions['SQ-001'].at(-1);
  expect(latest.mediaManifest).toContainEqual(expect.objectContaining({ kind: 'media', id: env.state.media[0].id }));
});

test('R3 accepts dated analyst material and retries a corrected decision with its file', async ({ page }) => {
  await page.route('**/src/lib/analysis.ts', route => route.fulfill({
    contentType: 'application/javascript',
    body: `export const canonicalRunInput=JSON.stringify; export const newRunId=()=>crypto.randomUUID();
    export async function analyze(input) {
      return { engine: 'Review stub', realAI: false, hypotheses: [{ code: 'R3', quote: input.text, reason: 'Review hypothesis' }] };
    }`,
  }));
  await page.goto('/#/analyze/SQ-001');
  await page.getByLabel('Текст объявления').fill('Продажа квартир в строящемся доме.');
  await page.getByLabel('Дата публикации (пусто — не указана)').fill('');
  await page.getByLabel('Скриншот / документ').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Проанализировать', exact: true }).click();
  await page.getByRole('button', { name: 'Проанализировать', exact: true }).click();
  await page.getByLabel('Обоснование аналитика').fill('Проверены объявления и сведения о вводе');
  await page.getByRole('button', { name: 'Подтвердить R3', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Для R3 нужен датированный материал');
  await page.getByLabel('Датированный материал о том, что объект не введён').fill('2026-10-18: источник — реестр, объект не введён');
  await page.getByRole('button', { name: 'Подтвердить R3', exact: true }).click();
  await expect(page.getByText('Публикация и решение сохранены.')).toBeVisible();
  await page.reload();
  const env = await page.evaluate(() => JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!));
  const factor = env.state.complexes.find((c: { id: string }) => c.id === 'SQ-001').factors.find((f: { code: string }) => f.code === 'R3');
  expect(factor.status).toBe('confirmed');
  expect(factor.evidence.text).toContain('2026-10-18');
  expect(factor.evidence.mediaIds).toEqual([env.state.media[0].id]);
});
