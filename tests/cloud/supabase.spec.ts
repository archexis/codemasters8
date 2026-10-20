import { expect, test } from '@playwright/test';
import { initialState, applyCommand } from '../../src/lib/domain';
import type { Command } from '../../src/lib/domain';
// Exercise login/logout through the operator UI in a clean browser profile.
test('Supabase server analysis, optimistic RPC save and session isolation through operator login', async ({page}) => {
  const commands:string[]=[]; let data = initialState(); let version = 1; let sawAuthHeader = false;
  const user = {id:'11111111-1111-4111-8111-111111111111',email:'analyst@example.test',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-10-18T00:00:00Z'};
  await page.route('http://supabase.test/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (request.method()==='OPTIONS') return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,DELETE,OPTIONS'}});
    const headers = {'access-control-allow-origin':'*','content-type':'application/json'};
    const respond = (body:unknown,status=200) => route.fulfill({status,headers,body:JSON.stringify(body)});
    if (path==='/auth/v1/token' && request.postDataJSON().password==='wrong') return respond({error:'invalid_grant',error_description:'Неверные учётные данные'},400);
    if (path==='/auth/v1/token') return respond({access_token:'test-access-token',refresh_token:'test-refresh-token',expires_in:3600,token_type:'bearer',user});
    if (path==='/auth/v1/user') return respond(user);
    if (path==='/auth/v1/logout') return respond({});
    if (path==='/rest/v1/workspaces') return respond({data,version});
    if (path==='/functions/v1/analyze') {
      sawAuthHeader = request.headers().authorization==='Bearer test-access-token';
      return respond({realAI:true,engine:'Test LLM via Edge',status:'succeeded',runId:request.postDataJSON().runId,inputHash:'test-hash',hypotheses:[{id:'cloud-h1',code:'R2',quote:'Депозит 456 000 тенге',reason:'Платёжное предложение'}]});
    }
    if (path==='/rest/v1/rpc/apply_command') {
      const body = request.postDataJSON() as {command:Command;expected_version:number;command_id:string};
      commands.push(body.command.type);
      expect(body.expected_version).toBe(version);
      data = applyCommand(data,body.command,user.email); version++;
      return respond({data,version,commandId:body.command_id,appliedVersion:version,replayed:false});
    }
    return respond({error:`Unexpected request ${path}`},500);
  });
  await page.goto('/');
  await expect(page.getByRole('region',{name:'Карта объектов',exact:true})).toBeVisible();
  await expect(page.getByLabel('Режим работы')).toContainText('DEMO');
  await page.getByRole('button',{name:'Войти оператору',exact:true}).click();
  await page.getByLabel('Email',{exact:true}).fill(user.email);
  await page.getByLabel('Пароль',{exact:true}).fill('wrong');
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Неверные учётные данные');
  await expect(page.getByLabel('Email',{exact:true})).toHaveValue(user.email);
  await page.getByLabel('Пароль',{exact:true}).fill('operator-test-password');
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(page.getByLabel('Режим работы')).toContainText(`Подключённый режим · ${user.email}`);
  await expect(page.getByRole('button',{name:'Выйти',exact:true})).toBeVisible();
  await expect(page.getByLabel('Пароль',{exact:true})).toHaveCount(0);
  await page.goto('/#/analyze/SQ-001');
  await page.getByLabel('Текст объявления').fill('Депозит 456 000 тенге для квартиры.');
  await page.getByLabel('Дата публикации (пусто — не указана)',{exact:true}).fill('2026-10-19');
  await page.getByRole('button',{name:'Проанализировать',exact:true}).click();
  await expect(page.locator('.badge')).toHaveText('Test LLM via Edge');
  await page.getByLabel('Обоснование аналитика').first().fill('Платёжное предложение направлено на проверку');
  await page.getByRole('button',{name:'Принять гипотезу R2',exact:true}).click();
  await expect(page.getByText('Публикация сохранена. Триаж гипотезы не начисляет баллы.')).toBeVisible();
  expect(sawAuthHeader).toBe(true);
  expect(data.claims?.at(-1)?.triage).toBe('accepted');
  expect(data.assertions??[]).toHaveLength(0);
  await page.goto('/#/complexes/SQ-001?tab=verification');
  await page.getByRole('button',{name:'Начать расследование',exact:true}).click();
  await expect(page.locator('.risk-score strong')).toHaveText('35');
  await expect(page.getByRole('status').filter({hasText:'Показана исходная оценка'})).toContainText('35 баллов');
  await page.locator('.hypothesis').filter({has:page.locator('blockquote').filter({hasText:'Депозит 456 000 тенге'})}).getByLabel('Обоснование проверки факта',{exact:true}).fill('Цитата проверена по оригиналу');
  await page.locator('.hypothesis').filter({has:page.locator('blockquote').filter({hasText:'Депозит 456 000 тенге'})}).getByRole('button',{name:'Подтвердить факт R2',exact:true}).click();
  await expect(page.locator('.risk-score strong')).toHaveText('25');
  expect(data.caseSnapshots??[]).toHaveLength(0);
  await page.getByRole('button',{name:'Предпросмотр сигнала',exact:true}).click();
  await page.getByLabel('Обоснование решения',{exact:true}).fill('Источник и факт проверены');
  await page.getByRole('button',{name:'Подтвердить сигнал',exact:true}).click();
  await expect(page.locator('.case-signal-sheet')).toContainText('Версия 1');
  expect(data.caseSnapshots?.at(-1)?.score).toBe(25);
  expect(commands).toEqual(expect.arrayContaining(['ad','artifact.register','claim.propose','ai.review','case.create','case.attach','fact.review','case.decide']));
  await page.reload();
  await page.getByRole('button',{name:'Предпросмотр сигнала',exact:true}).click();
  await expect(page.locator('.case-signal-sheet')).toContainText('Депозит 456 000 тенге для квартиры.');
  await expect(page.locator('.case-signal-sheet')).toContainText('Версия 1');
  // Logout must remove the server workspace and restore the local DEMO.
  await page.getByRole('button',{name:'Выйти',exact:true}).click();
  await expect(page.getByLabel('Режим работы')).toContainText('DEMO');
  await page.goto('/#/analyze/SQ-001');
  await page.reload();
  await expect(page.getByText('Депозит 456 000 тенге для квартиры.')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Войти оператору',exact:true})).toBeVisible();
});
