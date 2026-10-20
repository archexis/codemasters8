import { expect, test, type Page } from '@playwright/test';
import { applyCommand, initialState } from '../../src/lib/domain';
import type { AppState } from '../../src/lib/types';

async function install(page: Page, state: AppState) {
  await page.addInitScript(state => {
    if (!localStorage.getItem('sq_svelte_demo_v2')) localStorage.setItem('sq_svelte_demo_v2', JSON.stringify({ envelope: 1, state, version: 1, receipts: {} }));
  }, state);
}

test('fact comments stay beside their own quote and never carry into another fact', async ({ page }, info) => {
  if(info.project.name==='mobile')await page.setViewportSize({width:390,height:844});
  let state=initialState();
  const text='Депозит 321 000 тенге. Первоначальный взнос 456 000 тенге.';
  const run=(command:unknown)=>{state=applyCommand(state,command,'test');};
  run({type:'ad',ad:{...state.ads[0],id:'DRAFT-PROOFS',zkId:'SQ-003',text,date:'2026-10-20'},decision:'saved',comment:''});
  run({type:'artifact.register',artifact:{id:'DRAFT-ART',complexId:'SQ-003',kind:'publication',source:'Тестовый источник',text,date:'2026-10-20',adId:'DRAFT-PROOFS'}});
  run({type:'case.create',id:'DRAFT-CASE',complexId:'SQ-003'});
  for(const [i,quote] of ['Депозит 321 000 тенге.','Первоначальный взнос 456 000 тенге.'].entries())
    run({type:'claim.propose',claim:{id:`DRAFT-${i}`,complexId:'SQ-003',artifactId:'DRAFT-ART',code:'R2',quote}});
  await install(page,state);
  await page.goto('/#/cases/DRAFT-CASE?tab=verification');
  const first=page.getByRole('article',{name:'Проверка R2: Депозит 321 000 тенге.',exact:true});
  const second=page.getByRole('article',{name:'Проверка R2: Первоначальный взнос 456 000 тенге.',exact:true});
  await first.getByLabel('Обоснование проверки факта',{exact:true}).fill('Проверен первый платёж');
  await expect(second.getByLabel('Обоснование проверки факта',{exact:true})).toHaveValue('');
  await expect(second.getByRole('button',{name:'Подтвердить факт R2',exact:true})).toBeDisabled();
  await second.getByLabel('Обоснование проверки факта',{exact:true}).fill('Второй платёж требует уточнения');
  await first.getByRole('button',{name:'Подтвердить факт R2',exact:true}).click();
  await expect(second.getByLabel('Обоснование проверки факта',{exact:true})).toHaveValue('Второй платёж требует уточнения');
  await second.getByRole('button',{name:'Отклонить факт',exact:true}).click();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state);
  expect(saved.assertions.map((f:any)=>({claimId:f.claimId,status:f.status,comment:f.comment}))).toEqual([
    {claimId:'DRAFT-0',status:'verified',comment:'Проверен первый платёж'},
    {claimId:'DRAFT-1',status:'rejected',comment:'Второй платёж требует уточнения'},
  ]);
  await expect(page.locator('.risk-score strong')).toHaveText('25');
  await second.scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('fact-review-inline.png')});
});

test('object draft survives tabs, a cancelled departure and a failed save', async ({ page }) => {
  await page.goto('/#/complexes/SQ-003');
  await page.getByRole('button', { name: 'Редактировать сведения ЖК', exact: true }).click();
  const editor = page.getByRole('heading', { name: 'Редактировать объект', exact: true }).locator('..');
  await editor.getByLabel('Название', { exact: true }).fill('Несохранённое название');
  await editor.getByLabel('Примечание', { exact: true }).fill('Мой черновик');
  await page.getByRole('tab', { name: 'Связи', exact: true }).click();
  await expect(editor).toBeHidden();
  await page.getByRole('tab', { name: 'Обзор', exact: true }).click();
  await expect(editor.getByLabel('Название', { exact: true })).toHaveValue('Несохранённое название');
  await expect(editor.getByLabel('Примечание', { exact: true })).toHaveValue('Мой черновик');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('link', { name: '← К каталогу', exact: true }).click();
  await expect(page).toHaveURL(/complexes\/SQ-003/);
  await expect(editor.getByLabel('Примечание', { exact: true })).toHaveValue('Мой черновик');
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'sq_svelte_demo_v2') throw new DOMException('full', 'QuotaExceededError');
      return write.call(this, key, value);
    };
  });
  await editor.getByRole('button', { name: 'Сохранить объект', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('хранилище заполнено');
  await expect(editor.getByLabel('Примечание', { exact: true })).toHaveValue('Мой черновик');
  await expect(page.getByText('Изменения сохранены', { exact: true })).toHaveCount(0);
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('sq_svelte_demo_v2') ?? 'null'));
  expect(persisted).toBeNull();
});

