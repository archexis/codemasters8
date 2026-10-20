import {expect,test} from '@playwright/test';

test('S6 seven direct routes, unknown IDs/routes/revisions and no-results',async({page})=>{
 for(const route of ['home','overview','detail/SQ-002','ads','analyze','signal/SQ-002','registries']) {
  await page.goto('/#/'+route,{waitUntil:'domcontentloaded'}); await expect(page.locator('main')).toBeVisible(); expect(await page.title()).toContain('SAQ QURYLYS');
 }
 await page.goto('/#/registries',{waitUntil:'domcontentloaded'}); await page.getByRole('searchbox').fill('S6-NO-RESULTS'); await expect(page.locator('tbody')).toContainText('ЖК не найдены');
 for(const route of ['detail/NO-SUCH-ID','signal/NO-SUCH-ID','missing']) {await page.goto('/#/'+route,{waitUntil:'domcontentloaded'}); await expect(page.getByText(/не найден|не существует/).first()).toBeVisible();}
});
test('S6 WebGL failure and empty workspace retain independent list',async({page})=>{
 await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,type:any,...args:any[]){if(String(type).includes('webgl'))return null;return original.apply(this,[type,...args] as any);} as any;});
 await page.goto('/#/map',{waitUntil:'domcontentloaded'}); await expect(page.getByLabel('Двумерная карта без WebGL')).toBeVisible();await page.getByRole('button',{name:/Список ·/}).click();await expect(page.locator('.map-list-body button')).toHaveCount(14);
 await page.evaluate(()=>{const k='sq_svelte_demo_v2',e={envelope:1,version:0,receipts:{},state:{schemaVersion:3,complexes:[],ads:[],media:[],signals:{},signalVersions:{},audit:[]}}; localStorage.setItem(k,JSON.stringify(e));});
 await page.reload({waitUntil:'domcontentloaded'});if(await page.getByRole('button',{name:/Список ·/}).getAttribute('aria-expanded')==='false')await page.getByRole('button',{name:/Список ·/}).click();await expect(page.locator('.map-list-body')).toContainText('Объектов по выбранным условиям нет');await page.goto('/#/registries',{waitUntil:'domcontentloaded'});await expect(page.getByRole('button',{name:'Добавить ЖК'})).toBeVisible();
});
test('S6 keyboard path, visible focus, labels and safe text rendering',async({page})=>{
 await page.goto('/#/analyze/SQ-001',{waitUntil:'domcontentloaded'}); const text=page.getByLabel('Текст объявления');
 for(let n=0;n<80&&!await text.evaluate(e=>e===document.activeElement);n++)await page.keyboard.press('Tab');
 await expect(text).toBeFocused();
 await page.keyboard.type('Депозит 531 000 тенге. <img src=x onerror="window.__s6xss=1"><script>window.__s6xss=1</script>');
 await page.keyboard.press('Tab');
 expect(await page.evaluate(()=>{const e=document.activeElement!; const s=getComputedStyle(e); return e!==document.body && (s.outlineStyle!=='none'||s.boxShadow!=='none');})).toBe(true);
 // Navigate to Analyze using only keyboard after entering the labelled form.
 const button=page.getByRole('button',{name:'Проанализировать',exact:true});
 for(let n=0;n<20 && !await button.evaluate(e=>e===document.activeElement);n++)await page.keyboard.press('Tab');
 await expect(button).toBeFocused(); await page.keyboard.press('Enter');
 await expect(page.getByRole('button',{name:'Принять гипотезу R2'})).toBeVisible();
 await expect(text).toHaveValue(/531 000/); expect(await page.evaluate(()=>(window as any).__s6xss)).toBeUndefined();
 const reason=page.getByLabel('Обоснование аналитика');
 for(let n=0;n<80&&!await reason.evaluate(e=>e===document.activeElement);n++)await page.keyboard.press('Tab');
 await expect(reason).toBeFocused();await page.keyboard.type('<script>window.__s6xss=1</script> Проверка текста');
 const confirm=page.getByRole('button',{name:'Принять гипотезу R2'});
 for(let n=0;n<20&&!await confirm.evaluate(e=>e===document.activeElement);n++)await page.keyboard.press('Tab');
 await expect(confirm).toBeFocused();await page.keyboard.press('Enter');
 await expect(page.getByText('Публикация сохранена. Триаж гипотезы не начисляет баллы.')).toBeVisible(); await page.goto('/#/ads',{waitUntil:'domcontentloaded'});
 await expect(page.getByText(/<img src=x/)).toBeVisible(); expect(await page.evaluate(()=>(window as any).__s6xss)).toBeUndefined();
});
test('S6 failed map tiles leave the searchable object list usable',async({page})=>{
 await page.route('https://tile.openstreetmap.org/**',r=>r.abort());
 await page.goto('/#/map',{waitUntil:'domcontentloaded'});
 await page.getByLabel('Поиск ЖК, БИН или адреса на карте').fill('Сарыарқа');
 await page.getByRole('button',{name:/Список ·/}).click();await expect(page.locator('.map-list-body button')).toHaveCount(1);
 await page.locator('.map-list-body button').click();await page.getByRole('button',{name:'Открыть досье',exact:true}).click();await expect(page.locator('.risk-score strong')).toHaveText('70');
});
