import {expect,test} from '@playwright/test';
import {manualCase,verifyFact,manualCandidate} from '../helpers/case-ui';

test('C: verified guarantee prevents R1 in a new case',async({page})=>{
 await page.goto('/#/registries',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Добавить документ',exact:true}).click();
 await page.getByLabel('Тип материала').selectOption('legal-review');
 await page.getByLabel(/^ЖК/).selectOption('SQ-003');
 await page.getByLabel('Источник / номер документа').fill('Сверка гарантии');
 await page.getByLabel('Дата документа, если известна').fill('2026-10-19');
 const quote='Гарантия Единого оператора подтверждена, отсутствие не установлено.';
 await page.getByLabel('Исходное содержание / текст выбранной страницы').fill(quote);
 await page.getByRole('button',{name:'Сохранить документ',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Документ сохранён'})).toContainText('Документ сохранён');
 await page.goto('/#/complexes/SQ-003?tab=verification',{waitUntil:'domcontentloaded'});
 await expect(page.locator('.risk-score strong')).toHaveText('10');
 await page.getByRole('button',{name:'Начать расследование',exact:true}).click();
 const manual=page.locator('details').filter({has:page.getByText('Выделить утверждение вручную',{exact:true})});
 await manual.locator('summary').click();
 await manual.getByLabel('Первичный материал').selectOption({label:'Сверка гарантии'});
 await manual.getByLabel('Фактор').selectOption('R1');
 await manual.getByLabel('Точная цитата').fill(quote);
 await manual.getByRole('button',{name:'Создать кандидата'}).click();
 await verifyFact(page,'R1');
 await expect(page.getByRole('alert')).toContainText('R1 требует');
 await expect(page.locator('.risk-score strong')).toHaveText('10');
});
test('new publication and verified R2 add 25 only within the active case',async({page})=>{
 await manualCase(page);await expect(page.locator('.risk-score strong')).toHaveText('10');
 await verifyFact(page);await expect(page.locator('.risk-score strong')).toHaveText('25');
});
test('withdrawing a case fact reduces its score and keeps the review history',async({page})=>{
 await manualCase(page);await verifyFact(page);
 await expect(page.locator('.risk-score strong')).toHaveText('25');
 await page.getByLabel('Обоснование проверки факта',{exact:true}).fill('Повторная сверка: применимость не подтверждена');
 await manualCandidate(page).getByRole('button',{name:'Отклонить факт',exact:true}).click();
 await expect(page.locator('.risk-score strong')).toHaveText('0');
 await page.reload({waitUntil:'domcontentloaded'});await expect(manualCandidate(page)).toContainText('Факт отклонён');
 const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state);
 expect(state.assertions.map((a:any)=>a.status)).toEqual(['verified','rejected']);
});
test('invented quote is rejected and remains editable',async({page})=>{
 await manualCase(page);
 const field=page.getByLabel('Точная цитата',{exact:true});
 await field.fill('выдуманная цитата не из текста');
 await page.getByRole('button',{name:'Создать кандидата',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Цитата должна дословно присутствовать');
 await expect(field).toHaveValue('выдуманная цитата не из текста');
 await expect(page.locator('.risk-score strong')).toHaveText('10');
});
