import {expect,test} from '@playwright/test';
import {mkdirSync} from 'node:fs';
for(const fixture of ['confirmed','long','returned']) test(`S5 print ${fixture}: immutable revision and full text`,async({page},info)=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await page.evaluate(async(fixture)=>{
  const {initialState,applyCommand}=await import(/* @vite-ignore */ '/src/lib/'+'domain.ts');let s=initialState();
  const z=s.complexes.find((z:any)=>z.id==='SQ-002')!;
  z.name='S5 PDF '+fixture+' RU Қазақша';
  if(fixture==='long'){
   const ad=s.ads.find((a:any)=>a.zkId===z.id)!;
   ad.url='https://example.test/'+('длинный-источник-'.repeat(30));
   ad.text=('Құрылыс жүріп жатыр. Предлагается внести депозит за квартиру до ввода дома. Проверка точной цитаты и полного текста. '.repeat(70));
   for(const artifact of s.artifacts??[])if(artifact.adId===ad.id){artifact.text=ad.text;artifact.url=ad.url;}
   for(const f of z.factors.filter((f:any)=>['R2','R3'].includes(f.code))){f.evidence.adId=ad.id;f.evidence.quote=ad.text;}
  }
  s=applyCommand(s,{type:'signal',zkId:z.id,status:fixture==='returned'?'returned':'confirmed',comment:'PDF fixture, синтетический DEMO материал'},'DEMO PDF',{sourceVersion:9,commandId:'PDF-'+fixture});
  localStorage.setItem('sq_svelte_demo_v2',JSON.stringify({envelope:1,state:s,version:10,receipts:{}}));
 },fixture);
 await page.goto('/#/signal/SQ-002?revision=1',{waitUntil:'domcontentloaded'});await page.reload({waitUntil:'domcontentloaded'});
 const sheet=page.locator('.signal-sheet');await expect(sheet).toContainText('revision 1');await expect(sheet.locator('.risk-score strong')).toHaveText('70');await expect(sheet.locator('.zone-total')).toHaveText('из 100');await expect(sheet).toContainText('PDF-'+fixture);
 await expect(page.getByRole('button',{name:'Подтвердить сигнал'})).toHaveCount(0);
 if(fixture==='long')await expect(sheet).toContainText('Құрылыс жүріп жатыр');
 if(info.project.name==='chromium'){
  mkdirSync('test-results/score-maxxing/artifacts/s5/pdf',{recursive:true});
  await page.pdf({path:`test-results/score-maxxing/artifacts/s5/pdf/${fixture}.pdf`,format:'A4',printBackground:true});
 }
});
