<script lang="ts">
  import {onMount,tick} from 'svelte';
  import type {AppState,Command} from '../lib/types';
  import {detectPlatform,parseAdText} from '../lib/parser';
  import {safeUrl} from '../lib/domain';
  import {dossierUrl} from '../lib/navigation';
  import Analyze from './Analyze.svelte';
  import {frameDate} from '../lib/construction-images';
  import {publicationExcerpt} from '../lib/presentation';
  import {readViewState,writeViewState} from '../lib/view-state';
  import {onSessionChange} from '../lib/repository';
  let {workspace,commit,adding=false,initialText='',complexId=''}:{workspace:AppState;commit:(c:Command)=>Promise<void>;adding?:boolean;initialText?:string;complexId?:string}=$props();
  let search=$state(''); let platform=$state(''); let date=$state(''); let link=$state(''); let payment=$state(false); let status=$state(''); let page=$state(0); let selectedId=$state('');
  const platforms=$derived([...new Set(workspace.ads.map(a=>detectPlatform(a).label))]);
  function publicationStatus(id:string){
    const ids=new Set((workspace.artifacts??[]).filter(a=>a.adId===id).map(a=>a.id));
    const claims=(workspace.claims??[]).filter(c=>ids.has(c.artifactId));
    const latest=new Map<string,string>();for(const a of workspace.assertions??[])latest.set(a.claimId,a.status);
    if(claims.some(c=>latest.get(c.id)==='verified'))return 'verified';
    if(claims.some(c=>c.triage==='accepted'))return 'accepted';
    if(claims.length&&claims.every(c=>c.triage==='rejected'))return 'rejected';
    return 'saved';
  }
  const filtered=$derived(workspace.ads.filter(a=>(!search || `${a.text} ${a.account}`.toLowerCase().includes(search.toLowerCase())) && (!platform || detectPlatform(a).label===platform) && (!date || a.date===date) && (!link || a.zkId===link) && (!payment || parseAdText(a.text).payment.flagged) && (!status || publicationStatus(a.id)===status)).sort((a,b)=>b.captureAt.localeCompare(a.captureAt)));
  const selected=$derived(workspace.ads.find(a=>a.id===selectedId));
  $effect(()=>{search;platform;date;link;payment;status;page=0;});
  function reset(){search='';platform='';date='';link='';payment=false;status='';}
  let restored=$state(false);
  let appliedContext='';
  onMount(()=>{
    const restore=()=>{const stored=readViewState('publications',{search:'',platform:'',date:'',link:'',payment:false,status:''});search=typeof stored.search==='string'?stored.search:'';platform=typeof stored.platform==='string'?stored.platform:'';date=typeof stored.date==='string'?stored.date:'';link=typeof stored.link==='string'?stored.link:'';payment=stored.payment===true;status=typeof stored.status==='string'?stored.status:'';selectedId='';appliedContext='';restored=true;};
    restore();return onSessionChange(restore);
  });
  $effect(()=>{if(restored)writeViewState('publications',{search,platform,date,link,payment,status});});
  $effect(()=>{if(restored && !adding && complexId!==appliedContext){appliedContext=complexId;if(complexId){reset();link=complexId;}}});
  let inspector=$state<HTMLElement>();
  let opener:HTMLButtonElement|undefined;
  let listScroll=0;
  async function inspect(id:string,button:HTMLButtonElement){
    listScroll=window.scrollY;opener=button;selectedId=id;await tick();
    inspector?.focus({preventScroll:true});inspector?.scrollIntoView({block:'start',behavior:'instant'});
  }
  async function closeInspector(){selectedId='';await tick();window.scrollTo({top:listScroll,behavior:'instant'});opener?.focus({preventScroll:true});}
