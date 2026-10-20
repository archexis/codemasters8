import {expect,test} from '@playwright/test';

test('AI triage accepts a verbatim candidate without adding risk points',async({page})=>{
 await page.goto('/#/publications?add=1&complex=SQ-003',{waitUntil:'domcontentloaded'});
 await page.getByLabel('Текст объявления',{exact:true}).fill('Новая платная бронь квартиры 734 000 тенге. Срок сдачи в 2027 году.');
 await page.getByLabel('Дата публикации (пусто — не указана)',{exact:true}).fill('2026-10-19');
 await page.getByRole('button',{name:'Проанализировать',exact:true}).click();
 const hypothesis=page.locator('.hypothesis').filter({has:page.getByRole('button',{name:'Принять гипотезу R2',exact:true})});
 await expect(hypothesis).toBeVisible();
 await hypothesis.getByLabel('Обоснование аналитика').fill('Цитата дословно совпадает с новым первоисточником.');
 await hypothesis.getByRole('button',{name:'Принять гипотезу R2',exact:true}).click();
 await expect(page.getByText('Публикация сохранена. Триаж гипотезы не начисляет баллы.')).toBeVisible();
 await page.goto('/#/complexes/SQ-003?tab=verification',{waitUntil:'domcontentloaded'});
 await expect(page.locator('.risk-score strong')).toHaveText('10');
 await expect(page.locator('.hypothesis')).toContainText('Гипотеза принята');
 await expect(page.locator('.hypothesis').filter({has:page.locator('blockquote').filter({hasText:'Новая платная бронь квартиры 734 000'})}).getByRole('button',{name:'Подтвердить факт R2',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Начать расследование',exact:true}).click();
 await expect(page.locator('.risk-score strong')).toHaveText('10');
 await expect(page.locator('.hypothesis').filter({has:page.locator('blockquote').filter({hasText:'Новая платная бронь квартиры 734 000'})}).getByRole('button',{name:'Подтвердить факт R2',exact:true})).toBeVisible();
});

test('publications keep their filters after dossier navigation and reload',async({page})=>{
 await page.goto('/#/publications',{waitUntil:'domcontentloaded'});
 await page.getByRole('searchbox',{name:'Поиск',exact:true}).fill('Резервирование');
 const count=await page.getByRole('button',{name:'Оригинал и гипотезы',exact:true}).count();
 expect(count).toBeGreaterThan(0);
 await page.getByRole('button',{name:'Оригинал и гипотезы',exact:true}).first().click();
 await page.getByRole('link',{name:'Открыть проверку в досье',exact:true}).click();
 await page.goto('/#/publications',{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('searchbox',{name:'Поиск',exact:true})).toHaveValue('Резервирование');
 await expect(page.getByRole('button',{name:'Оригинал и гипотезы',exact:true})).toHaveCount(count);
 await page.reload({waitUntil:'domcontentloaded'});
 await expect(page.getByRole('searchbox',{name:'Поиск',exact:true})).toHaveValue('Резервирование');
});

test('case deep link cannot switch its scope using a forged phase parameter',async({page})=>{
 await page.goto('/#/complexes/SQ-001',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Начать расследование',exact:true}).click();
 await expect(page).toHaveURL(/#\/cases\/CASE-/);
 const caseUrl=page.url().split('?')[0];
 await page.goto(`${caseUrl}?phase=PH-NOT-OWNED&tab=verification`,{waitUntil:'domcontentloaded'});
 await expect(page.locator('.case-toolbar')).toBeVisible();
 await expect(page.getByRole('combobox',{name:'Область проверки'})).toHaveValue('');
 await expect(page.getByRole('heading',{name:'Источники и проверка утверждений'})).toBeVisible();
});

test('documented relation has independent review and does not add risk points',async({page})=>{
 await page.goto('/#/registries',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Добавить документ',exact:true}).click();
 const form=page.locator('form').filter({has:page.getByRole('heading',{name:'Ручной импорт документа',exact:true})});
 await form.getByLabel(/^ЖК/).selectOption('SQ-001');
 await form.getByLabel('Источник / номер документа').fill('Документ отношения E2E');
 await form.getByLabel('Дата документа, если известна').fill('2026-10-19');
 await form.getByLabel('Исходное содержание / текст выбранной страницы').fill('Документ содержит упоминание двух жилых комплексов, применимость роли проверяется аналитиком.');
 await form.getByRole('button',{name:'Сохранить документ',exact:true}).click();
 await expect(page.getByText('Документ сохранён. Применимость проверяется в досье.',{exact:true})).toBeVisible();
 await page.goto('/#/complexes/SQ-001?tab=relations',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Добавить типизированную связь',exact:true}).click();
 const relationForm=page.locator('form').filter({has:page.getByRole('heading',{name:'Новая связь · кандидат',exact:true})});
 await relationForm.getByLabel('Откуда').selectOption('complex:SQ-001');
 await relationForm.getByLabel(/^Куда/).selectOption('complex:SQ-002');
 await relationForm.getByLabel('Тип отношения').selectOption('mentions');
 await relationForm.getByLabel('Первичные материалы отношения').selectOption({label:'Документ отношения E2E'});
 await relationForm.getByRole('button',{name:'Сохранить кандидата связи',exact:true}).click();
 await page.getByRole('button',{name:'Список',exact:true}).click();
 await page.locator('.relation-row').filter({hasText:'Упоминает'}).click();
 await page.getByLabel('Обоснование проверки связи').fill('Упоминание обоих комплексов сверено с документом; это не факт правонарушения.');
 await page.getByRole('button',{name:'Подтвердить связь',exact:true}).click();
 await expect(page.locator('.relation-row').filter({hasText:'Упоминает'})).toContainText('Подтверждена');
 await expect(page.locator('.risk-score strong')).toHaveText('35');
 await page.reload({waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Список',exact:true}).click();
 await expect(page.locator('.relation-row').filter({hasText:'Упоминает'})).toContainText('Подтверждена');
});

test('a dated case retains its applicability period in a returned signal snapshot',async({page})=>{
 await page.goto('/#/complexes/SQ-001',{waitUntil:'domcontentloaded'});
 await page.getByText('Период применимости нового дела',{exact:true}).click();
 await page.getByLabel('Проверяемый период с',{exact:true}).fill('2026-10-01');
 await page.getByLabel('Проверяемый период по',{exact:true}).fill('2026-10-19');
 await page.getByRole('button',{name:'Начать расследование',exact:true}).click();
 await expect(page.locator('.case-toolbar')).toContainText('2026-10-01 — 2026-10-19');
 await page.getByRole('button',{name:'Предпросмотр сигнала',exact:true}).click();
 await page.getByLabel('Обоснование решения',{exact:true}).fill('Датированное дело требует дополнительных материалов.');
 await page.getByRole('button',{name:'Вернуть на проверку',exact:true}).click();
 await expect(page.locator('.case-signal-sheet')).toContainText('Период применимости: 2026-10-01 — 2026-10-19');
 await page.reload({waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Предпросмотр сигнала',exact:true}).click();
 await expect(page.locator('.case-signal-sheet')).toContainText('Период применимости: 2026-10-01 — 2026-10-19');
});
