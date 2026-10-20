import { expect, test, type Page } from '@playwright/test';
async function stub(page:Page, delayed=false) {
  await page.route('**/src/lib/analysis.ts',r=>r.fulfill({contentType:'application/javascript',body:`
    export const canonicalRunInput=JSON.stringify;
    export const newRunId=()=>crypto.randomUUID();
    export async function analyze(input,{signal}) {
      window.__aborted=false;
      signal.addEventListener('abort',()=>window.__aborted=true);
      ${delayed ? 'await new Promise((resolve,reject)=>{(window.__tasks??=[]).push({resolve,reject});});' : ''}
      return {engine:'Fixture R2/R3',realAI:false,hypotheses:[{id:'h2',code:'R2',quote:'Депозит',reason:'Оплата'},{id:'h3',code:'R3',quote:'строящемся доме',reason:'Реклама'}]};
    }` }));
  await page.goto('/#/analyze/SQ-001',{waitUntil:'domcontentloaded'});
  await page.getByLabel('Текст объявления').fill('Депозит обязателен. Квартира в строящемся доме.');
}
async function run(page:Page) {await page.getByRole('button',{name:'Проанализировать',exact:true}).click();}
async function settle(page:Page,fail=false) {await page.evaluate(fail=>{const w=window as any; const task=w.__tasks.shift(); fail ? task.reject(new Error('late old error')) : task.resolve();},fail);}
test('triage retains one publication; only a case fact adds +25 after reload',async({page})=>{
  // Includes two full reloads of the development module graph, plus case verification.
  test.setTimeout(120000);
  await stub(page); await run(page);
  const h2=page.locator('.hypothesis').filter({hasText:'R2 · гипотеза'}),h3=page.locator('.hypothesis').filter({hasText:'R3 · гипотеза'});
  await h2.getByLabel('Обоснование аналитика').fill('Подтверждена просьба внести деньги');
  await h2.getByRole('button',{name:'Принять гипотезу R2'}).click();
  await expect(page.getByText('Публикация сохранена. Триаж гипотезы не начисляет баллы.')).toBeVisible();
  await expect(h3.getByRole('button',{name:'Отклонить гипотезу'})).toBeEnabled();
  await h3.getByLabel('Обоснование аналитика').fill('Не хватает материала о вводе');
  await h3.getByRole('button',{name:'Отклонить гипотезу'}).click();
  await expect(page.locator('.ai-review-history')).toContainText('Не хватает материала о вводе');
  await page.unroute('**/src/lib/analysis.ts');
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.locator('.ai-review-history')).toContainText('Подтверждена просьба внести деньги');
  await expect(page.locator('.ai-review-history')).toContainText('Не хватает материала о вводе');
  const env=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!));
  expect(env.state.ads.filter((a:any)=>a.text==='Депозит обязателен. Квартира в строящемся доме.')).toHaveLength(1);
  const artifact=env.state.artifacts.find((a:any)=>a.adId===env.state.ads.find((a:any)=>a.text==='Депозит обязателен. Квартира в строящемся доме.').id);
  const claims=env.state.claims.filter((c:any)=>c.artifactId===artifact.id);
  expect(claims.find((c:any)=>c.code==='R2').triage).toBe('accepted');
  expect(claims.find((c:any)=>c.code==='R3').triage).toBe('rejected');
  expect(env.state.assertions??[]).toHaveLength(0);
  await page.goto('/#/complexes/SQ-001?tab=verification',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Начать расследование',exact:true}).click();
  await expect(page.locator('.risk-score strong')).toHaveText('35');
  await page.getByLabel('Дата доказательства',{exact:true}).fill('2026-10-19');
  await page.getByLabel('Обоснование проверки факта',{exact:true}).fill('Проверена дословная просьба оплаты');
  await page.getByRole('button',{name:'Подтвердить факт R2',exact:true}).click();
  await expect(page.locator('.risk-score strong')).toHaveText('25');
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.locator('.risk-score strong')).toHaveText('25');
});
for(const field of ['Текст объявления','Ссылка на источник','Аккаунт','Дата публикации (пусто — не указана)','Площадка','Объект','Скриншот / документ']) {
  test(`stale snapshot blocks save after ${field} change during request`,async({page})=>{
    await stub(page,true); await run(page);
    await expect.poll(()=>page.evaluate(()=>(window as any).__tasks?.length ?? 0)).toBe(1);
    const target=field==='Объект' ? page.locator('select').first() : page.getByLabel(field,{exact:true});
    if(field==='Объект') await target.selectOption('SQ-002');
    else if(field==='Скриншот / документ') await target.setInputFiles({name:'changed.pdf',mimeType:'application/pdf',buffer:Buffer.from('changed')});
    else await target.fill(field.startsWith('Дата') ? '2026-10-17' : field.startsWith('Ссылка') ? 'https://changed.test' : 'Изменённый ввод');
    await settle(page); await expect(page.getByText('Ввод изменён — повторите анализ перед сохранением.')).toBeVisible();
    await expect(page.getByRole('button',{name:'Принять гипотезу R2'})).toBeDisabled();
    await expect(page.getByRole('button',{name:'Сохранить без подтверждения'})).toBeDisabled();
  });
}
test('cancel/new run ignores late success and error; unmount aborts',async({page})=>{
  await stub(page,true); await run(page);
  await expect.poll(()=>page.evaluate(()=>(window as any).__tasks?.length ?? 0)).toBe(1);
  await page.getByRole('button',{name:'Отменить анализ'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__aborted)).toBe(true);
  await run(page); await expect.poll(()=>page.evaluate(()=>(window as any).__tasks.length)).toBe(2);
  await settle(page,true); await expect(page.getByRole('alert')).toHaveCount(0);
  await settle(page); await expect(page.getByText('Fixture R2/R3')).toBeVisible();
  await run(page); await expect.poll(()=>page.evaluate(()=>(window as any).__tasks.length)).toBe(1);
  await page.getByRole('link',{name:/S SAQ QURYLYS/}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__aborted)).toBe(true);
  await settle(page,true); await expect(page.getByRole('alert')).toHaveCount(0);
});
test('session change aborts pending run and discards late results/errors',async({page})=>{
  await stub(page,true); await run(page);
  await expect.poll(()=>page.evaluate(()=>(window as any).__tasks?.length ?? 0)).toBe(1);
  await page.evaluate(async()=>{const path='/src/lib/repository.ts';const repo=await import(/* @vite-ignore */ path);repo.trackAuthSession('other-user');});
  await expect.poll(()=>page.evaluate(()=>(window as any).__aborted)).toBe(true);
  await settle(page,true); await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.getByText('Fixture R2/R3')).toHaveCount(0);
});

