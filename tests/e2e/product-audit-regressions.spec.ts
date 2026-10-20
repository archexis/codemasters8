import {expect,test} from '@playwright/test';
import seed from '../../src/lib/seed.json' with {type:'json'};

test('F01: all six demo templates can become checked facts with original publication provenance',async({page})=>{
  test.setTimeout(120000);
  await page.goto('/#/complexes/SQ-003?tab=verification');
  await page.getByRole('button',{name:'Начать расследование',exact:true}).click();
  const preparation=page.getByRole('region',{name:'Автоматическая подготовка расследования'});
  for(let pass=1;pass<=6;pass++){
    if(pass>1)await preparation.getByRole('button',{name:'Подготовить материалы',exact:true}).click();
    await expect(preparation.getByRole('status')).toContainText('Подготовка завершена',{timeout:15000});
    const quote=await page.evaluate(()=>{
      const s=JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state;
      const artifact=s.artifacts.filter((a:any)=>a.id.startsWith('DEMO-')).at(-1);
      return s.claims.find((c:any)=>c.artifactId===artifact.id).quote as string;
    });
    const candidate=page.locator('.hypothesis').filter({has:page.locator('blockquote').getByText(quote,{exact:true})});
    await candidate.getByLabel('Обоснование проверки факта',{exact:true}).fill(`Оригинал учебного материала ${pass} сверён`);
    await candidate.getByRole('button',{name:'Подтвердить факт R2',exact:true}).click();
    await expect(candidate).toContainText('Факт проверен');
    await expect(page.locator('.risk-score strong')).toHaveText('25');
    const verified=await page.evaluate(()=>{
      const s=JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state;
      return {facts:s.assertions,artifacts:s.artifacts,ads:s.ads};
    });
    expect(verified.facts).toHaveLength(pass);
    const fact=verified.facts.at(-1),ad=verified.ads.find((a:any)=>a.id===fact.evidence.adId);
    expect(ad.text).toContain(fact.evidence.quote);
    expect(verified.artifacts.find((a:any)=>a.adId===ad.id)).toMatchObject({kind:'publication',origin:'demo'});
  }
  await page.reload();
  await expect(page.locator('.hypothesis').filter({hasText:'Факт проверен'})).toHaveCount(6);
});

test('F02: manual republication preserves a second sighting, one original and no duplicate on retry',async({page})=>{
  const text='Депозит 842 731 тенге за квартиру. Повторная фиксация источника F02.';
  await page.goto('/#/publications?add=1&complex=SQ-003');
  await page.getByLabel('Текст объявления',{exact:true}).fill(text);
  for(const [platform,date,url] of [['Первая площадка','2026-10-01','https://example.test/audit-first'],['Вторая площадка','2026-10-20','https://example.test/audit-second']]){
    await page.getByLabel('Площадка',{exact:true}).fill(platform);
    await page.getByLabel('Дата публикации (пусто — не указана)',{exact:true}).fill(date);
    await page.getByLabel('Ссылка на источник',{exact:true}).fill(url);
    await page.getByRole('button',{name:'Сохранить материал без AI',exact:true}).click();
    await expect(page.getByText(/Материал сохранён:/)).toBeVisible();
  }
  await page.reload();
  await page.getByLabel('Текст объявления',{exact:true}).fill(text);
  await page.getByLabel('Площадка',{exact:true}).fill('Вторая площадка');
  await page.getByLabel('Дата публикации (пусто — не указана)',{exact:true}).fill('2026-10-20');
  await page.getByLabel('Ссылка на источник',{exact:true}).fill('https://example.test/audit-second');
  await page.getByRole('button',{name:'Сохранить материал без AI',exact:true}).click();
  await expect(page.getByText(/Материал сохранён:/)).toBeVisible();
  const s=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state);
  const ads=s.ads.filter((a:any)=>a.text===text);expect(ads).toHaveLength(1);
  expect(ads[0]).toMatchObject({platform:'Первая площадка',date:'2026-10-01',url:'https://example.test/audit-first'});
  expect(ads[0].sightings).toEqual([expect.objectContaining({source:'Вторая площадка',date:'2026-10-20',url:'https://example.test/audit-second'})]);
  expect(s.artifacts.filter((a:any)=>a.adId===ads[0].id)).toHaveLength(1);
});

