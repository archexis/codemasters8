<script lang="ts">
 import {untrack} from 'svelte';
 import type {AppState,Code,Command,EvidenceArtifact,ExtractedClaim,LegalBasisType} from '../lib/types';
 import {dossierReadModel} from '../lib/read-models';
 import {caseComplex} from '../lib/investigation';
 import {computeScore,codes,WEIGHTS,FACTOR_META,zoneLabel} from '../lib/scoring';
 import {dossierTabs,dossierUrl,type DossierTab} from '../lib/navigation';
 import {newCommandId,withCommandId,getSessionGeneration,UnknownCommitResultError,StaleConflictError,SessionSupersededError} from '../lib/repository';
 import {safeUrl} from '../lib/domain';
 import {legalBasisLabel,sourceOriginLabel,sourceAvailabilityLabel,artifactKindLabel} from '../lib/presentation';
 import ComplexForm from './ComplexForm.svelte';
 import MediaCard from './MediaCard.svelte';
 import CaseSignal from './CaseSignal.svelte';
 import SourceText from './SourceText.svelte';
 import ReadinessObservation from './ReadinessObservation.svelte';
 import PhaseReadiness from './PhaseReadiness.svelte';
 let {workspace,complexId,phaseId,caseId,tab='overview',evidenceId='',commit}:{workspace:AppState;complexId:string;phaseId?:string;caseId?:string;tab?:DossierTab;evidenceId?:string;commit:(c:Command)=>Promise<void>}=$props();
 const plainWorkspace=$derived($state.snapshot(workspace));
 const model=$derived(dossierReadModel(plainWorkspace,complexId,phaseId));
 const investigation=$derived(caseId?workspace.cases?.find(c=>c.id===caseId):undefined);
 const active=$derived(investigation?.status==='draft');
 const complex=$derived(investigation?caseComplex(plainWorkspace,investigation):{...model.complex,...(model.phase?{legalBasis:model.phase.legalBasis??{type:'unknown' as const,status:'unknown' as const,source:'',checkedAt:'',reviewText:''},readinessClaimed:model.phase.readinessClaimed??null,readinessClaimedSource:model.phase.readinessClaimedSource??null,readinessConfirmed:model.phase.readinessConfirmed??null,readinessSources:model.phase.readinessSources??[]}:{}),factors:model.factors});
 const score=$derived(computeScore(complex.factors));
 let preview=$state(false);let editing=$state(false);let error=$state('');let busy=$state(false);let selectedMedia=$state('');
 let selectedArtifact=$state(untrack(()=>evidenceId));let selectedQuote=$state('');let artifactId=$state('');let code=$state<Code>('R2');let quote=$state('');let comment=$state('');let factDate=$state('');let extra=$state('');let phaseName=$state('');
 let basisType=$state<LegalBasisType>(untrack(()=>model.phase?.legalBasis?.type??'unknown'));let basisSource=$state(untrack(()=>model.phase?.legalBasis?.source??''));let basisDate=$state(untrack(()=>model.phase?.legalBasis?.checkedAt??''));let basisText=$state(untrack(()=>model.phase?.legalBasis?.reviewText??''));
 let periodFrom=$state('');let periodTo=$state('');let phaseFrom=$state('');let phaseTo=$state('');let basisFrom=$state('');let basisTo=$state('');
 const assertions=$derived((workspace.assertions??[]).filter(a=>a.caseId===caseId));
 const media=$derived(workspace.media.filter(m=>m.zkId===complexId && (!phaseId||model.artifacts.some(a=>a.mediaId===m.id))));
 const shownMedia=$derived(media.find(m=>m.id===selectedMedia)??media[0]);
 const selectedEvidence=$derived(model.artifacts.find(a=>a.id===selectedArtifact));

 function route(next:DossierTab){const p=new URLSearchParams({tab:next});if(phaseId)p.set('phase',phaseId);if(selectedArtifact)p.set('evidence',selectedArtifact);location.hash=caseId?`#/cases/${caseId}?${p}`:dossierUrl(complexId,phaseId,next,selectedArtifact);}
 let actionIntent=$state.raw<{key:string;session:number;commands:Command[];next:number;done:()=>void}|undefined>();
 async function retryAction(){
  if(!actionIntent)return;
  await perform(actionIntent.key,()=>[],actionIntent.done);
 }
 async function perform(key:string,build:()=>Command[],done:()=>void=()=>{}){
  if(busy)return;
  busy=true;error='';
  try{
   const session=getSessionGeneration();
   if(actionIntent&&actionIntent.session!==session)throw new SessionSupersededError();
   if(actionIntent&&actionIntent.key!==key)throw new Error('Сначала повторите прежнее действие с исходными полями.');
   actionIntent??={key,session,commands:build().map(c=>withCommandId(c,newCommandId())),next:0,done};
   while(actionIntent.next<actionIntent.commands.length){
    await commit(actionIntent.commands[actionIntent.next]);
    if(session!==getSessionGeneration())throw new SessionSupersededError();
    actionIntent.next++;
   }
   const finish=actionIntent.done;actionIntent=undefined;finish();
  }catch(e){
   if(!(e instanceof UnknownCommitResultError||e instanceof StaleConflictError||e instanceof SessionSupersededError)&&actionIntent?.key===key)actionIntent=undefined;
   error=e instanceof Error?e.message:String(e);
  }finally{busy=false;}
 }
 function intentKey(action:string,...values:unknown[]){return JSON.stringify([action,...values]);}
 async function start(){
  const existing=model.activeCase??model.cases[model.cases.length-1];
  if(existing&&!actionIntent){location.hash=`#/cases/${existing.id}?tab=${tab}`;return;}
  await perform(intentKey('start',periodFrom,periodTo),()=>{
   const id=`CASE-${newCommandId()}`;
   return [{type:'case.create',id,complexId,...(phaseId?{phaseId}:{}),...(periodFrom?{period:{from:periodFrom,...(periodTo?{to:periodTo}:{})}}:{}),title:`Проверка: ${complex.name}`}];
  },()=>{const item=workspace.cases?.find(c=>c.complexId===complexId&&c.phaseId===phaseId&&c.status==='draft');if(item)location.hash=`#/cases/${item.id}?tab=${tab}`;});
 }
 async function addPhase(){
  let id='';
  await perform(intentKey('phase',phaseName,phaseFrom,phaseTo),()=>{
   if(!phaseName.trim())throw new Error('Укажите название очереди');
   id=`PH-${newCommandId()}`;
   return [{type:'phase.create',phase:{id,complexId,name:phaseName,...(phaseFrom?{period:{from:phaseFrom,...(phaseTo?{to:phaseTo}:{})}}:{})}}];
  },()=>{phaseName='';location.hash=dossierUrl(complexId,id);});
 }
 async function saveBasis(){await perform(intentKey('basis',basisType,basisSource,basisDate,basisText,basisFrom,basisTo),()=>{
  if(!model.phase)return [];
  const status=basisType==='unknown'?'unknown':basisType==='absent'?'absent-verified':'verified';
  return [{type:'phase.update',phase:{...model.phase,legalBasis:{type:basisType,status,source:basisSource,checkedAt:basisDate,reviewText:basisText,...(basisFrom?{period:{from:basisFrom,...(basisTo?{to:basisTo}:{})}}:{})}}}];
 });}
 async function attach(artifact:EvidenceArtifact){if(!caseId)return;await perform(intentKey('attach',artifact.id),()=>[{type:'case.attach',caseId:caseId!,artifactId:artifact.id}]);}
 async function importPublication(adId:string){if(!caseId)return;let id='';await perform(intentKey('publication',adId),()=>{
  const ad=workspace.ads.find(a=>a.id===adId&&a.zkId===complexId);if(!ad)throw new Error('Публикация не найдена');
  const artifact=model.artifacts.find(a=>a.adId===adId);id=artifact?.id??`ART-${newCommandId()}`;
  const commands:Command[]=[];
  if(!artifact)commands.push({type:'artifact.register',artifact:{id,complexId,...(phaseId?{phaseId}:{}),kind:'publication',source:`${ad.platform} · ${ad.account||'аккаунт неизвестен'}`,text:ad.text,adId:ad.id,...(ad.date?{date:ad.date}:{}),...(ad.url?{url:ad.url}:{})}});
  commands.push({type:'case.attach',caseId:caseId!,artifactId:id});return commands;
 },()=>{selectedArtifact=id;});}
 async function propose(){await perform(intentKey('propose',artifactId,code,quote),()=>{
  const artifact=model.artifacts.find(a=>a.id===artifactId);if(!artifact)throw new Error('Выберите первоисточник');
  if(!artifact.text.includes(quote)||!quote.trim())throw new Error('Цитата должна дословно присутствовать в материале');
  return [{type:'claim.propose',claim:{id:`CL-${newCommandId()}`,complexId,...(phaseId?{phaseId}:{}),artifactId,code,quote,reason:'Ручной выбор аналитика',...(investigation?.period?{period:investigation.period}:{})}}];
 },()=>{quote='';});}
 async function review(claim:ExtractedClaim,status:'verified'|'rejected'){if(!caseId)return;await perform(intentKey('review',claim.id,status,comment,factDate,extra),()=>{
  const artifact=model.artifacts.find(a=>a.id===claim.artifactId)!;
  if(!comment.trim())throw new Error('Укажите обоснование проверки факта');
  if(status==='verified'&&!factDate&&!artifact.date)throw new Error('Укажите дату доказательства: дата первичного материала неизвестна.');
  const commands:Command[]=[];
  if(!investigation?.artifactIds.includes(artifact.id))commands.push({type:'case.attach',caseId:caseId!,artifactId:artifact.id});
  commands.push({type:'fact.review',caseId:caseId!,claimId:claim.id,status,comment,evidence:{source:artifact.source,date:factDate||artifact.date||'',text:extra||artifact.text,...(artifact.mediaId?{mediaIds:[artifact.mediaId]}:{}),...(claim.code==='R3'&&claim.runId?{beforeCommissioning:{source:artifact.source,date:factDate||artifact.date||'',text:extra}}:{})}});
  return commands;
 },()=>{comment='';});}

