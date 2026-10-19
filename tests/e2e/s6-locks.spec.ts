import {test,expect} from '@playwright/test';
test('S6 missing Web Locks blocks writes and retains input/read access',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'locks',{value:undefined,configurable:true}));
 await page.goto('/#/analyze/SQ-001');await page.getByLabel('Текст объявления').fill('Депозит 534 000 тенге.');
 await page.getByRole('button',{name:'Проанализировать',exact:true}).click();
 await page.getByRole('button',{name:'Сохранить без подтверждения',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Web Locks');
 await expect(page.getByLabel('Текст объявления')).toHaveValue('Депозит 534 000 тенге.');
 const env=await page.evaluate(()=>localStorage.getItem('sq_svelte_demo_v2'));expect(env).toBeNull();
 await page.goto('/#/overview');await expect(page.locator('tbody tr')).toHaveCount(16);
});
