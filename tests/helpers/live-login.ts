import {expect} from '@playwright/test';
export async function login(page:import('@playwright/test').Page) {
 await page.goto('/#/map',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Демо-аналитик',exact:true}).click();
 await page.getByLabel('Email',{exact:true}).fill(process.env.SAQ_LIVE_EMAIL!);
 await page.getByLabel('Пароль',{exact:true}).fill(process.env.SAQ_LIVE_PASSWORD!);
 await page.getByRole('button',{name:'Войти',exact:true}).last().click();
 await expect(page.getByRole('button',{name:process.env.SAQ_LIVE_EMAIL!,exact:true})).toBeVisible();
}
