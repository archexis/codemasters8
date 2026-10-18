<script lang="ts">
  import type { AppState, Code, Complex, FactorStatus } from '../lib/types';
  import type { Command } from '../lib/domain';
  import { codes, computeScore, FACTOR_META, WEIGHTS, zoneLabel } from '../lib/scoring';
  import { uploadFile, removeFile } from '../lib/repository';
  import { safeUrl } from '../lib/domain';
  import ComplexForm from './ComplexForm.svelte';
  import MediaCard from './MediaCard.svelte';
  let { workspace, complex, commit, signal = false }: { workspace: AppState; complex: Complex; commit: (c: Command) => Promise<void>; signal?: boolean } = $props();
  let edit = $state(false); let busy = $state(false); let error = $state('');
  let code = $state<Code>('R2'); let status = $state<FactorStatus>('confirmed'); let source = $state(''); let quote = $state(''); let comment = $state('');
  let ready = $state<number | undefined>(); let observationSource = $state(''); let observationDate = $state(new Date().toISOString().slice(0,10)); let note = $state(''); let files = $state<FileList>();
  const score = $derived(computeScore(complex.factors));
  const currentSignal = $derived(workspace.signals[complex.id]);
  const displayComplex = $derived(signal && currentSignal?.status !== 'draft' && currentSignal?.snapshot ? currentSignal.snapshot : complex);
  const displayScore = $derived(computeScore(displayComplex.factors));
  const ads = $derived(workspace.ads.filter(a => a.zkId === complex.id));
  async function act(command: Command) { busy = true; error = ''; try { await commit(command); } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { busy = false; } }
  async function upload() {
    busy = true; error = '';
    try {
      if (!files?.[0]) throw new Error('Выберите файл');
      const media = await uploadFile(files[0], complex.id);
      media.note = note; media.date = observationDate; media.ready = ready ?? null;
      try { await commit({ type: 'media', media }); } catch (e) { await removeFile(media.path); throw e; }
    } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { busy = false; }
  }
