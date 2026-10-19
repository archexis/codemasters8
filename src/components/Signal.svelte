<script lang="ts">
  import type { AppState, Command } from '../lib/types';
  import {buildSignalSnapshot, latestSignalVersion} from '../lib/signal-snapshot';
  import {parseSignalRevision, signalRevisionError} from '../lib/signal-revision';
  import MediaCard from './MediaCard.svelte';
  import {WEIGHTS, FACTOR_META, zoneLabel} from '../lib/scoring';
  let {workspace,zkId,commit}:{workspace:AppState;zkId:string;commit:(c:Command)=>Promise<void>}=$props();
  let revision=$state<number|null>(parseSignalRevision(location.hash.split('?')[1] ?? ''));
  const revisionError=$derived(signalRevisionError(workspace,zkId,revision));
  let comment=$state(''); let error=$state(''); let busy=$state(false);
  const versions=$derived(workspace.signalVersions?.[zkId] ?? []);
  const selected=$derived(revision===null ? (workspace.signals[zkId]?.status==='draft' ? null : latestSignalVersion(workspace,zkId)) : versions.find(v=>v.revision===revision));
  const vm=$derived(selected ?? {...buildSignalSnapshot($state.snapshot(workspace),zkId),id:zkId+'-draft',revision:0,status:'draft',sourceVersion:'текущая',at:workspace.signals[zkId]?.at ?? 'не указано',reviewer:workspace.signals[zkId]?.reviewer ?? 'не указан',comment:workspace.signals[zkId]?.comment ?? '',basedOnRevision:workspace.signals[zkId]?.basedOnRevision,legacyIncomplete:false});
  const z=$derived(vm.snapshot);
  const incomplete=$derived(!!selected && (selected.legacyIncomplete || !selected.ads || !selected.snapshot));
  const editable=$derived(revision===null && vm.status==='draft');
  async function decide(status:'draft'|'confirmed'|'returned'){busy=true;error='';try{await commit({type:'signal',zkId,status,comment});comment='';}catch(e){error=String(e);}finally{busy=false;}}
