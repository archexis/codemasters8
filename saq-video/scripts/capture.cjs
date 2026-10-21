const {chromium}=require('playwright');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 let state,caseUrl;
 const manifest=[];
 async function record(name,seconds,setup,actions){
  const context=await browser.newContext({viewport:{width:2560,height:1440},deviceScaleFactor:1,storageState:state,recordVideo:{dir:path.join(root,'out/raw'),size:{width:2560,height:1440}}});
  const p=await context.newPage(); const born=Date.now();
  await setup(p); await p.evaluate(()=>document.fonts.ready);
  const start=(Date.now()-born)/1000; const epoch=Date.now(); const events=[];
  const at=async s=>{await sleep(Math.max(0,s*1000-(Date.now()-epoch)));};
  const click=async locator=>{await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox(); const x=b.x+b.width/2,y=b.y+b.height/2;events.push({t:(Date.now()-epoch)/1000,x,y});await p.mouse.move(x,y,{steps:16});await locator.click();};
  await p.screenshot({path:path.join(root,`public/stills/${name}-start.png`)});
  await actions(p,{at,click,events}); await at(seconds);
  await p.screenshot({path:path.join(root,`public/stills/${name}-end.png`)});
  state=await context.storageState();
  const video=p.video(); await context.close(); const raw=await video.path();
  const item={name,seconds,start,raw:path.relative(root,raw).replaceAll('\\','/'),events};manifest.push(item);
  fs.writeFileSync(path.join(root,'out/capture-manifest.json'),JSON.stringify(manifest,null,2));
  console.log('CAPTURED',name,'trim',start,'events',events.length);
 }
 async function mapReady(p){await p.goto('http://127.0.0.1:5174/#/map');await p.locator('.map-status').waitFor({state:'hidden',timeout:60000});await p.locator('canvas.maplibregl-canvas').waitFor();await sleep(1500);}
 await record('01-city',7,mapReady,async(p,{at})=>{await at(5);});
 await record('02-object',10,mapReady,async(p,{at,click})=>{
  // A real marker is picked on the untouched MapLibre map. Projection matches the app's documented initial camera.
  const b=await p.locator('.map').boundingBox();
  const world=(lng,lat)=>{const s=512*2**12;return [(lng+180)/360*s,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*s];};
  const center=world(82.617,49.917),point=world(82.61502,49.889851);
  const x=b.x+b.width/2+point[0]-center[0],y=b.y+b.height/2+point[1]-center[1];
  await at(1);await p.mouse.move(x,y,{steps:30});await p.mouse.wheel(0,-470);await sleep(1200);
  // Search isolates the same project and provides an accessible, deterministic selection.
  await p.getByPlaceholder('Поиск ЖК, БИН, адреса').fill('Янтарный мыс');
  await at(3);await click(p.getByRole('button',{name:/Список ·/}));
  await click(p.locator('.map-list-body button').filter({hasText:'Янтарный мыс'}));
  await p.getByRole('complementary',{name:'Предпросмотр ЖК'}).waitFor();
  await at(7);await click(p.getByRole('button',{name:'Открыть досье',exact:true}));
  await p.getByRole('heading',{name:'Янтарный мыс',exact:true}).waitFor();
 });
 await record('03-dossier',13,async p=>{await p.goto('http://127.0.0.1:5174/#/complexes/SQ-001');await p.getByRole('heading',{name:'Что известно об объекте'}).waitFor();},async(p,{at,click})=>{
  await at(4);await click(p.getByRole('tab',{name:'Связи',exact:true}));await p.getByRole('button',{name:'Граф',exact:true}).waitFor();
  await at(5);await click(p.getByRole('button',{name:'Список',exact:true}));
  await p.locator('.relation-row').first().waitFor();
  await at(7);await click(p.locator('.relation-row').filter({hasText:'Застройщик'}).first());
  await at(10);await click(p.getByRole('tab',{name:'Проверка',exact:true}));
  await p.getByRole('heading',{name:'Источники и проверка утверждений'}).waitFor();
  await p.evaluate(()=>window.scrollTo(0,190));
 });
 // Execute the real local preparation between shots; the loading sequence is omitted from the edit.
 const prep=await browser.newContext({viewport:{width:2560,height:1440},storageState:state});const pp=await prep.newPage();
 await pp.goto('http://127.0.0.1:5174/#/complexes/SQ-001?tab=verification');
 await pp.getByRole('button',{name:'Начать расследование',exact:true}).click();
 await pp.getByRole('region',{name:'Автоматическая подготовка расследования'}).getByRole('status').filter({hasText:'Подготовка завершена'}).waitFor({timeout:25000});
 caseUrl=pp.url().replace('&prepare=1','');state=await prep.storageState();await prep.close();
 const align=async(p,locator,top=320)=>{await locator.evaluate((e,top)=>window.scrollTo({top:e.getBoundingClientRect().top+window.scrollY-top,behavior:'instant'}),top);};
 await record('04-verification',17,async p=>{await p.goto(caseUrl);await p.locator('.hypothesis').first().waitFor();await align(p,p.locator('.hypothesis').first());},async(p,{at,click})=>{
  const fact=p.locator('.hypothesis').first();
  await at(1);await click(fact.getByRole('button',{name:'Показать оригинал',exact:true}));
  const source=p.locator('.selected-evidence');await source.waitFor();
  await align(p,source,280);await p.screenshot({path:path.join(root,'public/stills/04-source-open.png')});
  await at(6);await align(p,fact);
  await click(fact.getByLabel('Обоснование проверки факта'));
  await fact.getByLabel('Обоснование проверки факта').pressSequentially('DEMO: цитата сверена с сохранённым материалом. Проверено предложение депозита, не законность действий.',{delay:22});
  await at(12);await click(fact.getByRole('button',{name:'Подтвердить факт R2',exact:true}));
  await fact.getByText('R2 · Факт проверен',{exact:true}).waitFor();
  await p.getByRole('button',{name:'Закрыть',exact:true}).click().catch(()=>{});
  await align(p,fact);
 });
 await record('05-result',9,async p=>{await p.goto(caseUrl);await p.getByRole('button',{name:'Предпросмотр сигнала',exact:true}).click();await p.locator('.case-signal-sheet').waitFor();await p.evaluate(()=>window.scrollTo(0,100));},async(p,{at})=>{
  await at(4);await p.getByRole('heading',{name:'Подтверждённые факторы',exact:true}).scrollIntoViewIfNeeded();
  await p.evaluate(()=>{const e=[...document.querySelectorAll('h2')].find(e=>e.textContent==='Подтверждённые факторы');window.scrollTo({top:e.getBoundingClientRect().top+window.scrollY-160,behavior:'smooth'});});
 });
 fs.writeFileSync(path.join(root,'out/demo-state-evidence.json'),JSON.stringify(JSON.parse(state.origins[0].localStorage.find(x=>x.name==='sq_svelte_demo_v2').value).state,null,2));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
