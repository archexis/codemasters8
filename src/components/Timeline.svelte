<script lang="ts">
 import type {AppState,Command} from '../lib/types';
 import {dossierTimeline,type DossierEvent} from '../lib/dossier-context';
 import {newCommandId} from '../lib/repository';
 import {safeUrl} from '../lib/domain';
 import {frameDate} from '../lib/construction-images';
 import MediaCard from './MediaCard.svelte';
 import ConstructionImage from './ConstructionImage.svelte';
 let {workspace,complexId,phaseId,caseId,commit,onSelect}:{workspace:AppState;complexId:string;phaseId?:string;caseId?:string;commit:(c:Command)=>Promise<void>;onSelect?:(id:string)=>void}=$props();
 let kind=$state('');let from=$state('');let to=$state('');let page=$state(0);let first=$state('');let second=$state('');let sameView=$state(false);let error=$state('');
 let comparison=$state<HTMLDialogElement>();
 let comparing=$state(false);
 let expandedIllustration=$state('');
 const events=$derived(dossierTimeline(workspace,complexId,phaseId));
 const filtered=$derived(events.filter(e=>(!kind||e.kind===kind)&&(!from || !!e.occurredAt&&e.occurredAt>=from)&&(!to || !!e.occurredAt&&e.occurredAt.slice(0,10)<=to)));
 const photos=$derived(events.filter(e=>e.illustration||e.media?.kind.startsWith('image/')));
 const a=$derived(photos.find(e=>e.id===first));const b=$derived(photos.find(e=>e.id===second));
 const syntheticComparison=$derived(!!a?.illustration||!!b?.illustration);
 $effect(()=>{kind;from;to;page=0;});
 $effect(()=>{
  if(!photos.some(p=>p.id===first))first=photos.at(-1)?.id??'';
  if(!photos.some(p=>p.id===second))second=photos[0]?.id??'';
 });
 $effect(()=>{first;second;sameView=false;});
 function photoLabel(event:DossierEvent){return (event.occurredAt?.slice(0,10)??'Дата неизвестна')+' · '+(event.illustration?'AI-реконструкция · условная дата':event.source);}
 function showFrame(event:DossierEvent){if(event.illustration)expandedIllustration=expandedIllustration===event.id?'':event.id;else if(event.media)onSelect?.(event.media.id);}
 async function attach(e:DossierEvent){if(!caseId||e.illustration)return;error='';try{let artifactId=e.artifactId;if(!artifactId){artifactId='EV-'+newCommandId();await commit({type:'artifact.register',artifact:{id:artifactId,complexId,...(phaseId?{phaseId}:{}),kind:'event',source:e.source,text:e.text,...(e.occurredAt?{date:e.occurredAt.slice(0,10)}:{}),...(e.media?{mediaId:e.media.id}:{}),...(e.url?{url:e.url}:{})}});}await commit({type:'case.attach',caseId,artifactId});}catch(err){error=String(err);}}
</script>

