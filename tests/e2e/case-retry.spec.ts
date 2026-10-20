import {expect,test,type Page} from '@playwright/test';
import {manualCase,verifyFact,manualCandidate} from '../helpers/case-ui';

// Simulate the delivery boundary: persistence and receipt succeed, then ACK is lost.
// The component must recover through the receipt, using the original command ID.
async function loseNextAck(page:Page,action:string){
 await page.evaluate(async(action)=>{
  const modulePath='/src/lib/repository.ts';
  const {UnknownCommitResultError}=await import(modulePath);
  const original=navigator.locks.request.bind(navigator.locks);
  let lose=true;
  navigator.locks.request=(async(...args:any[])=>{
   const result=await (original as any)(...args);
   if(lose&&result?.state?.audit?.[0]?.action===action){lose=false;throw new UnknownCommitResultError('Simulated lost ACK','test');}
   return result;
  }) as typeof navigator.locks.request;
 },action);
}
test('fact review retries its persisted receipt without a second assertion',async({page})=>{
 await manualCase(page);
 await manualCandidate(page).getByLabel('Обоснование проверки факта',{exact:true}).fill('Сверено с первоисточником');
 await loseNextAck(page,'fact.review');
 const button=manualCandidate(page).getByRole('button',{name:'Подтвердить факт R2',exact:true});
 await button.click();await expect(page.getByRole('alert')).toContainText('Simulated lost ACK');
 const first=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state.assertions);
 expect(first).toHaveLength(1);
 await button.click();await expect(manualCandidate(page)).toContainText('Факт проверен');
 const final=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state);
 expect(final.assertions).toEqual(first);
 expect(final.audit.filter((a:any)=>a.action==='fact.review')).toHaveLength(1);
});
test('signal decision retains payload and ID after lost ACK',async({page})=>{
 await manualCase(page);await verifyFact(page);
 await page.getByRole('button',{name:'Предпросмотр сигнала',exact:true}).click();
 const comment=page.getByLabel('Обоснование решения');await comment.fill('Проверены первичные материалы');
 await loseNextAck(page,'case.decide');
 const button=page.getByRole('button',{name:'Подтвердить сигнал',exact:true});
 await button.click();await expect(page.getByRole('alert')).toContainText('Simulated lost ACK');
 await comment.fill('Иное решение');await button.click();
 await expect(page.getByRole('alert')).toContainText('Сначала повторите прежнее решение');
 await comment.fill('Проверены первичные материалы');await button.click();
 await expect(page.locator('.case-signal-sheet')).toContainText('Версия 1');
 const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state);
 expect(state.caseSnapshots).toHaveLength(1);
 expect(state.audit.filter((a:any)=>a.action==='case.decide')).toHaveLength(1);
});
test('case creation reuses its entity and command IDs after lost ACK',async({page})=>{
 await page.goto('/#/complexes/SQ-003?tab=verification',{waitUntil:'domcontentloaded'});
 await loseNextAck(page,'case.create');
 const button=page.getByRole('button',{name:'Начать расследование',exact:true});
 await button.click();await expect(page.getByRole('alert')).toContainText('Simulated lost ACK');
 const first=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state.cases);
 expect(first).toHaveLength(1);
 await button.click();await expect(page).toHaveURL(new RegExp(`/cases/${first[0].id}`));
 const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state);
 expect(state.cases).toHaveLength(1);
 expect(state.cases[0]).toMatchObject({id:first[0].id,createdAt:first[0].createdAt,complexId:first[0].complexId,status:'draft'});
 expect(state.audit.filter((a:any)=>a.action==='case.create')).toHaveLength(1);
});
test('stale attachment can retry saved delivery after its original button is disabled',async({page})=>{
 await manualCase(page);
 const caseUrl=page.url();
 await page.goto('/#/publications?add=1&complex=SQ-003',{waitUntil:'domcontentloaded'});
 await page.getByLabel('Текст объявления',{exact:true}).fill('Новый документ для сверки границ объекта.');
 await page.getByLabel('Площадка',{exact:true}).fill('Дополнительный источник');
 await page.getByRole('button',{name:'Сохранить материал без AI',exact:true}).click();
 await expect(page.getByText(/Материал сохранён:/)).toBeVisible();
 await page.goto(caseUrl,{waitUntil:'domcontentloaded'});
 const attachesBefore=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state.audit.filter((a:any)=>a.action==='case.attach').length);
 await page.evaluate(async()=>{
  const modulePath='/src/lib/repository.ts';
  const {StaleConflictError}=await import(modulePath);
  const original=navigator.locks.request.bind(navigator.locks);let conflict=true;
  navigator.locks.request=(async(...args:any[])=>{
   const result=await (original as any)(...args);
   if(conflict&&result?.state?.audit?.[0]?.action==='case.attach'){
    conflict=false;
    throw new StaleConflictError('Simulated stale attachment',result.state,result.version,{type:'case.attach'});
   }
   return result;
  }) as typeof navigator.locks.request;
 });
 await page.getByText('Первоисточники и сохранённые публикации',{exact:true}).click();
 await page.getByRole('button',{name:'Добавить в дело',exact:true}).first().click();
 await expect(page.getByRole('alert')).toContainText('Simulated stale attachment');
 await expect(page.getByRole('button',{name:'В деле',exact:true}).first()).toBeDisabled();
 const retry=page.getByRole('button',{name:'Повторить доставку прежнего действия',exact:true});
 await expect(retry).toBeEnabled();await retry.click();await expect(retry).toHaveCount(0);
 await verifyFact(page);await expect(manualCandidate(page)).toContainText('Факт проверен');
 const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state);
 expect(state.audit.filter((a:any)=>a.action==='case.attach')).toHaveLength(attachesBefore+1);
 expect(state.assertions).toHaveLength(1);
});

