# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ux-review.spec.ts >> publications keep their filters after dossier navigation and reload
- Location: tests\e2e\ux-review.spec.ts:22:1

# Error details

```
Error: page.goto: Test ended.
Call log:
  - navigating to "http://127.0.0.1:5176/#/publications", waiting until "load"

```

# Test source

```ts
  1  | import {expect,test} from '@playwright/test';
  2  | 
  3  | test('AI triage accepts a verbatim candidate without adding risk points',async({page})=>{
  4  |  await page.goto('/#/publications?add=1&complex=SQ-003');
  5  |  await page.getByLabel('Текст объявления',{exact:true}).fill('Новая платная бронь квартиры 734 000 тенге. Срок сдачи в 2027 году.');
  6  |  await page.getByLabel('Дата публикации (пусто — не указана)',{exact:true}).fill('2026-10-19');
  7  |  await page.getByRole('button',{name:'Проанализировать',exact:true}).click();
  8  |  const hypothesis=page.locator('.hypothesis').filter({has:page.getByRole('button',{name:'Принять гипотезу R2',exact:true})});
  9  |  await expect(hypothesis).toBeVisible();
  10 |  await hypothesis.getByLabel('Обоснование аналитика').fill('Цитата дословно совпадает с новым первоисточником.');
  11 |  await hypothesis.getByRole('button',{name:'Принять гипотезу R2',exact:true}).click();
  12 |  await expect(page.getByText('Публикация сохранена. Триаж гипотезы не начисляет баллы.')).toBeVisible();
  13 |  await page.goto('/#/complexes/SQ-003?tab=verification');
  14 |  await expect(page.locator('.risk-score strong')).toHaveText('10');
  15 |  await expect(page.locator('.hypothesis')).toContainText('Гипотеза принята');
  16 |  await expect(page.getByRole('button',{name:'Подтвердить факт R2',exact:true})).toHaveCount(0);
  17 |  await page.getByRole('button',{name:'Начать расследование',exact:true}).click();
  18 |  await expect(page.locator('.risk-score strong')).toHaveText('0');
  19 |  await expect(page.getByRole('button',{name:'Подтвердить факт R2',exact:true})).toBeVisible();
  20 | });
  21 | 
  22 | test('publications keep their filters after dossier navigation and reload',async({page})=>{
> 23 |  await page.goto('/#/publications');
     |             ^ Error: page.goto: Test ended.
  24 |  await page.getByRole('searchbox',{name:'Поиск',exact:true}).fill('брон');
  25 |  const count=await page.getByRole('button',{name:'Оригинал и гипотезы',exact:true}).count();
  26 |  expect(count).toBeGreaterThan(0);
  27 |  await page.getByRole('button',{name:'Оригинал и гипотезы',exact:true}).first().click();
  28 |  await page.getByRole('link',{name:'Открыть проверку в досье',exact:true}).click();
  29 |  await page.goto('/#/publications');
  30 |  await expect(page.getByRole('searchbox',{name:'Поиск',exact:true})).toHaveValue('брон');
  31 |  await expect(page.getByRole('button',{name:'Оригинал и гипотезы',exact:true})).toHaveCount(count);
  32 |  await page.reload();
  33 |  await expect(page.getByRole('searchbox',{name:'Поиск',exact:true})).toHaveValue('брон');
  34 | });
  35 | 
  36 | test('case deep link cannot switch its scope using a forged phase parameter',async({page})=>{
  37 |  await page.goto('/#/complexes/SQ-001');
  38 |  await page.getByRole('button',{name:'Начать расследование',exact:true}).click();
  39 |  await expect(page).toHaveURL(/#\/cases\/CASE-/);
  40 |  const caseUrl=page.url().split('?')[0];
  41 |  await page.goto(`${caseUrl}?phase=PH-NOT-OWNED&tab=verification`);
  42 |  await expect(page.locator('.case-toolbar')).toBeVisible();
  43 |  await expect(page.getByRole('combobox',{name:'Область проверки'})).toHaveValue('');
  44 |  await expect(page.getByRole('heading',{name:'Источники и проверка утверждений'})).toBeVisible();
  45 | });
  46 | 
  47 | test('documented relation has independent review and does not add risk points',async({page})=>{
  48 |  await page.goto('/#/registries');
  49 |  await page.getByRole('button',{name:'Добавить документ',exact:true}).click();
  50 |  const form=page.locator('form').filter({has:page.getByRole('heading',{name:'Ручной импорт документа',exact:true})});
  51 |  await form.getByLabel(/^ЖК/).selectOption('SQ-001');
  52 |  await form.getByLabel('Источник / номер документа').fill('Документ отношения E2E');
  53 |  await form.getByLabel('Дата документа, если известна').fill('2026-10-19');
  54 |  await form.getByLabel('Исходное содержание / текст выбранной страницы').fill('Документ содержит упоминание двух жилых комплексов, применимость роли проверяется аналитиком.');
  55 |  await form.getByRole('button',{name:'Сохранить документ',exact:true}).click();
  56 |  await expect(page.getByText('Документ сохранён. Применимость проверяется в досье.',{exact:true})).toBeVisible();
  57 |  await page.goto('/#/complexes/SQ-001?tab=relations');
  58 |  await page.getByRole('button',{name:'Добавить типизированную связь',exact:true}).click();
  59 |  const relationForm=page.locator('form').filter({has:page.getByRole('heading',{name:'Новая связь · кандидат',exact:true})});
  60 |  await relationForm.getByLabel('Откуда').selectOption('complex:SQ-001');
  61 |  await relationForm.getByLabel(/^Куда/).selectOption('complex:SQ-002');
  62 |  await relationForm.getByLabel('Тип отношения').selectOption('mentions');
  63 |  await relationForm.getByLabel('Первичные материалы отношения').selectOption({label:'Документ отношения E2E'});
  64 |  await relationForm.getByRole('button',{name:'Сохранить кандидата связи',exact:true}).click();
  65 |  await page.getByRole('button',{name:'Список',exact:true}).click();
  66 |  await page.locator('.relation-row').filter({hasText:'Упоминает'}).click();
  67 |  await page.getByLabel('Обоснование проверки связи').fill('Упоминание обоих комплексов сверено с документом; это не факт правонарушения.');
  68 |  await page.getByRole('button',{name:'Подтвердить связь',exact:true}).click();
  69 |  await expect(page.locator('.relation-row').filter({hasText:'Упоминает'})).toContainText('Подтверждена');
  70 |  await expect(page.locator('.risk-score strong')).toHaveText('35');
  71 |  await page.reload();
  72 |  await page.getByRole('button',{name:'Список',exact:true}).click();
  73 |  await expect(page.locator('.relation-row').filter({hasText:'Упоминает'})).toContainText('Подтверждена');
  74 | });
  75 | 
  76 | test('a dated case retains its applicability period in a returned signal snapshot',async({page})=>{
  77 |  await page.goto('/#/complexes/SQ-001');
  78 |  await page.getByText('Период применимости нового дела',{exact:true}).click();
  79 |  await page.getByLabel('Проверяемый период с',{exact:true}).fill('2026-10-01');
  80 |  await page.getByLabel('Проверяемый период по',{exact:true}).fill('2026-10-19');
  81 |  await page.getByRole('button',{name:'Начать расследование',exact:true}).click();
  82 |  await expect(page.locator('.case-toolbar')).toContainText('2026-10-01 — 2026-10-19');
  83 |  await page.getByRole('button',{name:'Предпросмотр сигнала',exact:true}).click();
  84 |  await page.getByLabel('Обоснование решения',{exact:true}).fill('Датированное дело требует дополнительных материалов.');
  85 |  await page.getByRole('button',{name:'Вернуть на проверку',exact:true}).click();
  86 |  await expect(page.locator('.case-signal-sheet')).toContainText('Период применимости: 2026-10-01 — 2026-10-19');
  87 |  await page.reload();
  88 |  await page.getByRole('button',{name:'Предпросмотр сигнала',exact:true}).click();
  89 |  await expect(page.locator('.case-signal-sheet')).toContainText('Период применимости: 2026-10-01 — 2026-10-19');
  90 | });
  91 | 
```