</script>
<div class="page-heading"><div><h1>Публикации</h1></div><a class="button primary" href={adding ? '#/publications' : '#/publications?add=1'}>{adding ? 'К ленте' : 'Добавить публикацию'}</a></div>
{#if adding}<Analyze {workspace} {commit} zkId={complexId} {initialText}/>
{:else}
<div class="filters"><label class="grow">Поиск<input type="search" bind:value={search}/></label><label>Площадка<select bind:value={platform}><option value="">Все площадки</option>{#each platforms as p}<option>{p}</option>{/each}</select></label><label>Дата публикации<input type="date" bind:value={date}/></label><label>ЖК<select bind:value={link}><option value="">Все объекты</option>{#each workspace.complexes as z}<option value={z.id}>{z.name}</option>{/each}</select></label><label>Статус<select bind:value={status}><option value="">Все статусы</option><option value="saved">Сохранено</option><option value="accepted">Гипотеза принята</option><option value="verified">Факт проверен</option><option value="rejected">Отклонено</option></select></label><label class="check-label"><input type="checkbox" bind:checked={payment}/> Признаки оплаты</label><button class="small" onclick={reset}>Сбросить</button></div>
<p class="muted mb-4" role="status">Найдено: {filtered.length}</p>
<div class:publication-split={!!selected}><div class="space-y-4">{#each filtered.slice(page*25,(page+1)*25) as ad (ad.id)}<article class="panel"><p class="eyebrow">{detectPlatform(ad).label} · {ad.account || 'Аккаунт неизвестен'}</p><p class="muted text-xs">{ad.date ? frameDate(ad.date) : 'Дата неизвестна'}</p><p class="my-4 publication-text publication-excerpt">{publicationExcerpt(ad)}</p><div class="actions"><button class="small" onclick={e=>inspect(ad.id,e.currentTarget)}>Оригинал и гипотезы</button><a class="button small" href={dossierUrl(ad.zkId,undefined,'verification')}>{workspace.complexes.find(z=>z.id===ad.zkId)?.name || 'Не сопоставлено'} ↗</a></div></article>{:else}<section class="panel"><h2>Публикаций не найдено</h2><p>Измените фильтры или добавьте новый материал.</p></section>{/each}</div>
{#if selected}<aside class="panel publication-inspector" bind:this={inspector} tabindex="-1" aria-label="Оригинал публикации"><div class="page-heading"><h2>Оригинал публикации</h2><button class="small" onclick={closeInspector}>Закрыть</button></div><p class="publication-text">{selected.text}</p><p class="muted my-4">{selected.platform} · {selected.account} · {selected.date ? frameDate(selected.date) : 'Дата неизвестна'}</p>{#if safeUrl(selected.url)}<a class="button small" href={safeUrl(selected.url)} target="_blank" rel="noopener noreferrer">Открыть источник ↗</a>{/if}<h3 class="mt-6">Гипотезы</h3>{#each selected.analysis?.hypotheses ?? [] as h}<blockquote>{h.code} · «{h.quote}»</blockquote><p>{h.reason}</p>{:else}<p class="muted">Гипотез пока нет.</p>{/each}<details class="mt-4"><summary>Сведения об источнике</summary><p class="muted mt-2">Зафиксировано: {selected.captureAt}</p>{#each selected.sightings??[] as sighting}<p class="muted mt-3">Дополнительная фиксация: {sighting.source} · {sighting.date?frameDate(sighting.date):'Дата неизвестна'} · {sighting.captureAt}</p>{#if safeUrl(sighting.url)}<a href={safeUrl(sighting.url)} target="_blank" rel="noopener noreferrer">{sighting.url}</a>{/if}{/each}</details><a class="button mt-4" href={dossierUrl(selected.zkId,undefined,'verification')}>Открыть проверку в досье</a></aside>{/if}</div>
<div class="actions mt-5"><button disabled={page===0} onclick={()=>page--}>Назад</button><span>Страница {page+1}</span><button disabled={(page+1)*25>=filtered.length} onclick={()=>page++}>Далее</button></div>
{/if}
