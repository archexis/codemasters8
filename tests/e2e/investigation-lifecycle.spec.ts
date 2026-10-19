import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AppState, CaseSignalSnapshot } from '../../src/lib/types';

const publication = 'Депозит 654 000 тенге обязателен для бронирования квартиры. Проверка жизненного цикла расследования.';
const confirmation = 'Дословное предложение оплаты сверено с оригиналом и приложением.';
const withdrawal = 'Повторная сверка: применимость предложения оплаты не подтверждена.';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');

async function readState(page: Page): Promise<AppState> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state);
}

// Use the real DEMO parser, repository, localStorage and IndexedDB. All writes
// happen through the UI; storage is read only to check history and provenance.
test('investigation lifecycle: publication → fact → signal → reconsideration → immutable export', async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let caseId: string;
  let caseUrl: string;
  let original: CaseSignalSnapshot;

  await test.step('save a publication with its original attachment without analysis or triage', async () => {
    await page.goto('/#/publications?add=1&complex=SQ-003', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Текст объявления', { exact: true }).fill(publication);
    await page.getByLabel('Дата публикации (пусто — не указана)', { exact: true }).fill('2026-10-19');
    await page.getByLabel('Площадка', { exact: true }).fill('Источник E2E расследования');
    await page.getByLabel('Скриншот / документ', { exact: true }).setInputFiles({
      name: 'investigation-proof.png', mimeType: 'image/png', buffer: PNG,
    });
    await page.getByRole('button', { name: 'Сохранить материал без AI', exact: true }).click();
    await expect(page.getByText(/Материал сохранён:/)).toBeVisible();

    await page.goto('/#/complexes/SQ-003?tab=verification', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.risk-score strong')).toHaveText('10');
    await expect(page.locator('.dossier-visual .evidence-image')).toBeVisible();
    const state = await readState(page);
    expect(state.ads.filter(ad => ad.text === publication)).toHaveLength(1);
    expect(state.assertions ?? []).toHaveLength(0);
    expect(state.caseSnapshots ?? []).toHaveLength(0);
  });

  await test.step('start a case and count only the fact verified by the analyst', async () => {
    await page.getByRole('button', { name: 'Начать расследование', exact: true }).click();
    await expect(page).toHaveURL(/#\/cases\/CASE-/);
    await expect(page.getByRole('region',{name:'Автоматическая подготовка расследования'}).getByRole('status')).toContainText('Подготовка завершена');
    await expect(page.getByRole('checkbox',{name:/Выбрать факт/})).not.toBeChecked();
    await expect(page.getByRole('button',{name:'Подтвердить выбранные факты',exact:true})).toBeDisabled();
    const prepared=await readState(page);
    expect(prepared.assertions??[]).toHaveLength(0);
    expect(prepared.claims).toHaveLength(1);
    expect(prepared.claims![0].triage).toBeUndefined();
    expect(prepared.claims![0].quote).toContain('Депозит');
    await page.screenshot({path:info.outputPath('00-automatically-prepared.png'),fullPage:true});
    await page.locator('.dossier-main').screenshot({path:info.outputPath('00-candidates.png')});
    caseUrl = page.url();
    caseId = new URL(caseUrl).hash.split('/cases/')[1].split('?')[0];
    await expect(page.locator('.risk-score strong')).toHaveText('10');
    await page.getByRole('button', { name: 'Предпросмотр сигнала', exact: true }).click();
    await expect(page.locator('.case-signal-sheet .risk-score strong')).toHaveText('0');
    await expect(page.getByRole('button', { name: 'Подтвердить сигнал', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Скачать снимок JSON', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '← К досье', exact: true }).click();

    await expect(page.getByRole('button', { name: 'Подтвердить факт R2', exact: true })).toBeDisabled();
    await page.getByLabel('Обоснование проверки факта', { exact: true }).fill(confirmation);
    await page.getByRole('checkbox',{name:/Выбрать факт R2/}).check();
    await page.getByRole('button', { name: 'Подтвердить выбранные факты', exact: true }).click();
    await expect(page.locator('.risk-score strong')).toHaveText('25');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.risk-score strong')).toHaveText('25');
    await expect(page.locator('.hypothesis')).toContainText('Факт проверен');
    await expect(page.locator('.dossier-visual .evidence-image')).toBeVisible();
  });

  await test.step('confirm a signal with evidence and freeze version 1', async () => {
    await page.getByRole('button', { name: 'Предпросмотр сигнала', exact: true }).click();
    await page.getByLabel('Обоснование решения', { exact: true }).fill(confirmation);
    await page.getByRole('button', { name: 'Подтвердить сигнал', exact: true }).click();
    const sheet = page.locator('.case-signal-sheet');
    await expect(sheet).toContainText('Версия 1');
    await expect(sheet).toContainText('Статус: Подтверждён');
    await expect(sheet).toContainText(publication);
    await expect(sheet).toContainText('investigation-proof.png');
    await expect(sheet.locator('.risk-score strong')).toHaveText('25');
    const state = await readState(page);
    const versions = state.caseSnapshots!.filter(snapshot => snapshot.caseId === caseId);
    expect(versions).toHaveLength(1);
    original = versions[0];
    expect(original).toMatchObject({ status: 'confirmed', score: 25, comment: confirmation });
    expect(original.assertions).toEqual([expect.objectContaining({ code: 'R2', status: 'verified', comment: confirmation })]);
    const artifact = original.artifacts.find(item => item.text === publication)!;
    expect(artifact).toBeDefined();
    expect(original.ads).toContainEqual(expect.objectContaining({ id: artifact.adId, text: publication }));
    expect(original.mediaManifest).toContainEqual(expect.objectContaining({ id: artifact.mediaId, bytes: PNG.length }));
    await page.screenshot({ path: info.outputPath('01-confirmed.png'), fullPage: true });
  });

  await test.step('reopen, withdraw the fact and return version 2 for verification', async () => {
    await page.getByLabel('Обоснование решения', { exact: true }).fill('Получены сведения для повторной сверки.');
    await page.getByRole('button', { name: 'Открыть пересмотр', exact: true }).click();
    await expect(page.locator('.case-signal-sheet')).toContainText('Предпросмотр черновика');
    await page.getByRole('button', { name: '← К досье', exact: true }).click();
    await page.getByLabel('Обоснование проверки факта', { exact: true }).fill(withdrawal);
    await page.getByRole('button', { name: 'Отклонить факт', exact: true }).click();
    await expect(page.locator('.risk-score strong')).toHaveText('0');
    await page.getByRole('button', { name: 'Предпросмотр сигнала', exact: true }).click();
    await page.getByLabel('Обоснование решения', { exact: true }).fill(withdrawal);
    await page.getByRole('button', { name: 'Вернуть на проверку', exact: true }).click();
    await expect(page.locator('.case-signal-sheet')).toContainText('Версия 2');
    await expect(page.locator('.case-signal-sheet')).toContainText('Статус: Возвращён');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.hypothesis')).toContainText('Факт отклонён');
    await expect(page.locator('.risk-score strong')).toHaveText('0');
    await page.getByRole('button', { name: 'Предпросмотр сигнала', exact: true }).click();
    await expect(page.locator('.case-signal-sheet .risk-score strong')).toHaveText('0');
    await expect(page.locator('.case-signal-sheet')).toContainText(withdrawal);
    await page.screenshot({ path: info.outputPath('02-returned.png'), fullPage: true });
    const state = await readState(page);
    expect(state.cases!.find(item => item.id === caseId)?.status).toBe('returned');
    expect(state.assertions!.filter(item => item.caseId === caseId).map(item => item.status)).toEqual(['verified', 'rejected']);
    expect(state.caseSnapshots!.filter(item => item.caseId === caseId)).toEqual([
      original,
      expect.objectContaining({ revision: 2, status: 'returned', score: 0, comment: withdrawal }),
    ]);
  });

  await test.step('export the unchanged first version after reconsideration', async () => {
    await page.getByRole('combobox', { name: 'Версия', exact: true }).selectOption('1');
    const sheet = page.locator('.case-signal-sheet');
    await expect(sheet).toContainText('Версия 1');
    await expect(sheet.locator('.risk-score strong')).toHaveText('25');
    await expect(sheet).toContainText(confirmation);
    await expect(sheet).not.toContainText(withdrawal);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать снимок JSON', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`saq-${caseId}-v1.json`);
    const jsonPath = info.outputPath('historical-v1.json');
    await download.saveAs(jsonPath);
    expect(JSON.parse(await readFile(jsonPath, 'utf8'))).toEqual(original);
    await info.attach('Historical version 1', { path: jsonPath, contentType: 'application/json' });

    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('header')).toBeHidden();
    await expect(page.getByRole('button', { name: '← К досье', exact: true })).toBeHidden();
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.risk-score strong')).toHaveText('25');
    const pdfPath = info.outputPath('historical-v1.pdf');
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
    expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe('%PDF-');
    await info.attach('Historical version 1 PDF', { path: pdfPath, contentType: 'application/pdf' });
    expect(errors).toEqual([]);
  });
});