test('ordinary Analyze dedupe keeps the persisted ad ID for the next independent review',async({page})=>{
 await stub(page);await run(page);await page.getByRole('button',{name:'Сохранить без подтверждения',exact:true}).click();await expect(page.getByText('Публикация сохранена. Триаж гипотезы не начисляет баллы.')).toBeVisible();
 await page.goto('/#/overview',{waitUntil:'domcontentloaded'});await page.goto('/#/analyze/SQ-001',{waitUntil:'domcontentloaded'});await page.getByLabel('Текст объявления').fill('Депозит обязателен. Квартира в строящемся доме.');await page.getByLabel('Ссылка на источник').fill('https://example.test/second-sighting');await run(page);
 const h2=page.locator('.hypothesis').filter({hasText:'R2 · гипотеза'}),h3=page.locator('.hypothesis').filter({hasText:'R3 · гипотеза'});
 await h2.getByLabel('Обоснование аналитика').fill('Повтор: платёжное предложение');await h2.getByRole('button',{name:'Принять гипотезу R2'}).click();await expect(page.getByText('Публикация сохранена. Триаж гипотезы не начисляет баллы.')).toBeVisible();
 await h3.getByLabel('Обоснование аналитика').fill('Отказ: нет материала до ввода');await h3.getByRole('button',{name:'Отклонить гипотезу'}).click();await expect(page.locator('.ai-review-history')).toContainText('Отказ: нет материала до ввода');await expect(page.getByRole('alert')).toHaveCount(0);
 const env=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!));const ads=env.state.ads.filter((a:any)=>a.text==='Депозит обязателен. Квартира в строящемся доме.');expect(ads).toHaveLength(1);const artifact=env.state.artifacts.find((a:any)=>a.adId===ads[0].id);expect(env.state.claims.filter((c:any)=>c.artifactId===artifact.id).map((c:any)=>c.triage).sort()).toEqual(['accepted','rejected']);expect(env.state.assertions??[]).toHaveLength(0);
});