<div class="filters"><label>События<select bind:value={kind}><option value="">Вся история</option>{#each ['Документы','Стройка','Реклама','Решения'] as k}<option>{k}</option>{/each}</select></label><label>С<input type="date" bind:value={from}/></label><label>По<input type="date" bind:value={to}/></label></div>
{#if error}<p class="error" role="alert">{error}</p>{/if}
{#each filtered.slice(page*25,(page+1)*25) as event (event.id)}
 <article class="timeline-row" class:illustration-event={!!event.illustration}>
  <span>{#if event.illustration}Условная дата<br/>{frameDate(event.illustration.date)}{:else}{event.occurredAt?.slice(0,10) ?? 'Дата события неизвестна'}{/if}</span>
  <div>
   {#if event.illustration}{#if expandedIllustration===event.id}<ConstructionImage frame={event.illustration}/>{:else}<button class="timeline-thumbnail" aria-label={'Показать AI-реконструкцию за '+frameDate(event.illustration.date)} onclick={()=>showFrame(event)}><img src={event.illustration.thumbnail} alt={'AI-реконструкция ЖК «'+event.illustration.complexName+'» · '+frameDate(event.illustration.date)} width="400" height="300" loading="lazy" decoding="async"/></button>{/if}{/if}
   <p>{event.text}</p>
   <p class="muted text-xs">{event.source}{#if !event.illustration} · Зафиксировано: {event.capturedAt ?? 'неизвестно'}{/if}</p>
   <div class="actions mt-3">
    {#if event.media||event.illustration}<button class="small" onclick={()=>showFrame(event)}>{expandedIllustration===event.id?'Свернуть кадр':'Показать кадр'}</button>{/if}
    {#if safeUrl(event.url)}<a class="button small" href={safeUrl(event.url)} target="_blank" rel="noopener noreferrer">Источник ↗</a>{/if}
    {#if caseId&&!event.illustration}<button class="small" onclick={()=>attach(event)}>Добавить событие в дело</button>{/if}
   </div>
  </div>
 </article>
{:else}<p class="muted">Датированных материалов для выбранного периода нет.</p>{/each}
<div class="actions my-4"><button disabled={!page} onclick={()=>page--}>Назад</button><span>Страница {page+1} · {filtered.length} событий</span><button disabled={(page+1)*25>=filtered.length} onclick={()=>page++}>Далее</button></div>

<section class="panel mt-5"><h3>Сравнить два периода</h3><div class="form-grid my-4"><label>Первый кадр<select bind:value={first}><option value="">Выберите снимок</option>{#each photos as p}<option value={p.id}>{photoLabel(p)}</option>{/each}</select></label><label>Второй кадр<select bind:value={second}><option value="">Выберите снимок</option>{#each photos as p}<option value={p.id}>{photoLabel(p)}</option>{/each}</select></label></div><button disabled={!a||!b||first===second} onclick={()=>{comparing=true;comparison?.showModal();}}>Сравнить снимки</button><p class="muted mt-3">{syntheticComparison?'AI-реконструкции показывают вымышленную последовательность строительства. Даты условные.':'Фотографии не определяют процент готовности. Разные ракурсы сравниваются рядом.'}</p></section>

<dialog bind:this={comparison} class="compare-overlay" aria-label="Сравнение снимков" onclose={()=>comparing=false}>
 {#if comparing&&a&&b}
  <div class="page-heading"><h2>Сравнение периодов</h2><button onclick={()=>comparison?.close()}>Закрыть сравнение</button></div>
  <div class="two-col">
   <div>{#if a.illustration}<ConstructionImage frame={a.illustration}/>{:else if a.media}{#key a.media.id}<MediaCard media={a.media}/>{/key}{/if}</div>
   <div>{#if b.illustration}<ConstructionImage frame={b.illustration}/>{:else if b.media}{#key b.media.id}<MediaCard media={b.media}/>{/key}{/if}</div>
  </div>
  {#if syntheticComparison}<p class="notice mt-4">AI-реконструкции с условными датами. Иллюстрации не подтверждают фактический ход строительства и не влияют на оценку риска.</p>
  {:else}<label class="check-label mt-4"><input type="checkbox" bind:checked={sameView}/> Аналитик установил сопоставимость ракурсов</label><p>{!a.occurredAt||!b.occurredAt ? 'Дата одного из снимков неизвестна — исторический вывод невозможен.' : sameView ? 'Сопоставимые ракурсы: визуальная оценка аналитика; автоматическая оценка готовности отсутствует.' : 'Сопоставимость ракурсов не установлена. Только просмотр рядом.'}</p><p class="notice mt-4">Недостаточно данных для автоматического вывода об отставании. Для R5/R6 нужны датированные документальные материалы.</p>{/if}
 {/if}
</dialog>

<style>
 .timeline-thumbnail { display:block; padding:0; margin-bottom:12px; max-width:280px; width:100%; background:transparent; border:0; box-shadow:none; }
 .timeline-thumbnail img { display:block; width:100%; height:auto; aspect-ratio:4/3; border-radius:8px; }
 .timeline-row>div { min-width:0; flex:1; }
 dialog { margin:0; width:auto; max-width:none; max-height:none; color:inherit; }
 dialog::backdrop { background:#162d2370; }
</style>
