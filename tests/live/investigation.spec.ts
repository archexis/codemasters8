import {test,expect} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
test('real external LLM S5 new connected investigation',async({page})=>{
 test.setTimeout(120000);
 page.on('pageerror',e=>console.log('PAGEERROR',e.message));
 const client=createClient(process.env.SAQ_LIVE_SUPABASE_URL!,process.env.SAQ_LIVE_SUPABASE_KEY!,{auth:{persistSession:false}});
 const signed=await client.auth.signInWithPassword({email:process.env.SAQ_LIVE_EMAIL!,password:process.env.SAQ_LIVE_PASSWORD!});expect(signed.error).toBeNull();
 let current=(await client.rpc('initialize_workspace')).data;
 const existing=current.data.complexes.find((c:any)=>c.id.startsWith('S5-'));
 const id=existing?.id ?? 'S5-'+randomUUID().slice(0,8);const date='2026-10-18';
 const send=async(command:unknown)=>{const r=await client.rpc('apply_command',{command,expected_version:current.version,command_id:randomUUID()});if(r.error)throw r.error;current=r.data;return r.data;};
 const z={id,name:'ЖК Синтетический S5 '+id,city:'Өскемен',address:'Тестовый адрес, 5',developer:'Синтетический застройщик',bin:null,lat:null,lng:null,origin:'manual',stage:'Строительство',readinessClaimed:null,readinessConfirmed:null,readinessSources:[],readinessClaimedSource:null,legalBasis:{type:'absent',status:'absent-verified',source:'S5 synthetic акт сверки КЖК и МИО',checkedAt:date,reviewText:'Синтетический акт: проверены гарантия Единого оператора и разрешение МИО; оба отсутствуют. Не реальные юридические сведения.'},note:'Connected synthetic acceptance, no seed factors',factors:[],events:[],sources:[]};
 if(!existing) await send({type:'complex',complex:z});
 await page.goto('/');await page.getByRole('button',{name:'Демо-аналитик',exact:true}).click();await page.getByLabel('Email',{exact:true}).fill(process.env.SAQ_LIVE_EMAIL!);await page.getByLabel('Пароль',{exact:true}).fill(process.env.SAQ_LIVE_PASSWORD!);await page.getByRole('button',{name:'Войти',exact:true}).last().click();await expect(page.getByRole('button',{name:process.env.SAQ_LIVE_EMAIL!,exact:true})).toBeVisible();
 const text='Продаём квартиры в строящемся ЖК Синтетический S5. Дом ещё не введён в эксплуатацию, сдача в 2028 году. Депозит 654 000 тенге обязателен для бронирования квартиры.';
 if(!existing) {
 await page.goto('/#/analyze/'+id);
 await page.getByLabel('Текст объявления').fill(text);await page.getByLabel('Ссылка на источник').fill('https://example.test/s5/'+id);await page.getByLabel('Дата публикации (пусто — не указана)').fill(date);await page.getByRole('button',{name:'Проанализировать',exact:true}).click();
 const h2=page.locator('.hypothesis').filter({hasText:'R2 · гипотеза'}),h3=page.locator('.hypothesis').filter({hasText:'R3 · гипотеза'});await expect(h2).toBeVisible({timeout:60000});await expect(h3).toBeVisible();
 await h2.getByLabel('Обоснование аналитика').fill('Синтетическое предложение оплаты проверено человеком');await h2.getByRole('button',{name:'Подтвердить R2'}).click();await expect(page.getByText('Публикация и решение сохранены.')).toBeVisible();
 await h3.getByLabel('Источник материала о вводе').fill('S5 synthetic акт неввода');await h3.getByLabel('Дата материала о вводе').fill(date);await h3.getByLabel('Датированный материал').fill('Синтетический датированный акт от 2026-10-18: дом не введён на дату публикации.');await h3.getByLabel('Обоснование аналитика').fill('Реклама до ввода проверена по материалу');await h3.getByRole('button',{name:'Подтвердить R3'}).click();await expect(page.locator('.ai-review-history')).toContainText('Реклама до ввода проверена по материалу');
 await page.goto('/#/detail/'+id);await page.getByRole('combobox',{name:/^Фактор/}).selectOption('R1');await page.getByLabel('Источник доказательства').fill(z.legalBasis.source);await page.getByLabel('Дата материала',{exact:true}).fill(date);await page.getByLabel('Содержание правовой сверки').fill(z.legalBasis.reviewText);await page.getByLabel('Комментарий аналитика').fill('Проверены оба варианта основания');await page.getByRole('button',{name:'Сохранить решение',exact:true}).click();
 await expect(page.locator('.risk-score strong')).toHaveText('70');
 }
 await page.goto('/#/signal/'+id);await page.getByLabel('Обоснование решения').fill('Полный synthetic кейс проверен, v1');await page.getByRole('button',{name:'Подтвердить сигнал'}).click();console.log('SIGNAL STATE',await page.getByRole('alert').allTextContents());await expect(page.locator('.signal-sheet')).toContainText('Подтверждён');await page.pdf({path:'docs/acceptance/s5/pdf/connected.pdf',format:'A4'});await page.reload();await expect(page.locator('.signal-sheet')).toContainText('Счёт: 70');
 const row=await client.from('workspaces').select('data,version').single();current=row.data;const state=current.data;const v1=state.signalVersions[id][0];const f=state.complexes.find((c:any)=>c.id===id).factors.find((f:any)=>f.code==='R2');
 const run=(await client.from('analysis_runs').select('id,model,prompt_version,status,input_hash,input_snapshot').eq('id',f.evidence.runId).single()).data!;expect(run.status).toBe('succeeded');expect(run.input_snapshot.text).toBe(text);
 await send({type:'factor',zkId:id,code:'R2',status:'rejected',evidence:f.evidence,comment:'Повторная сверка: предложение оплаты снято'});await page.reload();await expect(page.locator('.signal-sheet')).toContainText('Счёт: 45');await expect(page.locator('.signal-sheet')).toContainText('yellow');
 await page.goto('/#/signal/'+id+'?revision=1');await expect(page.locator('.signal-sheet')).toContainText('Счёт: 70');await expect(page.getByRole('button',{name:'Подтвердить сигнал'})).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});await page.reload();await expect(page.locator('.signal-sheet')).toContainText('Счёт: 70');
 await page.goto('/#/signal/'+id);await page.getByLabel('Обоснование решения').fill('Возврат: требуется дополнительная проверка оплаты');await page.getByRole('button',{name:'Вернуть на проверку'}).click();await expect(page.locator('.signal-sheet')).toContainText('Возвращён');await page.reload();await expect(page.getByLabel('Версия сигнала')).toContainText('Revision 2');
 const final=(await client.from('workspaces').select('data').single()).data!.data;expect(final.signalVersions[id][0]).toEqual(v1);expect(final.signalVersions[id][1].score).toBe(45);
 writeFileSync('docs/acceptance/s5/connected.json',JSON.stringify({status:'PASS',zkId:id,run,v1,returned:final.signalVersions[id][1],checks:['new object/legal review','new ad','real AI','human R2/R3 + beforeCommissioning','manual R1','70/red','confirm v1/PDF/reload','R2 withdrawn ->45/yellow','v1 unchanged','returned/reload','direct link/mobile']},null,2));
});
