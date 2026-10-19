import {expect,test,type Page} from '@playwright/test';
import {manualCase,verifyFact} from '../helpers/case-ui';

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
 await page.getByLabel('Обоснование проверки факта',{exact:true}).fill('Сверено с первоисточником');
 await loseNextAck(page,'fact.review');
 const button=page.getByRole('button',{name:'Подтвердить факт R2',exact:true});
 await button.click();await expect(page.getByRole('alert')).toContainText('Simulated lost ACK');
 const first=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state.assertions);
 expect(first).toHaveLength(1);
 await button.click();await expect(page.locator('.hypothesis')).toContainText('Факт проверен');
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
 expect(state.cases).toEqual(first);
 expect(state.audit.filter((a:any)=>a.action==='case.create')).toHaveLength(1);
});
test('stale attachment can retry saved delivery after its original button is disabled',async({page})=>{
 await manualCase(page);
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
 await page.getByRole('button',{name:'Добавить в дело',exact:true}).first().click();
 await expect(page.getByRole('alert')).toContainText('Simulated stale attachment');
 await expect(page.getByRole('button',{name:'В деле',exact:true}).first()).toBeDisabled();
 const retry=page.getByRole('button',{name:'Повторить доставку прежнего действия',exact:true});
 await expect(retry).toBeEnabled();await retry.click();await expect(retry).toHaveCount(0);
 await verifyFact(page);await expect(page.locator('.hypothesis')).toContainText('Факт проверен');
 const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state);
 expect(state.audit.filter((a:any)=>a.action==='case.attach')).toHaveLength(1);
 expect(state.assertions).toHaveLength(1);
});
