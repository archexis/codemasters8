import {test,expect} from '@playwright/test';
for(const route of ['signal','export']) test(`${route}: invalid and missing revisions recover without live fallback`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await page.evaluate(async()=>{const {initialState,applyCommand}=await import(/* @vite-ignore */ '/src/lib/'+'domain.ts');let s=applyCommand(initialState(),{type:'signal',zkId:'SQ-002',status:'confirmed',comment:'Frozen review'},'review');s.complexes.find((z:any)=>z.id==='SQ-002')!.name='LIVE MUTATION';localStorage.setItem('sq_svelte_demo_v2',JSON.stringify({envelope:1,state:s,version:1,receipts:{}}));});
 for(const revision of ['999','0','-1','abc','','1.5','Infinity','1&revision=2']){
  await page.goto(`/#/${route}/SQ-002?revision=${revision}`,{waitUntil:'domcontentloaded'});await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.getByRole('alert')).toHaveText(/Версия не найдена|Некорректная версия сигнала/);
  await expect(page.locator('.signal-sheet')).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Скачать JSON|Печать/})).toHaveCount(0);
  await expect(page.getByText('LIVE MUTATION',{exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:'К текущему сигналу',exact:true}).click();
  await expect(page.locator('.signal-sheet')).toContainText('revision 1');
 }
 expect(errors).toEqual([]);
});
test('version selector keeps frozen view and export href aligned',async({page})=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await page.evaluate(async()=>{const {initialState,applyCommand}=await import(/* @vite-ignore */ '/src/lib/'+'domain.ts');let s=applyCommand(initialState(),{type:'signal',zkId:'SQ-002',status:'confirmed',comment:'Frozen review'},'review');s=applyCommand(s,{type:'signal',zkId:'SQ-002',status:'draft',comment:'Reopen'},'review');s.complexes.find((z:any)=>z.id==='SQ-002')!.name='LIVE MUTATION';localStorage.setItem('sq_svelte_demo_v2',JSON.stringify({envelope:1,state:s,version:1,receipts:{}}));});
 await page.goto('/#/signal/SQ-002',{waitUntil:'domcontentloaded'});await page.reload({waitUntil:'domcontentloaded'});
 await expect(page.locator('.signal-sheet')).toContainText('LIVE MUTATION');
 const selector=page.getByLabel('Версия сигнала');await selector.selectOption('1');
 await expect(page.locator('.signal-sheet')).toContainText('revision 1');
 await expect(page.locator('.signal-sheet')).not.toContainText('LIVE MUTATION');
 await expect(page.getByRole('link',{name:'Экспорт данных'})).toHaveAttribute('href','#/export/SQ-002?revision=1');
 await page.getByRole('link',{name:'Экспорт данных'}).click();await expect(page.getByRole('button',{name:/Скачать JSON/})).toBeVisible();
});
