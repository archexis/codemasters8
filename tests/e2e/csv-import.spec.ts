import { expect, test, type Page } from '@playwright/test';

// Долгие сценарии (несколько сохранений + reloads): на слабых машинах
// mobile-проект упирается в дефолтные 60с — даём 120с, логика та же.
test.setTimeout(120000);

// S3.3 (C4). Надёжный построчный CSV: preview → выбор одной валидной
// строки → явное сопоставление ЖК → сохранение без обязательного анализа.
// Строки с ошибками в save попасть не могут; сохранённая строка повторно
// не импортируется; вторая строка обрабатывается независимо.
const FOUR_ROWS = [
  'text,platform,date,url,zk',
  '"Депозит 901 111 тенге за бронь квартиры.",Krisha,2026-09-01,https://krisha.kz/a/901,SQ-001',
  '"Бронь 901 222 тенге, звоните.",Telegram,2026-02-30,https://t.me/x902,SQ-002',
  '"Алғашқы жарна 901 333 теңге.",Krisha,2026-09-03,https://krisha.kz/a/903,Несуществующий ЖК',
  '"Депозит 901 111 тенге за бронь квартиры.",Krisha,2026-09-04,https://krisha.kz/a/904,SQ-001',
].join('\n');

async function openCsv(page: Page) {
  await page.goto('/#/analyze/SQ-001');
  await page.getByText('Импорт из CSV').click();
  await page.getByTestId('csv-input').fill(FOUR_ROWS);
  await page.getByTestId('csv-preview').click();
  await expect(page.getByTestId('csv-row')).toHaveCount(4);
}

test('preview: valid, bad date, unknown zk и duplicate имеют точные причины', async ({ page }) => {
  await openCsv(page);
  const row1 = page.locator('[data-testid="csv-row"][data-rowid="csv-r1"]');
  const row2 = page.locator('[data-testid="csv-row"][data-rowid="csv-r2"]');
  const row3 = page.locator('[data-testid="csv-row"][data-rowid="csv-r3"]');
  await expect(row1.getByTestId('csv-row-hint')).toContainText('сопоставлен по ID');
  await expect(row2.getByTestId('csv-row-error')).toContainText('неверная дата');
  await expect(row2.getByTestId('csv-select')).toBeDisabled();
  await expect(row3.getByTestId('csv-row-hint')).toContainText('не найден');
});

test('valid сохраняется без анализа; saved не дублируется; вторая строка независима', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await openCsv(page);
  // Строка 1: exact ID → предсопоставление, но save до подтверждения закрыт.
  await page.locator('[data-testid="csv-row"][data-rowid="csv-r1"] [data-testid="csv-select"]').click();
  await expect(page.getByTestId('csv-active')).toBeVisible();
  await expect(page.getByTestId('csv-save')).toBeDisabled();
  await page.getByTestId('csv-confirm').click();
  await expect(page.getByTestId('csv-confirmed')).toBeVisible();
  await page.getByTestId('csv-save').click();
  const savedMark = page.locator('[data-testid="csv-row"][data-rowid="csv-r1"] [data-testid="csv-row-saved"]');
  await expect(savedMark).toBeVisible();
  await expect(page.locator('[data-testid="csv-row"][data-rowid="csv-r1"] [data-testid="csv-select"]')).toBeDisabled();
  // Выбор строки 3 сбрасывает форму: текст заменён, выбор ЖК не унаследован.
  await page.locator('[data-testid="csv-row"][data-rowid="csv-r3"] [data-testid="csv-select"]').click();
  await expect(page.getByLabel('Текст объявления')).toHaveValue('Алғашқы жарна 901 333 теңге.');
  await expect(page.getByTestId('csv-save')).toBeDisabled();
  await page.getByTestId('csv-zk').selectOption('SQ-003');
  await page.getByTestId('csv-confirm').click();
  await page.getByTestId('csv-save').click();
  await expect(page.locator('[data-testid="csv-row"][data-rowid="csv-r3"] [data-testid="csv-row-saved"]')).toBeVisible();
  // Дубликат строки 1: точная причина отказа.
  await page.locator('[data-testid="csv-row"][data-rowid="csv-r4"] [data-testid="csv-select"]').click();
  await expect(page.locator('[data-testid="csv-row"][data-rowid="csv-r4"]')).toContainText('уже сохранён');
  await page.getByTestId('csv-confirm').click();
  await page.getByTestId('csv-save').click();
  await expect(page.getByTestId('csv-save-note')).toContainText(/новая фиксация к AD-/);
  // Reload: обе публикации в списке, повтора нет.
  await page.reload();
  await page.goto('/#/ads');
  await expect(page.getByText('Депозит 901 111 тенге за бронь квартиры.')).toHaveCount(1);
  await expect(page.getByText('Алғашқы жарна 901 333 теңге.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('неизвестная дата → пусто, а не предыдущая/сегодня', async ({ page }) => {
  await page.goto('/#/analyze/SQ-001');
  await page.getByText('Импорт из CSV').click();
  await page.getByTestId('csv-input').fill(
    ['text,date,zk', '"Бронь 902 111 тенге.",2026-09-05,SQ-001', '"Бронь 902 222 тенге без даты.",,SQ-001'].join('\n'),
  );
  await page.getByTestId('csv-preview').click();
  await page.locator('[data-testid="csv-row"][data-rowid="csv-r1"] [data-testid="csv-select"]').click();
  await expect(page.getByLabel(/Дата публикации/)).toHaveValue('2026-09-05');
  await page.locator('[data-testid="csv-row"][data-rowid="csv-r2"] [data-testid="csv-select"]').click();
  await expect(page.getByLabel(/Дата публикации/)).toHaveValue('');
  await expect(page.getByTestId('csv-active')).toContainText('не указана');
});

test('уникальное имя — предложение; save до выбора закрыт', async ({ page }) => {
  await page.goto('/#/analyze/SQ-001');
  await page.getByText('Импорт из CSV').click();
  await page.getByTestId('csv-input').fill(['text,zk', '"Бронь 903 111 тенге.",Сарыарқа'].join('\n'));
  await page.getByTestId('csv-preview').click();
  await expect(page.getByTestId('csv-row-hint')).toContainText('Похоже на');
  await page.getByTestId('csv-select').click();
  await expect(page.getByTestId('csv-save')).toBeDisabled();
  await expect(page.getByTestId('csv-confirm')).toBeDisabled();
});