</script>
<div class="page-heading"><div><a href="#/overview" class="muted">← Все объекты</a><p class="eyebrow mt-5">{complex.id} / {signal ? 'СИГНАЛЬНАЯ КАРТОЧКА' : complex.demo ? 'ДЕМОНСТРАЦИОННЫЙ ОБЪЕКТ' : 'КАРТОЧКА ОБЪЕКТА'}</p><h1>{complex.name}</h1><p class="muted mt-2">{complex.address}</p></div><div class="risk-score {score.zone}"><strong>{score.score}</strong><span>{zoneLabel(score.zone)} зона</span></div></div>
<div class="actions mb-6 no-print"><a class="button" href="#/analyze/{complex.id}">Проверить объявление</a><a class="button" href={signal ? `#/detail/${complex.id}` : `#/signal/${complex.id}`}>{signal ? 'К карточке объекта' : 'Сигнальная карточка'}</a>{#if !signal}<button onclick={() => edit = !edit}>Редактировать объект</button>{/if}</div>
{#if error}<p class="error mb-4" role="alert">{error}</p>{/if}
{#if edit}<ComplexForm value={complex} onsave={async z => { await commit({ type: 'complex', complex: z }); edit = false; }} oncancel={() => edit = false}/>{/if}
{#if signal}
  <article class="panel signal-sheet">
    <p class="eyebrow">SAQ QURYLYS · РЕШЕНИЕ АНАЛИТИКА</p><h2>{displayComplex.name}</h2><p>{displayComplex.address}</p>
    <p>Счёт: <b>{displayScore.score}</b> · {zoneLabel(displayScore.zone)} зона</p>
    <p>Статус: <b>{currentSignal?.status === 'confirmed' ? 'Подтверждён' : currentSignal?.status === 'returned' ? 'Возвращён' : 'Черновик'}</b></p>
    {#if currentSignal}<p>{currentSignal.at} · {currentSignal.reviewer}</p><p>Обоснование: {currentSignal.comment}</p>{/if}
    <p>Правовое основание: {displayComplex.legalBasis.source || 'Не проверено'} · {displayComplex.legalBasis.checkedAt}</p>
    {#each displayComplex.factors.filter(f => f.status === 'confirmed') as f}<div class="factor-print"><b>{f.code} +{WEIGHTS[f.code]} · {FACTOR_META[f.code].title}</b><blockquote>{f.evidence?.quote}</blockquote><p>{f.evidence?.source} · {f.evidence?.date || f.updatedAt} · {f.reviewer}</p>{#if f.evidence?.adId}{@const ad = ads.find(a => a.id === f.evidence?.adId)}{#if ad}<p>{ad.id} · Снято: {ad.captureAt} · {ad.url}</p>{/if}{/if}</div>{/each}
    <p class="muted">Признаки риска не устанавливают факт правонарушения. Решение принимает человек. {complex.demo ? 'Данные объекта — DEMO.' : 'Источники требуют ручной сверки.'}</p>
  </article>
  <form class="panel mt-5 no-print" onsubmit={e => e.preventDefault()}><label>Обоснование решения<textarea required bind:value={comment}></textarea></label><div class="actions mt-4"><button class="primary" disabled={busy || !comment.trim()} onclick={() => act({ type: 'signal', zkId: complex.id, status: 'confirmed', comment })}>Подтвердить сигнал</button><button disabled={busy || !comment.trim()} onclick={() => act({ type: 'signal', zkId: complex.id, status: 'returned', comment })}>Вернуть на проверку</button><button onclick={() => window.print()}>Печать / PDF</button></div></form>
{:else}
  <div class="two-col mb-6"><section class="panel"><h2>Объект и основание</h2><dl><dt>Застройщик</dt><dd>{complex.developer}</dd><dt>БИН</dt><dd>{complex.bin || 'Не указан'}</dd><dt>Стадия</dt><dd>{complex.stage}</dd><dt>Готовность</dt><dd>Заявлена: {complex.readinessClaimed ?? '—'}% · подтверждена: {complex.readinessConfirmed ?? '—'}%</dd><dt>Правовое основание</dt><dd>{complex.legalBasis.status === 'verified' ? 'Подтверждено' : complex.legalBasis.status === 'absent-verified' ? 'Отсутствие проверено' : 'Нужна проверка'}</dd><dt>Источник / дата</dt><dd>{complex.legalBasis.source} · {complex.legalBasis.checkedAt}</dd></dl><p class="muted mt-4">{complex.note}</p></section>
  <section class="panel"><h2>Факторы риска</h2>{#each codes as c}{@const f = complex.factors.find(f => f.code === c)}<div class="factor-row"><span><b>{c}</b> {FACTOR_META[c].title}<small>{f?.status === 'confirmed' ? 'Подтверждён' : f?.status === 'rejected' ? 'Отклонён' : f?.status === 'hypothesis' ? 'Гипотеза' : 'Нужна проверка'} · {f?.evidence?.source || FACTOR_META[c].hint}</small></span><b>+{WEIGHTS[c]}</b></div>{/each}</section></div>
  <form class="panel mb-6 space-y-4" onsubmit={e => { e.preventDefault(); void act({ type: 'factor', zkId: complex.id, code, status, evidence: { source, quote, date: new Date().toISOString().slice(0,10) }, comment }); }}>
    <h2>Решение по фактору</h2><div class="form-grid"><label>Фактор<select bind:value={code}>{#each codes as c}<option value={c}>{c} · {FACTOR_META[c].title}</option>{/each}</select></label><label>Решение<select bind:value={status}><option value="confirmed">Подтвердить</option><option value="rejected">Отклонить</option><option value="needs-verification">На проверку</option></select></label><label>Источник доказательства<input required bind:value={source}/></label><label>Дословная цитата<input bind:value={quote}/></label></div><label>Комментарий<input bind:value={comment}/></label><button class="primary" disabled={busy}>Сохранить решение</button>
  </form>
  <section class="panel mb-6 space-y-4"><h2>Площадка · фото и документы</h2><div class="form-grid"><label>Дата наблюдения<input type="date" bind:value={observationDate}/></label><label>Подтверждённая готовность, %<input type="number" min="0" max="100" bind:value={ready}/></label><label>Источник наблюдения<input bind:value={observationSource}/></label><label>Подпись файла<input bind:value={note}/></label></div><label>Фото / видео / PDF<input type="file" accept="image/png,image/jpeg,image/webp,video/mp4,application/pdf" bind:files/></label><div class="actions"><button disabled={busy} onclick={upload}>Сохранить файл</button><button disabled={busy || ready == null || !observationSource.trim()} onclick={() => act({ type: 'readiness', zkId: complex.id, value: ready!, source: observationSource, date: observationDate })}>Зафиксировать готовность</button></div><p class="muted text-xs">Разрыв ≥20 п.п. создаёт гипотезу R5. Подтверждение выполняется отдельно.</p></section>
  <div class="cards mb-6">{#each workspace.media.filter(m => m.zkId === complex.id) as media (media.id)}<MediaCard {media}/>{/each}</div>
  <section class="panel mb-6"><h2>Публикации · {ads.length}</h2>{#each ads as ad}<article class="ad-item" id={ad.id}><p class="eyebrow">{ad.platform} · {ad.date}</p><p>{ad.text}</p>{#if safeUrl(ad.url)}<a href={safeUrl(ad.url)} target="_blank" rel="noopener noreferrer">Источник ↗</a>{/if}</article>{/each}</section>
  <section class="panel"><h2>Источники</h2>{#each complex.sources as s}<p>{#if safeUrl(s.url)}<a href={safeUrl(s.url)} target="_blank" rel="noopener noreferrer">{s.title}</a>{:else}{s.title}{/if} · {s.date}</p>{/each}</section>
{/if}
<section class="panel mt-6"><h2>История</h2>{#each workspace.audit.filter(e => e.zkId === complex.id) as event}<div class="timeline-row"><span>{new Date(event.at).toLocaleString('ru-RU')}</span><p><b>{event.reviewer} · {event.action}</b><br/>{event.comment}</p></div>{/each}{#each complex.events as event}<div class="timeline-row"><span>{event.date}</span><p>{event.text}</p></div>{/each}</section>