test('F03: invalid URL and definite refusal remain editable while an acknowledged file is reused',async({page})=>{
  await page.route('**/src/lib/repository.ts',async route=>{
    const response=await route.fetch(),source=await response.text();
    const needle='return (await commitCommand(state, command, reviewer, opts)).state;';
    expect(source).toContain(needle);
    await route.fulfill({response,body:source.replace(needle,`if(command.type==='artifact.register'&&!globalThis.__definiteRefusal){globalThis.__definiteRefusal=true;throw new Error('Определённый отказ регистрации');}${needle}`)});
  });
  await page.goto('/#/registries');
  await page.getByRole('button',{name:'Добавить документ',exact:true}).click();
  await page.getByLabel(/^ЖК/).selectOption('SQ-003');
  await page.getByLabel('Источник / номер документа').fill('Исправимый импорт F03');
  await page.getByLabel('Исходное содержание / текст выбранной страницы').fill('Материал после исправления формы.');
  await page.getByLabel('Оригинал PDF / изображение').setInputFiles({name:'proof.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});
  await page.getByLabel('URL оригинала').fill('ftp://example.invalid/proof.pdf');
  await page.getByRole('button',{name:'Сохранить документ',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('https:// или http://');
  await page.getByLabel('URL оригинала').fill('https://example.invalid/proof.pdf');
  await page.getByRole('button',{name:'Сохранить документ',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Определённый отказ');
  await page.getByLabel('Источник / номер документа').fill('Исправленный источник F03');
  await page.getByRole('button',{name:'Сохранить документ',exact:true}).click();
  await expect(page.getByText('Документ сохранён. Применимость проверяется в досье.',{exact:true})).toBeVisible();
  const s=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state);
  expect(s.media).toHaveLength(1);
  expect(s.artifacts.filter((a:any)=>a.source==='Исправленный источник F03')).toEqual([expect.objectContaining({mediaId:s.media[0].id,url:'https://example.invalid/proof.pdf'})]);
});

test('F04: explicit dossier link overrides stored filters and reacts to a new complex context',async({page})=>{
  await page.goto('/#/publications');
  await page.getByLabel(/^ЖК/).selectOption('SQ-001');
  await page.getByRole('searchbox',{name:'Поиск',exact:true}).fill('Ничего не найдено F04');
  await page.goto('/#/complexes/SQ-003?tab=verification');
  await page.getByRole('link',{name:'Открыть в публикациях',exact:true}).first().click();
  await expect(page.getByLabel(/^ЖК/)).toHaveValue('SQ-003');
  await expect(page.getByRole('searchbox',{name:'Поиск',exact:true})).toHaveValue('');
  await expect(page.getByRole('button',{name:'Оригинал и гипотезы',exact:true})).toHaveCount(seed.ADS.filter(a=>a.zkId==='SQ-003').length);
  await page.evaluate(()=>{location.hash='#/publications?complex=SQ-002';});
  await expect(page.getByLabel(/^ЖК/)).toHaveValue('SQ-002');
  await expect(page.getByRole('button',{name:'Оригинал и гипотезы',exact:true})).toHaveCount(seed.ADS.filter(a=>a.zkId==='SQ-002').length);
});

test('F03: lost document ACK locks its payload and replays without a second document or file',async({page})=>{
  await page.goto('/#/registries');
  await page.getByRole('button',{name:'Добавить документ',exact:true}).click();
  await page.getByLabel(/^ЖК/).selectOption('SQ-003');
  await page.getByLabel('Источник / номер документа').fill('Исходный источник ACK');
  await page.getByLabel('Исходное содержание / текст выбранной страницы').fill('Содержание с потерянным подтверждением доставки.');
  await page.getByLabel('Оригинал PDF / изображение').setInputFiles({name:'proof.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});
  await page.evaluate(async()=>{
    const path='/src/lib/repository.ts';const {UnknownCommitResultError}=await import(path);
    const original=navigator.locks.request.bind(navigator.locks);let lose=true;
    navigator.locks.request=(async(...args:any[])=>{
      const result=await (original as any)(...args);
      if(lose&&result?.state?.audit?.[0]?.action==='artifact.register'){lose=false;throw new UnknownCommitResultError('Потерян ответ регистрации','test');}
      return result;
    }) as typeof navigator.locks.request;
  });
  await page.getByRole('button',{name:'Сохранить документ',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Потерян ответ');
  await page.getByLabel('Источник / номер документа').fill('Изменённый источник ACK');
  await page.getByRole('button',{name:'Сохранить документ',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('верните исходные поля');
  await page.getByLabel('Источник / номер документа').fill('Исходный источник ACK');
  await page.getByRole('button',{name:'Сохранить документ',exact:true}).click();
  await expect(page.getByText('Документ сохранён. Применимость проверяется в досье.',{exact:true})).toBeVisible();
  const s=await page.evaluate(()=>JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state);
  expect(s.media).toHaveLength(1);
  expect(s.artifacts.filter((a:any)=>a.source==='Исходный источник ACK')).toHaveLength(1);
  expect(s.audit.filter((a:any)=>a.action==='artifact.register'&&a.details.artifact.source==='Исходный источник ACK')).toHaveLength(1);
});

test('F05: original is visible and focused; closing restores the originating card',async({page},info)=>{
  if(info.project.name==='mobile')await page.setViewportSize({width:390,height:844});
  await page.goto('/#/publications');
  await page.getByRole('searchbox',{name:'Поиск',exact:true}).fill('Резервирование');
  const opener=page.getByRole('button',{name:'Оригинал и гипотезы',exact:true}).first();
  await opener.click();
  const inspector=page.getByRole('complementary',{name:'Оригинал публикации',exact:true});
  await expect(inspector).toBeFocused();
  expect(await inspector.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.top<innerHeight;})).toBe(true);
  await page.screenshot({path:info.outputPath('visible-original.png')});
  await inspector.getByRole('button',{name:'Закрыть',exact:true}).click();
  await expect(inspector).toHaveCount(0);await expect(opener).toBeFocused();await expect(opener).toBeInViewport();
});

test('F06: unsupported publication candidate explains the remedy and shows its refusal at the action',async({page},info)=>{
  if(info.project.name==='mobile')await page.setViewportSize({width:390,height:844});
  await page.goto('/#/registries');
  await page.getByRole('button',{name:'Добавить документ',exact:true}).click();
  await page.getByLabel(/^ЖК/).selectOption('SQ-003');
  await page.getByLabel('Источник / номер документа').fill('Брошюра F06');
  await page.getByLabel('Дата документа, если известна').fill('2026-10-20');
  const text='Депозит 998 771 тенге за квартиру. Брошюра F06.';
  await page.getByLabel('Исходное содержание / текст выбранной страницы').fill(text);
  await page.getByRole('button',{name:'Сохранить документ',exact:true}).click();
  await expect(page.getByText('Документ сохранён. Применимость проверяется в досье.',{exact:true})).toBeVisible();
  await page.goto('/#/complexes/SQ-003?tab=verification');
  await page.getByRole('button',{name:'Начать расследование',exact:true}).click();
  await expect(page.getByRole('region',{name:'Автоматическая подготовка расследования'}).getByRole('status')).toContainText('Подготовка завершена',{timeout:15000});
  const candidate=page.locator('.hypothesis').filter({has:page.locator('blockquote').filter({hasText:'998 771'})});
  await expect(candidate).toContainText('Для проверки нужна связанная публикация');
  await candidate.getByLabel('Обоснование проверки факта',{exact:true}).fill('Нужно оформить первоисточник');
  await candidate.getByRole('button',{name:'Подтвердить факт R2',exact:true}).click();
  const error=candidate.getByRole('alert');
  await expect(error).toContainText('материал публикации');await expect(error).toBeFocused();await expect(error).toBeInViewport();
  await page.screenshot({path:info.outputPath('visible-fact-error.png')});
  await candidate.getByRole('link',{name:'Оформить публикацию из материала',exact:true}).click();
  await expect(page.getByLabel('Текст объявления',{exact:true})).toHaveValue(text);
  await expect(page.getByRole('combobox',{name:/^Объект/})).toHaveValue('SQ-003');
});