test('explicit fact batch resumes after its second ACK is lost without duplicate decisions',async({page})=>{
 await manualCase(page);
 const manual=page.locator('details').filter({has:page.getByText('Выделить утверждение вручную',{exact:true})});
 await manual.getByLabel('Точная цитата',{exact:true}).fill('612 000 тенге.');
 await manual.getByRole('button',{name:'Создать кандидата',exact:true}).click();
 const boxes=page.locator('.hypothesis').filter({has:page.locator('blockquote').filter({hasText:'612 000'})}).getByRole('checkbox',{name:/Выбрать факт R2/});
 await expect(boxes).toHaveCount(2);
 await expect(boxes.nth(0)).not.toBeChecked();await expect(boxes.nth(1)).not.toBeChecked();
 await boxes.nth(0).check();await boxes.nth(1).check();
 await page.getByLabel('Обоснование пакетной проверки',{exact:true}).fill('Оба фрагмента сверены с оригиналом');
 await page.evaluate(async()=>{
  const modulePath='/src/lib/repository.ts';const {UnknownCommitResultError}=await import(modulePath);
  const original=navigator.locks.request.bind(navigator.locks);let delivered=0;
  navigator.locks.request=(async(...args:any[])=>{
   const result=await (original as any)(...args);
   if(result?.state?.audit?.[0]?.action==='fact.review' && ++delivered===2)throw new UnknownCommitResultError('Simulated second batch ACK lost','batch');
   return result;
  }) as typeof navigator.locks.request;
 });
 await page.getByRole('button',{name:'Подтвердить выбранные факты',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Simulated second batch ACK lost');
 const first=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state.assertions);
 expect(first).toHaveLength(2);
 await page.getByRole('button',{name:'Повторить доставку прежнего действия',exact:true}).click();
 await expect(boxes.nth(0)).not.toBeChecked();await expect(boxes.nth(1)).not.toBeChecked();
 await expect(page.getByText('Проверить несколько фактов вместе · выбрано: 0',{exact:true})).toBeVisible();
 const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state);
 expect(after.assertions).toEqual(first);
 expect(after.audit.filter((a:any)=>a.action==='fact.review')).toHaveLength(2);
 await expect(page.locator('.risk-score strong')).toHaveText('25');
});

test('automatic preparation survives navigation and retries its original delivery after a lost ACK',async({page})=>{
 await page.goto('/#/complexes/SQ-003',{waitUntil:'domcontentloaded'});
 await loseNextAck(page,'artifact.register');
 await page.getByRole('button',{name:'Начать расследование',exact:true}).click();
 const region=page.getByRole('region',{name:'Автоматическая подготовка расследования'});
 await expect(region.getByRole('alert')).toContainText('Simulated lost ACK');
 const caseUrl=page.url();
 const first=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state.artifacts);
 const delivered=first.find((a:any)=>a.id.startsWith('ART-'));expect(delivered).toBeDefined();
 await page.evaluate(()=>{location.hash='#/registries';});
 await expect(region).toHaveCount(0);
 await page.evaluate(url=>{location.hash=new URL(url).hash;},caseUrl);
 await region.getByRole('button',{name:'Повторить подготовку',exact:true}).click();
 // The remounted dossier delivers the same pending command and discovers its persisted receipt.
 await expect(region.getByRole('status')).toContainText('Подготовка завершена');
 const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state);
 expect(after.artifacts.filter((a:any)=>a.id===delivered.id)).toHaveLength(1);
 expect(after.assertions??[]).toHaveLength(0);
 expect(after.cases).toHaveLength(1);
});