</script>
{#if revisionError}
<section class="panel"><p role="alert">{revisionError}</p><a class="button" href="#/signal/{zkId}">К текущему сигналу</a></section>
{:else}
<div class="no-print actions mb-6">
  <a class="button" href="#/detail/{zkId}">К текущему объекту</a>
  <label>Версия сигнала<select bind:value={revision}><option value={null}>Текущее состояние</option>{#each versions as v}<option value={v.revision}>Revision {v.revision} · {v.status}</option>{/each}</select></label>
  <a class="button" href={`#/export/${zkId}${revision===null ? '' : '?revision='+revision}`}>Экспорт данных</a>
  <button onclick={()=>window.print()}>Печать / PDF</button>
</div>
{#if error}<p role="alert">{error}</p>{/if}
<article class="panel signal-sheet">
  <p class="eyebrow">SAQ Qurylys · сигнальная карточка</p>
  <h1>{z?.name ?? zkId}</h1><p>{z?.address ?? 'Исторический адрес неизвестен'}</p>
  <p>Статус: <b>{vm.status === 'confirmed' ? 'Подтверждён' : vm.status === 'returned' ? 'Возвращён' : 'Черновик'}</b></p>
  <details class="tech no-print"><summary>Технические детали снимка</summary><p>ID {vm.id} · ЖК {zkId} · revision {vm.revision || 'draft'} · sourceVersion {vm.sourceVersion} · basedOnRevision {vm.basedOnRevision ?? 'нет'}</p></details>
  <p>{vm.at} · автор: {vm.reviewer}</p><p>Обоснование: {vm.comment || 'не указано'}</p>
  {#if incomplete}<p class="error">legacyIncomplete: исторический снимок неполон. Полная утверждённая карточка недоступна; требуется новая проверка.</p>{:else if z}
    <div class="risk-score {vm.zone}"><strong>{vm.score}</strong><span class="zone-total">из 100</span><span class="formula">Сумма подтверждённых факторов · веса v{vm.weightsVersion}: R1 35, R2 25, R3 10, R4 15, R5 10, R6 5</span></div>
    <p>Застройщик: {z.developer} · БИН: {z.bin || 'не указан'} · стадия: {z.stage || 'не указана'}</p>
    <h2>Сверка правового основания</h2><p>{z.legalBasis.type} / {z.legalBasis.status} · {z.legalBasis.source || 'не указан'} · {z.legalBasis.checkedAt || 'дата неизвестна'}</p><p>{z.legalBasis.reviewText || 'материал отсутствует'}</p>
    {#each z.factors.filter(f=>f.status==='confirmed') as f}
      <section class="factor-print"><h2>{f.code} +{WEIGHTS[f.code]} · {FACTOR_META[f.code].title}</h2>
        <p>Решение: {f.reviewer} · {f.updatedAt}</p><p>Материал {f.evidence?.id ?? 'не указан'} · источник: {f.evidence?.source || 'не указан'} · дата: {f.evidence?.date || 'неизвестна'}</p>
        <blockquote>{f.evidence?.quote}</blockquote><p>{f.evidence?.text}</p>
        {#if f.evidence?.beforeCommissioning}<p>До ввода (заявление аналитика): {f.evidence.beforeCommissioning.source} · {f.evidence.beforeCommissioning.date} · {f.evidence.beforeCommissioning.text}</p>{/if}
        {#each (vm.decisionAudit ?? []).filter(e=>{const d=e.details as {code?:string;hypothesis?:{code:string}};return d?.code===f.code || d?.hypothesis?.code===f.code;}).slice(0,1) as e}<p>Комментарий аналитика: {e.comment}</p>{/each}
        {#if f.evidence?.adId}{@const ad=vm.ads?.find(a=>a.id===f.evidence?.adId)}
          {#if ad}<p>Публикация {ad.id} · дата: {ad.date ?? 'не указана'} · фиксация: {ad.captureAt}</p><p>{ad.platform} · {ad.account} · {ad.url || 'URL не указан'}</p><p class="publication-text">{ad.text}</p>{#each ad.sightings ?? [] as sight}<p>Фиксация источника: {sight.source} · {sight.date ?? 'дата неизвестна'} · {sight.captureAt}</p>{/each}{:else}<p>Публикация отсутствует в снимке</p>{/if}
        {/if}
        <p>Файлы: {f.evidence?.mediaIds?.join(', ') || 'нет'}</p>
      </section>
    {/each}
    <details class="tech"><summary>Приложения и происхождение данных</summary>{#each vm.mediaManifest ?? [] as m}{#if m.kind==='media' && m.path}<div class="no-print"><MediaCard media={{id:m.id,zkId,path:m.path,name:m.name ?? m.id,kind:m.mediaKind ?? 'document',date:m.capturedAt?.slice(0,10) ?? '2000-01-01',note:m.note ?? '',ready:null,sha256:m.sha256,bytes:m.bytes}}/></div>{/if}<p>Приложение: {m.id} · SHA256 {m.sha256 ?? 'не зафиксирован'} · байт: {m.bytes ?? 'неизвестно'}</p>{/each}{#each vm.aiProvenance ?? [] as ai}<p>Анализ: {ai.code} · модель {ai.model ?? 'не указана'} · гипотеза {ai.hypothesisId ?? 'не указана'}</p>{/each}</details>
  {/if}
  <p>Признаки риска не устанавливают факт правонарушения. Решение принимает человек.</p>
</article>
{#if revision===null}
<form class="panel no-print mt-5" onsubmit={e=>e.preventDefault()}><label>Обоснование решения<textarea bind:value={comment}></textarea></label><div class="actions mt-4">
{#if editable}<button class="primary" disabled={busy || !comment.trim()} onclick={()=>decide('confirmed')}>Подтвердить сигнал</button><button disabled={busy || !comment.trim()} onclick={()=>decide('returned')}>Вернуть на проверку</button>{:else}<button disabled={busy || !comment.trim()} onclick={()=>decide('draft')}>Открыть пересмотр</button>{/if}
</div></form>
{/if}

{/if}