test('a closed October case allows a new November case and explicit history selection', async ({ page }) => {
  let state = initialState();
  state = applyCommand(state, { type: 'case.create', id: 'OCTOBER', complexId: 'SQ-003', period: { from: '2026-10-01', to: '2026-10-31' } }, 'test');
  state = applyCommand(state, { type: 'case.decide', caseId: 'OCTOBER', status: 'returned', comment: 'Проверка октября завершена' }, 'test');
  await install(page, state);
  await page.goto('/#/complexes/SQ-003');
  await page.getByText('Период применимости нового дела', { exact: true }).click();
  await page.getByLabel('Проверяемый период с', { exact: true }).fill('2026-11-01');
  await page.getByLabel('Проверяемый период по', { exact: true }).fill('2026-11-30');
  await page.getByRole('button', { name: 'Создать новое дело', exact: true }).click();
  await expect(page).toHaveURL(/cases\/CASE-/);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state);
  expect(stored.cases).toHaveLength(2);
  expect(stored.cases[0]).toMatchObject({ id: 'OCTOBER', status: 'returned', period: { from: '2026-10-01', to: '2026-10-31' } });
  expect(stored.cases[1].period).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  await page.getByRole('combobox', { name: 'Открыть дело', exact: true }).selectOption('OCTOBER');
  await expect(page).toHaveURL(/cases\/OCTOBER/);
  await expect(page.locator('.case-toolbar')).toContainText('2026-10-01 — 2026-10-31');
});

test('signal groups two R2 proofs under one weighted factor in preview and saved revision', async ({ page }) => {
  let state = initialState();
  const text = 'Депозит 321 000 тенге. Первоначальный взнос 456 000 тенге.';
  const run = (command: unknown) => { state = applyCommand(state, command, 'test'); };
  run({ type: 'ad', ad: { ...state.ads[0], id: 'TWO-PROOFS', zkId: 'SQ-003', text, date: '2026-10-20' }, decision: 'saved', comment: '' });
  run({ type: 'artifact.register', artifact: { id: 'ART-PROOFS', complexId: 'SQ-003', kind: 'publication', source: 'Тестовый источник', text, date: '2026-10-20', adId: 'TWO-PROOFS' } });
  run({ type: 'case.create', id: 'CASE-PROOFS', complexId: 'SQ-003' });
  run({ type: 'case.attach', caseId: 'CASE-PROOFS', artifactId: 'ART-PROOFS' });
  for (const [i, quote] of ['Депозит 321 000 тенге.', 'Первоначальный взнос 456 000 тенге.'].entries()) {
    run({ type: 'claim.propose', claim: { id: `CLAIM-${i}`, complexId: 'SQ-003', artifactId: 'ART-PROOFS', code: 'R2', quote } });
    run({ type: 'fact.review', caseId: 'CASE-PROOFS', claimId: `CLAIM-${i}`, status: 'verified', evidence: { source: 'Тестовый источник', date: '2026-10-20' }, comment: 'Сверено с оригиналом' });
  }
  await install(page, state);
  await page.goto('/#/cases/CASE-PROOFS');
  await page.getByRole('button', { name: 'Предпросмотр сигнала', exact: true }).click();
  const sheet = page.locator('.case-signal-sheet');
  await expect(sheet.locator('.formula')).toHaveText('R2 +25');
  await expect(sheet.locator('.risk-score strong')).toHaveText('25');
  await expect(sheet.getByRole('heading', { name: /^R2 \+25/ })).toHaveCount(1);
  await expect(sheet.locator('blockquote')).toHaveCount(2);
  await page.getByLabel('Обоснование решения', { exact: true }).fill('Оба независимых подтверждения сверены');
  await page.getByRole('button', { name: 'Подтвердить сигнал', exact: true }).click();
  await expect(sheet).toContainText('Версия 1');
  await expect(sheet.locator('.formula')).toHaveText('R2 +25');
  await expect(sheet.locator('blockquote')).toHaveCount(2);
});
