<script lang="ts">
 import {onMount,untrack} from 'svelte';
 import type {AppState,Command,EvidenceArtifact,InvestigationCase} from '../lib/types';
 import {analyze,newRunId,canonicalRunInput} from '../lib/analysis';
 import {getSessionGeneration,getSessionUser,mediaUrl,SessionSupersededError} from '../lib/repository';
 import {supabase} from '../lib/supabase';
 import {getResearch,startResearch,setResearchMonitor,extractPdf,extractImage,type ResearchStatus,type ResearchSource} from '../lib/workspace-api';
 import {preparationJob,deliverPreparation,inPreparationScope,claimsForMaterial} from '../lib/preparation';
 import {dateWithinPeriod} from '../lib/applicability';
 import Analyze from './Analyze.svelte';
 import {adDedupeKey} from '../lib/parser';
 let {caseId,getWorkspace,commit,onbusy=()=>{}}:{caseId:string;getWorkspace:()=>AppState;commit:(c:Command)=>Promise<void>;onbusy?:(v:boolean)=>void}=$props();
 const session=untrack(getSessionGeneration);
 const key=untrack(()=>`${getSessionUser()??'demo'}:${caseId}`);
 const job=untrack(()=>preparationJob(key,session));
 let tick=$state(0);const view=$derived.by(()=>{tick;return {...job};});
 let freshAnalysis=false;let domainSelectionInitialized=false;let searchDomains=$state<string[]>([]);
 let remote=$state<ResearchStatus|null>(null);let remoteError=$state('');let manual=$state(false);let monitorBusy=$state(false);
 const item=$derived(getWorkspace().cases?.find(c=>c.id===caseId));
 const sources=$derived.by(()=>{
   const seen=new Set<string>();
   return [remote?.job,...(remote?.history??[])].flatMap(j=>j?.result?.sources??[]).filter(s=>{if(seen.has(s.id))return false;seen.add(s.id);return true;});
 });
 const active=$derived(item?.status==='draft');
 const connected=!!supabase && !!untrack(getSessionUser);
 $effect(()=>onbusy(view.running));
 function current():InvestigationCase {
   if(session!==getSessionGeneration())throw new SessionSupersededError();
   const c=getWorkspace().cases?.find(c=>c.id===caseId);
   if(!c || c.status!=='draft')throw new Error('Подготовка остановлена: дело закрыто или удалено. Новые находки сохранены отдельно.');
   return c;
 }
 function note(value:string){if(!job.notes.includes(value))job.notes.push(value);}
 async function deliver(commands:Command[]){await deliverPreparation(job,commands,commit,()=>{current();});}
 async function analyzeMaterial(artifact:EvidenceArtifact){
   const c=current();
   if(!artifact.text.trim())return;
   // Saved snapshots and exact quotes, never execute source content as instructions.
   const original=getWorkspace().ads.find(a=>a.id===artifact.adId);
   const input={text:artifact.text.slice(0,20000),zkId:c.complexId,url:original?.url??artifact.url??'',account:original?.account??'',date:original?original.date:artifact.date??null,platform:original?.platform??artifact.source};
   if(artifact.text.length>20000)note(`Материал ${artifact.source}: разобраны первые 20 000 символов, оставшийся текст требует дополнительного разбора.`);
   const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${caseId}\n${canonicalRunInput(input)}`));
   const runId=freshAnalysis?newRunId():`prep-${Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')}`;
   const result=await analyze(input,{runId,signal:AbortSignal.timeout(50000)});
   current();
   await deliver(claimsForMaterial(getWorkspace(),c,artifact,result));
 }
 async function savedMaterials(){
   const c=current();job.stage='1 / 3 · Сбор сохранённых публикаций, документов и вложений';
   const snapshot=getWorkspace();
   // Publications have no phase identity of their own: an explicit existing artifact is required for phase cases.
   for(const ad of snapshot.ads.filter(a=>a.zkId===c.complexId)) {
     if(c.phaseId && !snapshot.artifacts?.some(a=>a.adId===ad.id && a.phaseId===c.phaseId)) {note('Публикации без установленной очереди оставлены на уточнение; автоматически в очередь не перенесены.');continue;}
     if(c.period && (!ad.date || !dateWithinPeriod(ad.date,c.period))) {note('Материалы без даты или вне периода дела оставлены на уточнение.');continue;}
     let artifact=getWorkspace().artifacts?.find(a=>a.adId===ad.id && a.phaseId===c.phaseId);
     if(!artifact) {
       const id=`ART-${newRunId()}`;
       await deliver([{type:'artifact.register',artifact:{id,complexId:c.complexId,...(c.phaseId?{phaseId:c.phaseId}:{}),kind:'publication',source:`${ad.platform} · ${ad.account||'аккаунт неизвестен'}`,text:ad.text,adId:ad.id,...(ad.date?{date:ad.date}:{}),...(ad.url?{url:ad.url}:{})}}]);
     }
   }
   for(const media of snapshot.media.filter(m=>m.zkId===c.complexId && (m.kind==='application/pdf'||m.kind.startsWith('image/')))) {
     const linked=(getWorkspace().artifacts??[]).filter(a=>a.mediaId===media.id);
     if(linked.some(a=>a.kind==='document' && a.text.trim() && a.phaseId===c.phaseId))continue;
     if(c.phaseId && !linked.some(a=>a.phaseId===c.phaseId)) {note('Вложения без установленной очереди требуют уточнения.');continue;}
     // Media.date is often upload date, never silently treated as the event date.
     if(c.period)note(`Вложение ${media.name}: нужна установленная дата события в материале для периода дела. Извлечённый текст останется на уточнение.`);
     if(!connected) {note('DEMO: PDF/OCR недоступны; сохранённый текст разбирается настоящим локальным parser. Файлы остаются доступны вручную.');continue;}
     let url='';
     try {
       url=await mediaUrl(media);current();
       const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
       if(!response.ok)throw new Error('Оригинал файла недоступен');
       const blob=await response.blob();current();
       const file=new File([blob],media.name,{type:media.kind});
       const result=media.kind==='application/pdf'?await extractPdf(file):await extractImage(file);
       current();
       for(const limitation of result.limitations)note(limitation);
       const pages='pages' in result?result.pages:[{page:1,text:result.text}];
       for(const page of pages.filter(p=>p.text.trim()))await deliver([{type:'artifact.register',artifact:{id:`ART-${newRunId()}`,complexId:c.complexId,...(c.phaseId?{phaseId:c.phaseId}:{}),kind:'document',source:`${media.name} · извлечение, дата события неизвестна`,text:page.text.slice(0,30000),mediaId:media.id,pageNumber:page.page,origin:'import'}}]);
     }catch(e){note(`Вложение ${media.name}: ${e instanceof Error?e.message:String(e)}`);}
     finally{if(url.startsWith('blob:'))URL.revokeObjectURL(url);}
   }
   const artifacts=(getWorkspace().artifacts??[]).filter(a=>inPreparationScope(c,a));
   job.stage='2 / 3 · Разбор сохранённых материалов';job.total=artifacts.length;job.completed=0;
   for(const artifact of artifacts) {
     if(!current().artifactIds.includes(artifact.id))await deliver([{type:'case.attach',caseId,artifactId:artifact.id}]);
     try {await analyzeMaterial(artifact);}
     catch(e){if(e instanceof SessionSupersededError || job.pending.length)throw e;note(`Разбор ${artifact.source} недоступен: ${e instanceof Error?e.message:String(e)}`);}
     job.completed++;
   }
 }
 function sourceIsCurrent(source:ResearchSource){
   const c=current();const z=getWorkspace().complexes.find(z=>z.id===c.complexId);
   const result=[remote?.job,...(remote?.history??[])].find(j=>j?.result?.sources.some(s=>s.id===source.id))?.result;
   return !!result && result.target.complex.id===c.complexId && result.target.complex.name===z?.name && result.target.complex.address===z?.address && result.target.complex.developer===z?.developer
    && (result.target.phase?.id??undefined)===c.phaseId && result.target.phase?.name===(getWorkspace().phases??[]).find(p=>p.id===c.phaseId)?.name
    && JSON.stringify(result.target.period??undefined)===JSON.stringify(c.period);
 }
 async function importSource(source:ResearchSource,manualMatch=false){
   const c=current();
   if(!source.originalCaptured || !source.text.trim())throw new Error('Сохранённого оригинала нет. Добавьте проверенный материал вручную.');
   if(!sourceIsCurrent(source))throw new Error('Область поиска изменилась. Запустите новый сбор для актуального дела.');
   if(c.period && (!source.date || !dateWithinPeriod(source.date,c.period)))throw new Error('Дата не установлена или вне периода дела. Уточните материал вручную.');
   if(source.match!=='obvious' && !manualMatch) return;
   const scopeHash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${source.id}:${c.phaseId??'all'}`));
   current();
   const scopeId=Array.from(new Uint8Array(scopeHash),b=>b.toString(16).padStart(2,'0')).join('');
   let artifact=getWorkspace().artifacts?.find(a=>a.id===`WEB-${scopeId}`);
   if(!artifact) {
     const existing=getWorkspace().ads.find(a=>adDedupeKey(a.zkId,a.text)===adDedupeKey(c.complexId,source.text));
     if(existing && (existing.text!==source.text || existing.date!==source.date)){note('Найден вариант уже сохранённой публикации с другим текстом или датой. Требуется ручная сверка оригинала.');return;}
     const adId=existing?.id??`AD-${source.id.slice(0,48)}`;
     if(!existing)await deliver([{type:'ad',ad:{id:adId,zkId:c.complexId,platform:'Веб-страница',account:new URL(source.url).hostname,date:source.date,url:source.url,captureAt:new Date(source.capturedAt*1000).toISOString(),text:source.text},decision:'saved',comment:'Сбор первоисточника без подтверждения факторов'}]);
     await deliver([{type:'artifact.register',artifact:{id:`WEB-${scopeId}`,complexId:c.complexId,...(c.phaseId?{phaseId:c.phaseId}:{}),kind:'publication',adId,text:source.text,source:`${source.title} · фиксация ${new Date(source.capturedAt*1000).toISOString()} · ${manualMatch?'Объект и очередь сопоставлены аналитиком':source.matchReason}`,url:source.url,...(existing?.date||source.date?{date:existing?.date||source.date!}:{}),origin:'import'}}]);
     artifact=getWorkspace().artifacts?.find(a=>a.id===`WEB-${scopeId}`);
   }
   if(artifact) {
     if(!current().artifactIds.includes(artifact.id))await deliver([{type:'case.attach',caseId,artifactId:artifact.id}]);
     // Even without LLM, the closed-browser monitor has prepared grounded local candidates.
     await deliver(claimsForMaterial(getWorkspace(),c,artifact,{engine:source.engine,realAI:false,hypotheses:source.candidates}));
     try{await analyzeMaterial(artifact);}catch(e){if(job.pending.length)throw e;note(`LLM-разбор веб-материала недоступен: ${e instanceof Error?e.message:String(e)}`);}
   }
 }
 async function refresh(){
   if(!connected)return;
   try{const data=await getResearch(caseId);if(session!==getSessionGeneration())return;remote=data;remoteError='';if(!domainSelectionInitialized){searchDomains=data.monitor?.domains??data.job?.result?.target.domains??data.domains;domainSelectionInitialized=true;}}
   catch(e){remoteError=e instanceof Error?e.message:String(e);}
 }
 async function ingest(){
   if(!active || job.running || job.error || job.pending.length)return;
   const ready=sources.filter(s=>s.match==='obvious'&&!getWorkspace().artifacts?.some(a=>a.url===s.url&&a.text===s.text&&a.phaseId===item?.phaseId));
   if(!ready.length)return;
   job.running=true;
   try{for(const source of ready){if(!sourceIsCurrent(source)){note('Для старых находок изменилась область дела; требуется новый сбор.');continue;}await importSource(source);}job.stage='Подготовка завершена · кандидаты ждут проверки';}
   catch(e){job.error=e instanceof Error?e.message:String(e);}
   finally{job.running=false;tick++;}
 }
 async function run(explicit=false){
   if(job.running)return;job.running=true;job.error='';job.notes=[];freshAnalysis=explicit;
   try {
     current();if(job.pending.length)await deliver([]);
     await savedMaterials();job.stage='3 / 3 · Поиск недостающих материалов';
     if(connected) {
       await refresh();current();
       const z=getWorkspace().complexes.find(z=>z.id===item?.complexId);
       if(z?.demo || z?.origin==='demo')note('Вымышленный объект: внешний поиск отключён.');
       else if(remote?.configured){await startResearch(caseId,searchDomains);await refresh();note('Сбор продолжится на сервере при закрытом браузере. Результаты появятся в этом деле.');}
       else note(remoteError||'Внешний поиск не подключён. Сохранённые материалы обработаны.');
     }
     job.stage='Подготовка завершена · кандидаты ждут проверки';
     try{sessionStorage.setItem(`saq-prepared:${key}`,JSON.stringify({notes:job.notes,completed:job.completed,total:job.total}));}catch{}
   }catch(e){job.error=e instanceof Error?e.message:String(e);job.stage='Подготовка прервана · частичный результат сохранён';}
   finally{job.running=false;tick++;}
   await ingest();
 }
 async function manualImport(source:ResearchSource){
   if(job.running)return;job.running=true;job.error='';
   try{if(job.pending.length)await deliver([]);await importSource(source,true);}
   catch(e){job.error=e instanceof Error?e.message:String(e);}
   finally{job.running=false;tick++;}
 }
 async function monitor(hours:number){monitorBusy=true;remoteError='';try{await setResearchMonitor(caseId,hours,searchDomains);await refresh();}catch(e){remoteError=e instanceof Error?e.message:String(e);}finally{monitorBusy=false;}}
 onMount(()=>{
   let disposed=false;let polling=false;
   let completed=false;try{const stored=sessionStorage.getItem(`saq-prepared:${key}`);completed=!!stored;if(stored&&stored!=='1'){const previous=JSON.parse(stored);job.notes=previous.notes??[];job.completed=previous.completed??0;job.total=previous.total??0;}}catch{}
   if(completed && job.stage==='Подготовка ещё не запускалась')job.stage='Предыдущий проход завершён · материалы и кандидаты сохранены';
   if(!completed && active && new URLSearchParams(location.hash.split('?')[1]).get('prepare')==='1' && job.stage==='Подготовка ещё не запускалась')void run();
   else void refresh().then(()=>{if(!disposed)void ingest();});
   const timer=setInterval(()=>{tick++;},250);
   const poll=setInterval(async()=>{if(disposed||polling)return;polling=true;try{await refresh();if(!disposed)await ingest();}finally{polling=false;}},5000);
   return()=>{disposed=true;clearInterval(timer);clearInterval(poll);onbusy(false);};
 });
</script>
<section class="panel mb-4 preparation" aria-label="Автоматическая подготовка расследования">
 <div class="actions"><h2>Подготовка расследования</h2>{#if active}<button disabled={view.running} onclick={()=>run(true)}>{view.error||view.pending.length?'Повторить подготовку':'Подготовить материалы'}</button>{/if}</div>
 <p role="status" aria-live="polite">{view.stage}{view.total?` · ${view.completed} / ${view.total}`:''}</p>
 {#if view.running}<progress aria-label="Разбор материалов" max={view.total||1} value={view.completed}></progress>{/if}
 {#if !connected}<p class="notice mt-2">DEMO · настоящий локальный RU/KZ parser. LLM, внешний поиск и OCR не подключены.</p>{/if}
 <p class="muted text-xs mt-2">Сбор и предложения фактов баллов не начисляют. Факты подтверждает аналитик.</p>
 {#if view.error}<p class="error mt-3" role="alert">{view.error}{#if view.pending.length} Доставка: {view.next} / {view.pending.length}; повтор использует прежние команды.{/if}</p>{/if}
 {#each view.notes as limitation}<p class="notice mt-2">{limitation}</p>{/each}
 {#if connected}
 <p class="muted mt-3">Внешний поиск: {remote?.configured?'подключён':'недоступен'} · приоритетные источники: {remote?.domains.join(', ')||'не установлены'}, затем общий поиск.</p>
 {#if remote?.configured}<details class="mt-3"><summary>Приоритетные источники поиска</summary>{#each remote.domains as domain}<label class="domain-selection"><input type="checkbox" value={domain} bind:group={searchDomains} disabled={view.running||monitorBusy}/>{domain}</label>{/each}<p class="muted text-xs">Сначала выбранные источники, затем общий поиск. Без выбранных источников — только общий поиск. Выбор применяется к следующему запуску.</p>{#if remote.monitor}<button disabled={monitorBusy} onclick={()=>monitor(remote?.monitor?.hours??0)}>Сохранить источники мониторинга</button>{/if}</details>{/if}
 {#if remoteError}<p class="error" role="alert">{remoteError}</p>{/if}
 {#if remote?.job}<p role="status">Сбор: {remote.job.status==='queued'?'В очереди':remote.job.status==='running'?'Идёт поиск':remote.job.status==='failed'?'Ошибка':'Завершён'} · {remote.job.error??''}</p>{#each remote.job.result?.limitations??[] as limitation}<p class="notice mt-2">{limitation}</p>{/each}{/if}
 <label class="mt-3">Мониторинг этого дела<select disabled={monitorBusy||!remote?.monitorConfigured} value={remote?.monitor?.hours??0} onchange={e=>monitor(Number(e.currentTarget.value))}><option value="0">Выключен · один проход</option><option value="6">Каждые 6 часов</option><option value="24">Каждый день</option><option value="168">Раз в неделю</option></select></label>
 {#if !remote?.monitorConfigured}<p class="muted text-xs">Мониторинг недоступен: серверу нужны поиск и доступ для сверки актуального дела.</p>{/if}
 {#if remote?.monitor&&!remote.monitorConfigured}<button disabled={monitorBusy} onclick={()=>monitor(0)}>Выключить мониторинг</button>{/if}
 {#if remote?.monitor}<p class="muted text-xs">Следующий сбор: {new Date(remote.monitor.nextRunAt*1000).toLocaleString('ru-RU')} · серверный первичный разбор локальными правилами, без LLM.</p>{/if}
 {#if sources.length}<details class="mt-4"><summary>Внешние находки и уточнения · {sources.length}</summary>{#each sources as source}<article class="evidence-row mt-3"><b>{source.title}</b><p class="muted text-xs">{source.date||'Дата события неизвестна'} · фиксация: {new Date(source.capturedAt*1000).toLocaleString('ru-RU')} · {source.matchReason}</p><p>{source.originalCaptured?'Оригинальный текст сохранён':'Есть только поисковый фрагмент; оригинал не сохранён'} · {source.candidates.length} предварительных кандидатов · локальные правила, без LLM</p><details><summary>Текст находки</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">{source.text}</pre></details><a href={source.url} target="_blank" rel="noopener noreferrer">Первоисточник ↗</a>{#if active&&source.originalCaptured}<button class="small" disabled={view.running} onclick={()=>manualImport(source)}>Объект и очередь сверены — добавить материал</button>{/if}</article>{/each}</details>{/if}
 {/if}
 <details class="mt-4" bind:open={manual}><summary>Добавить материал вручную в это дело</summary>{#if manual&&item}<Analyze workspace={getWorkspace()} zkId={item.complexId} {commit}/><p class="muted">После сохранения запустите подготовку материалов; для дела очереди укажите ту же очередь.</p>{/if}</details>
</section>
<style>.preparation h2{margin:0}.preparation progress{width:100%;margin-top:1rem}.preparation pre{max-height:20rem;overflow:auto}.preparation select{max-width:100%}.domain-selection{display:flex;flex-direction:row;align-items:center;gap:.5rem;margin-top:.5rem}.domain-selection input{width:auto;flex:none}</style>
