import { expect, test } from '@playwright/test';
import { initialState, applyCommand } from '../../src/lib/domain';
import type { Command } from '../../src/lib/domain';
test('Supabase SDK login, server analysis, optimistic RPC save and logout', async ({page}) => {
  let data = initialState(); let version = 1; let sawAuthHeader = false;
  const user = {id:'11111111-1111-4111-8111-111111111111',email:'analyst@example.test',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-10-18T00:00:00Z'};
  await page.route('http://supabase.test/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (request.method()==='OPTIONS') return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,DELETE,OPTIONS'}});
    const headers = {'access-control-allow-origin':'*','content-type':'application/json'};
    const respond = (body:unknown,status=200) => route.fulfill({status,headers,body:JSON.stringify(body)});
    if (path==='/auth/v1/token') return respond({access_token:'test-access-token',refresh_token:'test-refresh-token',expires_in:3600,token_type:'bearer',user});
    if (path==='/auth/v1/user') return respond(user);
    if (path==='/auth/v1/logout') return respond({});
    if (path==='/rest/v1/workspaces') return respond({data,version});
    if (path==='/functions/v1/analyze') {
      sawAuthHeader = request.headers().authorization==='Bearer test-access-token';
      return respond({realAI:true,engine:'Test LLM via Edge',status:'succeeded',runId:request.postDataJSON().runId,inputHash:'test-hash',hypotheses:[{id:'cloud-h1',code:'R2',quote:'Депозит 456 000 тенге',reason:'Платёжное предложение'}]});
    }
    if (path==='/rest/v1/rpc/apply_command') {
      const body = request.postDataJSON() as {command:Command;expected_version:number};
      expect(body.expected_version).toBe(version);
      data = applyCommand(data,body.command,user.email); version++;
      return respond({data,version});
    }
    return respond({error:`Unexpected request ${path}`},500);
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Демо-аналитик',exact:true}).click();
  await page.getByLabel('Email',{exact:true}).fill(user.email);
  await page.getByLabel('Пароль',{exact:true}).fill('not-a-real-password');
  await page.getByRole('button',{name:'Войти',exact:true}).last().click();
  await expect(page.getByRole('heading',{name:'Видеть риски. Действовать вовремя.'})).toBeVisible();
  await expect(page.getByRole('button',{name:user.email,exact:true})).toBeVisible();
  await expect(page.getByText('SUPABASE · персональное рабочее пространство',{exact:false})).toBeVisible();
  await page.goto('/#/analyze/SQ-001');
  await page.getByLabel('Текст объявления').fill('Депозит 456 000 тенге для квартиры.');
  await page.getByRole('button',{name:'Проанализировать',exact:true}).click();
  await expect(page.getByText('Test LLM via Edge')).toBeVisible();
  await page.getByLabel('Обоснование аналитика').first().fill('Платёжное предложение проверено аналитиком');
  await page.getByRole('button',{name:'Подтвердить R2'}).click();
  await expect(page.getByText('Публикация и решение сохранены.')).toBeVisible();
  expect(sawAuthHeader).toBe(true); expect(data.ads[0].decision).toBe('confirmed');
  await page.reload();
  await page.getByRole('button',{name:user.email,exact:true}).click();
  await page.getByRole('button',{name:'Выйти',exact:true}).click();
  await expect(page.getByRole('button',{name:'Демо-аналитик',exact:true})).toBeVisible();
  await expect(page.getByText('Депозит 456 000 тенге для квартиры.')).toHaveCount(0);
});