</script>
{#if preview&&caseId}<CaseSignal {workspace} {caseId} {commit} onclose={()=>preview=false}/>
{:else}
<div class="page-heading"><div><a class="muted" href="#/registries">← К каталогу</a><p class="eyebrow mt-4">{complex.id} · {complex.demo?'DEMO · ВЫМЫШЛЕННЫЙ ОБЪЕКТ':complex.origin}</p><h1>{complex.name}</h1><p class="muted mt-2">{complex.address}</p></div><div class="actions"><div class="risk-score {score.zone}"><strong>{score.score}</strong><span>{zoneLabel(score.zone)} зона</span></div>{#if !caseId}<button class="primary" disabled={busy} onclick={start}>{model.cases.length?'Продолжить расследование':'Начать расследование'}</button>{:else}<button class="primary" onclick={()=>preview=true}>Предпросмотр сигнала</button>{/if}</div></div>
{#if error}<p class="error mb-4" role="alert">{error}</p>{/if}
{#if actionIntent}<button class="no-print mb-4" disabled={busy} onclick={retryAction}>Повторить доставку прежнего действия</button>{/if}
{#if !caseId&&!model.cases.length}<details class="panel mb-4"><summary>Период применимости нового дела</summary><div class="form-grid mt-4"><label>Проверяемый период с<input type="date" bind:value={periodFrom}/></label><label>Проверяемый период по<input type="date" min={periodFrom} bind:value={periodTo}/></label></div><p class="muted mt-3">Без периода сигнал явно отмечает, что временная применимость не установлена.</p></details>{/if}
<div class="dossier-context no-print"><label>Область проверки<select value={phaseId??''} onchange={e=>{location.hash=dossierUrl(complexId,e.currentTarget.value||undefined,tab);}}><option value="">Весь ЖК / очередь не определена</option>{#each model.phases as phase}<option value={phase.id}>{phase.name}</option>{/each}</select></label><span class="muted">{complex.legalBasis.status==='unknown'?'Правовое основание не установлено':'Правовое основание сверено'} · неизвестность не начисляет R1</span></div>
{#if investigation}<section class="case-toolbar no-print"><div><b>Investigation Mode · {investigation.id}</b><p class="text-xs">{investigation.status==='draft'?'В работе':investigation.status==='confirmed'?'Сигнал подтверждён':'Возвращено'} · период: {investigation.period ? investigation.period.from+' — '+(investigation.period.to??'открытый') : 'не установлен'} · {investigation.owner} · {investigation.artifactIds.length} материалов</p></div><a class="button small" href={dossierUrl(complexId,phaseId,tab)}>Режим чтения</a></section>{/if}
<div class="dossier-layout"><aside class="dossier-visual panel"><p class="eyebrow">ВИЗУАЛЬНЫЕ МАТЕРИАЛЫ</p>{#if shownMedia}{#key shownMedia.id}<MediaCard media={shownMedia}/>{/key}<p class="muted text-xs">Источник: {shownMedia.name} · дата: {shownMedia.date||'неизвестна'}</p><div class="actions mt-3">{#each media.slice(0,8) as m}<button class="small" aria-pressed={shownMedia.id===m.id} onclick={()=>selectedMedia=m.id}>{m.date||m.name}</button>{/each}</div>{:else}<div class="visual-empty"><span>⌖</span><h3>Датированных снимков нет</h3><p>Загрузите оригинал в реестр документов.</p></div>{/if}<p class="muted text-xs mt-5">3D-модель не предоставлена. Дата спутникового слоя не установлена.</p>{#if complex.lat!=null&&complex.lng!=null}<p class="text-xs mt-3">{complex.lat}, {complex.lng}</p><a class="button small mt-3" href="#/map">К карте ↗</a>{/if}</aside>
<section class="dossier-main"><div class="dossier-tabs no-print" role="tablist" aria-label="Вкладки досье">{#each dossierTabs as item}<button role="tab" aria-selected={tab===item.id} tabindex={tab===item.id?0:-1} onclick={()=>route(item.id)} onkeydown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){const index=dossierTabs.findIndex(t=>t.id===tab);route(dossierTabs[(index+(e.key==='ArrowRight'?1:3))%4].id);}}}>{item.label}</button>{/each}</div>
<div class="panel dossier-content" role="tabpanel" aria-label={dossierTabs.find(t=>t.id===tab)?.label}>
{#if tab==='overview'}<h2>Что известно об объекте</h2><dl><dt>Застройщик</dt><dd>{complex.developer||'Неизвестен'}</dd><dt>БИН</dt><dd>{complex.bin||'Неизвестен'}</dd><dt>Стадия</dt><dd>{complex.stage||'Неизвестна'}</dd><dt>Заявленная готовность</dt><dd>{complex.readinessClaimed==null?'Неизвестна':complex.readinessClaimed+'%'} · {complex.readinessClaimedSource?.source||'Источник неизвестен'}</dd><dt>Подтверждённая готовность</dt><dd>{complex.readinessConfirmed==null?'Неизвестна':complex.readinessConfirmed+'%'}</dd><dt>Основание / сверка</dt><dd>{legalBasisLabel(complex.legalBasis.type)} · {complex.legalBasis.source||'Источник неизвестен'} · {complex.legalBasis.checkedAt||'Дата неизвестна'}</dd></dl><p class="muted mt-4">{complex.note}</p>{#if model.phase}<PhaseReadiness phase={model.phase} {commit}/>{:else}<ReadinessObservation {complexId} {commit}/>{/if}<h2 class="mt-6">Почему такая зона риска</h2>{#each codes as c}{@const f=complex.factors.find(f=>f.code===c&&f.status==='confirmed')}<div class="factor-row"><span><b>{c}</b>{FACTOR_META[c].title}<small>{f?'Подтверждён · '+(f.evidence?.source??''):'Нет проверенного факта'} · {FACTOR_META[c].hint}</small></span><b>+{f?WEIGHTS[c]:0}</b></div>{/each}<p class="notice mt-4">Баллы даёт только проверка конкретного факта. Нулевой балл не доказывает безопасность.</p><div class="actions mt-5"><button onclick={()=>editing=!editing}>Редактировать сведения ЖК</button><a class="button" href={`#/publications?add=1&complex=${complexId}`}>Добавить публикацию</a></div>{#if editing}<ComplexForm value={model.complex} onsave={async z=>{await commit({type:'complex',complex:z});editing=false;}} oncancel={()=>editing=false}/>{/if}
<details class="mt-6"><summary>Очереди и применимость документов</summary><form class="actions mt-4" onsubmit={e=>{e.preventDefault();void addPhase();}}><label>Название новой очереди<input required bind:value={phaseName}/></label><label>Очередь действует с<input type="date" bind:value={phaseFrom}/></label><label>Очередь действует по<input type="date" min={phaseFrom} bind:value={phaseTo}/></label><button disabled={busy}>Добавить очередь</button></form>{#if model.phase}<form class="space-y-3 mt-4" onsubmit={e=>{e.preventDefault();void saveBasis();}}><h3>Основание именно этой очереди</h3><label>Основание<select bind:value={basisType}><option value="unknown">Не установлено</option><option value="absent">Отсутствие всех оснований проверено</option><option value="guarantee">Применимая гарантия</option><option value="mio-permit">Применимое разрешение МИО</option></select></label><label>Источник<input required={basisType!=='unknown'} bind:value={basisSource}/></label><label>Дата сверки<input type="date" required={basisType!=='unknown'} bind:value={basisDate}/></label><label>Область и результат сверки<textarea required={basisType!=='unknown'} bind:value={basisText}></textarea></label><div class="form-grid"><label>Основание применимо с<input type="date" bind:value={basisFrom}/></label><label>Основание применимо по<input type="date" min={basisFrom} bind:value={basisTo}/></label></div><button disabled={busy}>Сохранить основание очереди</button></form>{/if}</details>
{:else if tab==='verification'}<h2>Источники и проверка утверждений</h2>{#if !active}<p class="notice mb-4">Чтение материалов. Для проверки фактов начните или откройте на пересмотр расследование.</p>{/if}<div class="space-y-4">{#each model.artifacts as artifact}<article class="evidence-row" class:selected-evidence={selectedArtifact===artifact.id}><div class="actions"><button class="small" onclick={()=>selectedArtifact=artifact.id}>{artifact.source}</button><span class="badge">{artifactKindLabel(artifact.kind)} · {sourceOriginLabel(artifact.origin)} · {sourceAvailabilityLabel(artifact.availability)} · {artifact.date||'Дата неизвестна'}</span>{#if active}<button class="small" disabled={busy||investigation?.artifactIds.includes(artifact.id)} onclick={()=>attach(artifact)}>{investigation?.artifactIds.includes(artifact.id)?'В деле':'Добавить в дело'}</button>{/if}</div><p class="muted text-xs mt-2">{artifact.id} · фиксация: {artifact.capturedAt}</p>{#if selectedArtifact===artifact.id}<div class="my-4"><SourceText text={artifact.text} quote={selectedQuote}/></div>{#if safeUrl(artifact.url)}<a class="button small" href={safeUrl(artifact.url)} target="_blank" rel="noopener noreferrer">Оригинал ↗</a>{/if}{#if artifact.mediaId}{@const m=workspace.media.find(m=>m.id===artifact.mediaId)}{#if m}<MediaCard media={m} pageNumber={artifact.pageNumber}/>{/if}{/if}{/if}</article>{:else}<p class="muted">Материалы ещё не внесены в Evidence Ledger.</p><a class="button" href="#/registries">Добавить документ</a>{/each}</div>
<h2 class="mt-6">Сохранённые публикации ЖК</h2>{#each workspace.ads.filter(a=>a.zkId===complexId) as ad}<article class="ad-item"><p class="text-xs muted">{ad.platform} · {ad.date??'Дата неизвестна'} · фиксация: {ad.captureAt}</p><p>{ad.text}</p>{#if active}<button class="small mt-3" disabled={busy} onclick={()=>importPublication(ad.id)}>Внести первоисточник в дело</button>{:else}<a class="button small mt-3" href={`#/publications?complex=${complexId}`}>Открыть в публикациях</a>{/if}</article>{:else}<p class="muted">Публикаций пока нет.</p>{/each}
<h2 class="mt-6">Кандидаты в проверку</h2>{#each model.claims as claim}{@const fact=[...assertions].reverse().find(a=>a.claimId===claim.id)}<article class="hypothesis mb-4"><b>{claim.code} · {fact?.status==='verified'?'Факт проверен':fact?.status==='rejected'?'Факт отклонён':'Кандидат'}</b><blockquote>{claim.quote}</blockquote><p>{claim.reason}</p><p class="muted text-xs">Триаж AI: {claim.triage==='accepted'?'Гипотеза принята':claim.triage==='rejected'?'Гипотеза отклонена':'Не оценена / ручное извлечение'}</p><button class="small" onclick={()=>{selectedArtifact=claim.artifactId;selectedQuote=claim.quote;}} >Показать оригинал</button>{#if active}<div class="actions mt-3"><button class="primary" disabled={busy||!comment.trim()} onclick={()=>review(claim,'verified')}>Подтвердить факт {claim.code}</button><button disabled={busy||!comment.trim()} onclick={()=>review(claim,'rejected')}>Отклонить факт</button></div>{/if}{#if fact}<p class="text-xs mt-2">{fact.actor} · {fact.at} · {fact.comment}</p>{/if}</article>{:else}<p class="muted">Нет извлечённых утверждений. Выберите дословный фрагмент первоисточника вручную.</p>{/each}
{#if active}<section class="space-y-4 mt-5"><label>Обоснование проверки факта<textarea bind:value={comment}></textarea></label><label>Дата доказательства<input type="date" bind:value={factDate}/></label><label>Дополнительный датированный материал (для R3: состояние до ввода)<textarea bind:value={extra}></textarea></label><details><summary>Выделить утверждение вручную</summary><form class="space-y-3 mt-4" onsubmit={e=>{e.preventDefault();void propose();}}><label>Первичный материал<select required bind:value={artifactId}><option value="">Выберите источник</option>{#each model.artifacts as artifact}<option value={artifact.id}>{artifact.source}</option>{/each}</select></label><label>Фактор<select bind:value={code}>{#each codes as c}<option value={c}>{c} · {FACTOR_META[c].title}</option>{/each}</select></label><label>Точная цитата<textarea required bind:value={quote}></textarea></label><button disabled={busy}>Создать кандидата</button></form></details></section>{/if}
{:else if tab==='relations'}{#await import('./Relations.svelte')}<p role="status">Загрузка связей…</p>{:then module}<module.default workspace={plainWorkspace} {complexId} {phaseId} caseId={active?caseId:undefined} {commit}/>{:catch}<p role="alert">Связи не удалось загрузить. Повторите открытие вкладки.</p>{/await}
{:else if tab==='timeline'}{#await import('./Timeline.svelte')}<p role="status">Загрузка хронологии…</p>{:then module}<module.default workspace={plainWorkspace} {complexId} {phaseId} caseId={active?caseId:undefined} {commit} onSelect={id=>selectedMedia=id}/>{:catch}<p role="alert">Не удалось загрузить хронологию.</p>{/await}{/if}
</div></section></div>
{#if caseId}<details class="panel mt-5"><summary>Журнал дела</summary>{#each workspace.audit.filter(e=>e.zkId===complexId).slice(0,30) as event}<div class="timeline-row"><span>{event.at}</span><p>{event.reviewer} · {event.action}<br/>{event.comment}</p></div>{/each}</details>{/if}
{/if}
