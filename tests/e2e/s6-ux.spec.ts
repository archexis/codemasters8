import {expect,test} from '@playwright/test';

test('S6 seven direct routes, unknown IDs/routes/revisions and no-results',async({page})=>{
 for(const route of ['home','overview','detail/SQ-002','ads','analyze','signal/SQ-002','registries']) {
  await page.goto('/#/'+route); await expect(page.locator('main')).toBeVisible(); expect(await page.title()).toContain('SAQ QURYLYS');
 }
 await page.goto('/#/overview'); await page.getByRole('searchbox').fill('S6-NO-RESULTS'); await expect(page.locator('tbody tr')).toHaveCount(0);
 for(const route of ['detail/NO-SUCH-ID','signal/NO-SUCH-ID','missing']) {await page.goto('/#/'+route); await expect(page.getByText(/не найден/).first()).toBeVisible();}
});
test('S6 WebGL failure and empty workspace retain independent list',async({page})=>{
 await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,type:any,...args:any[]){if(String(type).includes('webgl'))return null;return original.apply(this,[type,...args] as any);} as any;});
 await page.goto('/#/overview'); await expect(page.getByRole('status')).toContainText('WebGL'); await expect(page.locator('tbody tr')).toHaveCount(16);
 await page.evaluate(()=>{const k='sq_svelte_demo_v2',e={envelope:1,version:0,receipts:{},state:{schemaVersion:3,complexes:[],ads:[],media:[],signals:{},signalVersions:{},audit:[]}}; localStorage.setItem(k,JSON.stringify(e));});
 await page.reload(); await expect(page.locator('tbody tr')).toHaveCount(0); await expect(page.getByRole('button',{name:'Добавить объект'})).toBeVisible();
});
test('S6 keyboard path, visible focus, labels and safe text rendering',async({page})=>{
 await page.goto('/#/analyze/SQ-001'); const text=page.getByLabel('Текст объявления');
 for(let n=0;n<80&&!await text.evaluate(e=>e===document.activeElement);n++)await page.keyboard.press('Tab');
 await expect(text).toBeFocused();
 await page.keyboard.type('Депозит 531 000 тенге. <img src=x onerror="window.__s6xss=1"><script>window.__s6xss=1</script>');
 await page.keyboard.press('Tab');
 expect(await page.evaluate(()=>{const e=document.activeElement!; const s=getComputedStyle(e); return e!==document.body && (s.outlineStyle!=='none'||s.boxShadow!=='none');})).toBe(true);
 // Navigate to Analyze using only keyboard after entering the labelled form.
 const button=page.getByRole('button',{name:'Проанализировать',exact:true});
 for(let n=0;n<20 && !await button.evaluate(e=>e===document.activeElement);n++)await page.keyboard.press('Tab');
 await expect(button).toBeFocused(); await page.keyboard.press('Enter');
 await expect(page.getByRole('button',{name:'Подтвердить R2'})).toBeVisible();
 await expect(text).toHaveValue(/531 000/); expect(await page.evaluate(()=>(window as any).__s6xss)).toBeUndefined();
 const reason=page.getByLabel('Обоснование аналитика');
 for(let n=0;n<80&&!await reason.evaluate(e=>e===document.activeElement);n++)await page.keyboard.press('Tab');
 await expect(reason).toBeFocused();await page.keyboard.type('<script>window.__s6xss=1</script> Проверка текста');
 const confirm=page.getByRole('button',{name:'Подтвердить R2'});
 for(let n=0;n<20&&!await confirm.evaluate(e=>e===document.activeElement);n++)await page.keyboard.press('Tab');
 await expect(confirm).toBeFocused();await page.keyboard.press('Enter');
 await expect(page.getByText('Публикация и решение сохранены.')).toBeVisible(); await page.goto('/#/ads');
 await expect(page.getByText(/<img src=x/)).toBeVisible(); expect(await page.evaluate(()=>(window as any).__s6xss)).toBeUndefined();
});
test('S6 failed map tiles leave the searchable object list usable',async({page})=>{
 await page.route('https://tile.openstreetmap.org/**',r=>r.abort());
 await page.goto('/#/overview');await expect(page.getByRole('status')).toContainText('картографических данных');
 await page.getByRole('searchbox').fill('SQ-002');await expect(page.locator('tbody tr')).toHaveCount(1);
 await page.locator('tbody a').click();await expect(page.locator('.risk-score strong')).toHaveText('70');
});
