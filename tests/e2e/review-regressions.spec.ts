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
  await page.goto('/#/analyze/SQ-001',{waitUntil:'domcontentloaded'});
  const text = `Бронь квартиры — 521 000 тенге. Проверка retry ${Date.now()}.`;
  await page.getByLabel('Текст объявления').fill(text);
  await page.getByLabel('Скриншот / документ').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Проанализировать', exact: true }).click();
  await page.getByRole('button', { name: 'Проанализировать', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить без подтверждения', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('ответ сервера потерян');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!));
  await page.getByRole('button', { name: 'Сохранить без подтверждения', exact: true }).click();
  await expect(page.getByText('Публикация сохранена. Триаж гипотезы не начисляет баллы.')).toBeVisible();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!));
  expect(injected).toBe(true);
  expect(after.version).toBe(before.version + 1); // Artifact registers after the replayed publication ACK.
  expect(after.state.ads.filter((a: { text: string }) => a.text === text)).toHaveLength(1);
  expect(after.state.media).toHaveLength(1);
  for (const [id,receipt] of Object.entries(before.receipts)) expect(after.receipts[id]).toEqual(receipt);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.goto('/#/complexes/SQ-001?tab=verification',{waitUntil:'domcontentloaded'});
  await expect(page.locator('.dossier-visual .evidence-image')).toBeVisible();
});

test('confirmed publication includes its attachment in exported signal materials', async ({ page }) => {
  await page.goto('/#/analyze/SQ-001',{waitUntil:'domcontentloaded'});
  await page.getByLabel('Текст объявления').fill(`Бронь квартиры — 522 000 тенге. Проверка export ${Date.now()}.`);
  await page.getByLabel('Скриншот / документ').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Проанализировать', exact: true }).click();
  await page.getByRole('button', { name: 'Проанализировать', exact: true }).click();
  await page.getByLabel('Обоснование аналитика').fill('Проверены текст и скриншот');
  await page.getByRole('button', { name: 'Принять гипотезу R2', exact: true }).click();
  await expect(page.getByText('Публикация сохранена. Триаж гипотезы не начисляет баллы.')).toBeVisible();
  await page.goto('/#/complexes/SQ-001?tab=verification',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Начать расследование',exact:true}).click();
  await page.locator('.hypothesis').filter({has:page.locator('blockquote').filter({hasText:'Бронь квартиры — 522 000'})}).getByLabel('Дата доказательства',{exact:true}).fill('2026-10-19');
  await page.locator('.hypothesis').filter({has:page.locator('blockquote').filter({hasText:'Бронь квартиры — 522 000'})}).getByLabel('Обоснование проверки факта',{exact:true}).fill('Проверены текст и скриншот');
  await page.locator('.hypothesis').filter({has:page.locator('blockquote').filter({hasText:'Бронь квартиры — 522 000'})}).getByRole('button',{name:'Подтвердить факт R2',exact:true}).click();
  await page.getByRole('button',{name:'Предпросмотр сигнала',exact:true}).click();
  await page.getByLabel('Обоснование решения').fill('Проверены материалы сигнала');
  await page.getByRole('button',{name:'Подтвердить сигнал',exact:true}).click();
  await expect(page.locator('.case-signal-sheet')).toContainText('Версия 1');
  const env=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!));
  expect(env.state.caseSnapshots.at(-1).mediaManifest).toContainEqual(expect.objectContaining({kind:'media',id:env.state.media[0].id}));
});

test('R3 accepts dated analyst material and retries a corrected decision with its file', async ({ page }) => {
  await page.route('**/src/lib/analysis.ts', route => route.fulfill({
    contentType: 'application/javascript',
    body: `export const canonicalRunInput=JSON.stringify; export const newRunId=()=>crypto.randomUUID();
    export async function analyze(input) {
      return { engine: 'Review stub', realAI: false, hypotheses: [{ code: 'R3', quote: input.text, reason: 'Review hypothesis' }] };
    }`,
  }));
  await page.goto('/#/analyze/SQ-001',{waitUntil:'domcontentloaded'});
  await page.getByLabel('Текст объявления').fill('Продажа квартир в строящемся доме.');
  await page.getByLabel('Дата публикации (пусто — не указана)').fill('');
  await page.getByLabel('Скриншот / документ').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Проанализировать', exact: true }).click();
  await page.getByRole('button', { name: 'Проанализировать', exact: true }).click();
  await page.getByLabel('Обоснование аналитика').fill('Проверены объявления и сведения о вводе');
  await page.getByRole('button', { name: 'Принять гипотезу R3', exact: true }).click();
  await expect(page.getByText('Публикация сохранена. Триаж гипотезы не начисляет баллы.')).toBeVisible();
  await page.goto('/#/complexes/SQ-001?tab=verification',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Начать расследование',exact:true}).click();
  await page.locator('.hypothesis').filter({has:page.locator('blockquote').filter({hasText:'Продажа квартир в строящемся доме.'})}).getByLabel('Дата доказательства',{exact:true}).fill('2026-10-19');
  await page.locator('.hypothesis').filter({has:page.locator('blockquote').filter({hasText:'Продажа квартир в строящемся доме.'})}).getByLabel('Обоснование проверки факта',{exact:true}).fill('Проверка объявления без даты');
  await page.locator('.hypothesis').filter({has:page.locator('blockquote').getByText('Продажа квартир в строящемся доме.',{exact:true})}).getByRole('button',{name:'Подтвердить факт R3',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('датированный материал');
  await page.locator('.hypothesis').filter({has:page.locator('blockquote').filter({hasText:'Продажа квартир в строящемся доме.'})}).getByLabel('Дополнительный датированный материал (для R3: состояние до ввода)').fill('2026-10-18: источник — реестр, объект не введён');
  await page.locator('.hypothesis').filter({has:page.locator('blockquote').getByText('Продажа квартир в строящемся доме.',{exact:true})}).getByRole('button',{name:'Подтвердить факт R3',exact:true}).click();
  await expect(page.locator('.risk-score strong')).toHaveText('10');
  await page.reload({waitUntil:'domcontentloaded'});
  const env=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!));
  const fact=env.state.assertions.at(-1);
  expect(fact.status).toBe('verified');
  expect(fact.evidence.text).toContain('2026-10-18');
  expect(fact.evidence.mediaIds).toEqual([env.state.media[0].id]);
});
