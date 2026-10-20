import {expect,test} from '@playwright/test';
import {manualCase,verifyFact} from '../helpers/case-ui';
test('map search, risk filter, dossier and direct reload',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#/map',{waitUntil:'domcontentloaded'});
 await page.getByLabel('Поиск ЖК, БИН или адреса на карте').fill('Сарыарқа');
 await page.getByLabel('Базовая зона риска').selectOption('red');
 await page.getByRole('button',{name:/Список ·/}).click();
 await page.locator('.map-list-body button').click();
 await page.getByRole('button',{name:'Открыть досье',exact:true}).click();
 await expect(page.locator('.risk-score strong')).toHaveText('70');
 await page.reload({waitUntil:'domcontentloaded'});await expect(page).toHaveTitle('Досье · SAQ QURYLYS');expect(errors).toEqual([]);
});
test('independent triage decisions survive reload without verifying facts',async({page})=>{
 for(const decision of ['Отклонить гипотезу','Принять гипотезу R2']) {
  await page.goto('/#/publications?add=1&complex=SQ-003',{waitUntil:'domcontentloaded'});
  await page.getByLabel('Текст объявления').fill('Депозит 345 000 тенге для новой квартиры. '+decision);
  await page.getByRole('button',{name:'Проанализировать',exact:true}).click();
  await page.getByLabel('Обоснование аналитика').fill('Решение по извлечению, факт проверяется отдельно');
  await page.getByRole('button',{name:decision,exact:true}).click();
  await expect(page.getByText('Публикация сохранена. Триаж гипотезы не начисляет баллы.')).toBeVisible();
 }
 await page.reload({waitUntil:'domcontentloaded'});await expect(page.locator('.ai-review-history')).toContainText('Решение по извлечению');
 const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state);
 expect(state.claims.map((c:any)=>c.triage).sort()).toEqual(['accepted','rejected']);expect(state.assertions??[]).toHaveLength(0);
});
test('verified case signal survives reload and prints its snapshot',async({page},info)=>{
 await manualCase(page);await verifyFact(page);
 await page.getByRole('button',{name:'Предпросмотр сигнала',exact:true}).click();
 await page.getByLabel('Обоснование решения').fill('Проверены источники и основание');
 await page.getByRole('button',{name:'Подтвердить сигнал',exact:true}).click();
 await expect(page.locator('.case-signal-sheet')).toContainText('Версия 1');
 await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Предпросмотр сигнала',exact:true}).click();
 await expect(page.locator('.case-signal-sheet')).toContainText('Проверены источники и основание');
 await page.emulateMedia({media:'print'});await expect(page.locator('header')).toBeHidden();
 await expect(page.getByRole('button',{name:'Подтвердить сигнал'})).toBeHidden();
 await page.pdf({path:info.outputPath('case-signal.pdf'),format:'A4'});
});
test('document file survives reload; readiness observation does not confirm R5',async({page})=>{
 await page.goto('/#/registries',{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Добавить документ',exact:true}).click();
 await page.getByLabel(/^ЖК/).selectOption('SQ-002');
 await page.getByLabel('Источник / номер документа').fill('Проверка сохранения фото');
 await page.getByLabel('Исходное содержание / текст выбранной страницы').fill('Осмотр строительства, синтетическое доказательство.');
 await page.getByLabel('Оригинал PDF / изображение').setInputFiles({name:'inspection.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});
 await page.getByRole('button',{name:'Сохранить документ',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Документ сохранён'})).toContainText('Документ сохранён');
 await page.reload({waitUntil:'domcontentloaded'});await page.goto('/#/complexes/SQ-002',{waitUntil:'domcontentloaded'});
 await expect(page.getByAltText('Проверка сохранения фото')).toBeVisible();
 await page.getByText('Зафиксировать документальную готовность',{exact:true}).click();
 await page.getByLabel('Готовность по документу, %').fill('12');await page.getByLabel('Дата наблюдения',{exact:true}).fill('2026-10-19');
 await page.getByLabel('Источник измеренной готовности').fill('Осмотр 19 октября');
 await page.getByRole('button',{name:'Сохранить наблюдение',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Наблюдение сохранено'})).toContainText('Баллы требуют отдельной проверки');
 await expect(page.locator('.factor-row').filter({hasText:'R5'})).toContainText('Нет проверенного факта');
});
test('create/edit object, empty search, unknown route and narrow layout',async({page})=>{
 await page.goto('/#/registries',{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Добавить ЖК',exact:true}).click();
 await page.getByLabel('Название',{exact:true}).fill('Новый тестовый ЖК');await page.getByLabel('Адрес',{exact:true}).fill('Тестовый адрес 42');
 await expect(page.getByLabel('Дата сверки',{exact:true})).toHaveValue('');
 await page.getByRole('button',{name:'Сохранить объект',exact:true}).click();await expect(page.getByRole('heading',{name:'Новый объект',exact:true})).toHaveCount(0);
 await page.getByRole('searchbox').fill('Новый тестовый ЖК');
 await page.locator('tbody a').first().click();await page.getByRole('button',{name:'Редактировать сведения ЖК',exact:true}).click();
 await page.getByLabel('Название',{exact:true}).fill('Обновлённый тестовый ЖК');await page.getByRole('button',{name:'Сохранить объект',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Обновлённый тестовый ЖК',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.goto('/#/missing',{waitUntil:'domcontentloaded'});await expect(page.getByRole('heading',{name:'Страница не найдена'})).toBeVisible();
});
test('analysis route preserves explicitly supplied input',async({page})=>{
 const text='Платная бронь 500 000 тенге.';
 await page.goto('/#/publications?add=1&complex=SQ-001&text='+encodeURIComponent(text),{waitUntil:'domcontentloaded'});
 await expect(page.getByLabel('Текст объявления')).toHaveValue(text);
});
