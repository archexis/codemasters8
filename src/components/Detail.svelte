<script lang="ts">
  import type { AppState, Code, Complex, FactorStatus } from '../lib/types';
  import type { Command } from '../lib/domain';
  import { codes, computeScore, FACTOR_META, WEIGHTS, zoneLabel } from '../lib/scoring';
  import { uploadFile, removeFile } from '../lib/repository';
  import { safeUrl } from '../lib/domain';
  import { detectPlatform } from '../lib/parser';
  import ComplexForm from './ComplexForm.svelte';
  import SignalCard from './Signal.svelte';
  import MediaCard from './MediaCard.svelte';
  let { workspace, complex, commit, signal = false }: { workspace: AppState; complex: Complex; commit: (c: Command) => Promise<void>; signal?: boolean } = $props();
  let edit = $state(false); let busy = $state(false); let error = $state('');
  let code = $state<Code>('R2'); let status = $state<FactorStatus>('confirmed'); let source = $state(''); let quote = $state(''); let comment = $state('');
  let adId = $state(''); let evDate = $state(new Date().toISOString().slice(0,10)); let evText = $state('');
  const KIND_FOR: Record<Code, 'publication' | 'legal-review' | 'observation' | 'document'> = { R1: 'legal-review', R2: 'publication', R3: 'publication', R4: 'document', R5: 'observation', R6: 'document' };
  const r5gap = $derived(complex.readinessClaimed == null || complex.readinessConfirmed == null ? null : Math.abs(complex.readinessClaimed - complex.readinessConfirmed));
  async function submitFactor() {
    if (!comment.trim()) { error = 'Добавьте осмысленный комментарий аналитика к решению'; return; }
    if ((code === 'R2' || code === 'R3') && !adId) { error = 'Выберите конкретную публикацию: свободная цитата без adId не сохраняется'; return; }
    const evidence: Record<string, string> = { kind: KIND_FOR[code], source, date: evDate };
    if (code === 'R1' || code === 'R3' || code === 'R4' || code === 'R6') evidence.text = evText;
    if (code === 'R2' || code === 'R3') { evidence.adId = adId; evidence.quote = quote; }
    await act({ type: 'factor', zkId: complex.id, code, status, evidence: evidence as { source: string }, comment });
  }
  let ready = $state<number | undefined>(); let observationSource = $state(''); let observationDate = $state(new Date().toISOString().slice(0,10)); let note = $state(''); let files = $state<FileList>();
  const score = $derived(computeScore(complex.factors));
  const currentSignal = $derived(workspace.signals[complex.id]);
  const displayComplex = $derived(signal && currentSignal?.status !== 'draft' && currentSignal?.snapshot ? currentSignal.snapshot : complex);
  const displayScore = $derived(computeScore(displayComplex.factors));
  const ads = $derived(workspace.ads.filter(a => a.zkId === complex.id));
  /**
   * S3.4 (C4). Способ определения площадки — отдельно от её названия.
   * Публикация (ad.date, null = «не указана») и фиксация (captureAt /
   * sightings) показываются раздельно: captureAt датой публикации не является.
   */
  function viaLabel(via: string): string {
    return via === 'url' ? 'по ссылке' : via === 'hint' ? 'по подсказке' : via === 'manual' ? 'вручную' : 'не указан';
  }
  // S1.3. Причины снятия: audit хранит изменение + автоматически затронутые
  // факторы («Авто-отзыв: …»). Показываем только для отозванных R1/R5.
  const autoNotes = $derived(workspace.audit.filter(e => e.zkId === complex.id && e.comment.includes('Авто-отзыв')));
  const r1Revoked = $derived(complex.factors.some(f => f.code === 'R1' && f.status === 'needs-verification') && autoNotes.some(n => n.comment.includes('R1')));
  const r5Revoked = $derived(complex.factors.some(f => f.code === 'R5' && (f.status === 'needs-verification' || f.status === 'hypothesis')) && autoNotes.some(n => n.comment.includes('R5')));
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
{#if !signal}
<div class="page-heading"><div><a href="#/overview" class="muted">← Все объекты</a><p class="eyebrow mt-5">{complex.id} / {signal ? 'СИГНАЛЬНАЯ КАРТОЧКА' : complex.demo ? 'ДЕМОНСТРАЦИОННЫЙ ОБЪЕКТ' : 'КАРТОЧКА ОБЪЕКТА'}</p><h1>{complex.name}</h1><p class="muted mt-2">{complex.address}</p></div><div class="risk-score {score.zone}"><strong>{score.score}</strong><span>{zoneLabel(score.zone)} зона</span></div></div>
<div class="actions mb-6 no-print"><a class="button" href="#/analyze/{complex.id}">Проверить объявление</a><a class="button" href={signal ? `#/detail/${complex.id}` : `#/signal/${complex.id}`}>{signal ? 'К карточке объекта' : 'Сигнальная карточка'}</a>{#if !signal}<button onclick={() => edit = !edit}>Редактировать объект</button>{/if}</div>
{#if error}<p class="error mb-4" role="alert">{error}</p>{/if}
{#if edit}<ComplexForm value={complex} onsave={async z => { await commit({ type: 'complex', complex: z }); edit = false; }} oncancel={() => edit = false}/>{/if}
{/if}
{#if signal}
  <SignalCard {workspace} zkId={complex.id} {commit}/>
{:else}
  <div class="two-col mb-6"><section class="panel"><h2>Объект и основание</h2><dl><dt>Застройщик</dt><dd>{complex.developer}</dd><dt>БИН</dt><dd>{complex.bin || 'Не указан'}</dd><dt>Стадия</dt><dd>{complex.stage}</dd><dt>Готовность</dt><dd>Заявлена: {complex.readinessClaimed ?? '—'}% · подтверждена: {complex.readinessConfirmed ?? '—'}%</dd><dt>Правовое основание</dt><dd>{complex.legalBasis.status === 'verified' ? 'Подтверждено' : complex.legalBasis.status === 'absent-verified' ? 'Отсутствие проверено' : 'Нужна проверка'}</dd><dt>Источник / дата</dt><dd>{complex.legalBasis.source} · {complex.legalBasis.checkedAt}</dd></dl><p class="muted mt-4">{complex.note}</p></section>
  <section class="panel"><h2>Факторы риска</h2>{#each codes as c}{@const f = complex.factors.find(f => f.code === c)}<div class="factor-row"><span><b>{c}</b> {FACTOR_META[c].title}<small>{f?.status === 'confirmed' ? 'Подтверждён' : f?.status === 'rejected' ? 'Отклонён' : f?.status === 'hypothesis' ? 'Гипотеза' : 'Нужна проверка'} · {f?.evidence?.source || FACTOR_META[c].hint}</small></span><b>+{WEIGHTS[c]}</b></div>{/each}</section></div>
  {#if r1Revoked || r5Revoked}<section class="panel mb-6"><h2>Снятые решения</h2>
    {#if r1Revoked}<p><b>R1</b> — решение снято: материалы legalBasis изменились (type/status/source/checkedAt/reviewText). Требуется повторное подтверждение; баллы начисляются только после нового confirm.</p>{/if}
    {#if r5Revoked}<p><b>R5</b> — решение снято: наблюдения готовности изменились (новое значение, источник или разрыв &lt;20 п.п.). Требуется повторное подтверждение; баллы начисляются только после нового confirm.</p>{/if}
    {#each autoNotes.slice(0, 3) as n}<p class="muted text-xs">{new Date(n.at).toLocaleString('ru-RU')} · {n.comment}</p>{/each}
  </section>{/if}
  <form class="panel mb-6 space-y-4" onsubmit={e => { e.preventDefault(); void submitFactor(); }}>
    <h2>Решение по фактору</h2><div class="form-grid"><label>Фактор<select bind:value={code}>{#each codes as c}<option value={c}>{c} · {FACTOR_META[c].title}</option>{/each}</select></label><label>Решение<select bind:value={status}><option value="confirmed">Подтвердить</option><option value="rejected">Отклонить</option><option value="needs-verification">На проверку</option></select></label><label>Источник доказательства<input required bind:value={source}/></label><label>Дата материала<input type="date" required bind:value={evDate}/></label></div>
    {#if code === 'R1'}<p class="muted text-xs">R1: основание сейчас — {complex.legalBasis.type}/{complex.legalBasis.status}. Нужны absent/absent-verified с источником, датой и описанием сверки + текст сверки ниже.</p><label>Содержание правовой сверки (legal-review)<textarea required bind:value={evText}></textarea></label>{/if}
    {#if code === 'R2' || code === 'R3'}<div class="form-grid"><label>Публикация этого ЖК<select required bind:value={adId}><option value="">— выберите публикацию —</option>{#each ads as ad}<option value={ad.id}>{ad.platform} · {ad.date} · {ad.text.slice(0,60)}</option>{/each}</select></label><label>Дословная цитата из текста публикации<input required bind:value={quote}/></label></div>{#if code === 'R3'}<label>Материал, что объект не введён (источник/дата выше + текст)<textarea required bind:value={evText}></textarea></label>{/if}{/if}
    {#if code === 'R4'}<label>Текст коллективного обращения о привлечении средств<textarea required bind:value={evText}></textarea></label>{/if}
    {#if code === 'R5'}<p class="muted text-xs">R5: заявлено {complex.readinessClaimed ?? '—'}% · подтверждено {complex.readinessConfirmed ?? '—'}% · разрыв {r5gap ?? '—'} п.п. Подтверждение — только отдельным решением при разрыве ≥20 и источнике/дате обоих наблюдений.</p>{/if}
    {#if code === 'R6'}<label>Датированный факт: заявленный срок или период простоя + объяснение значимости<textarea required bind:value={evText}></textarea></label>{/if}
    <label>Комментарий аналитика (обязателен)<input required bind:value={comment}/></label><button class="primary" disabled={busy || !comment.trim()}>Сохранить решение</button>
  </form>
  <section class="panel mb-6 space-y-4"><h2>Площадка · фото и документы</h2><div class="form-grid"><label>Дата наблюдения<input type="date" bind:value={observationDate}/></label><label>Подтверждённая готовность, %<input type="number" min="0" max="100" bind:value={ready}/></label><label>Источник наблюдения<input bind:value={observationSource}/></label><label>Подпись файла<input bind:value={note}/></label></div><label>Фото / видео / PDF<input type="file" accept="image/png,image/jpeg,image/webp,video/mp4,application/pdf" bind:files/></label><div class="actions"><button disabled={busy} onclick={upload}>Сохранить файл</button><button disabled={busy || ready == null || !observationSource.trim()} onclick={() => act({ type: 'readiness', zkId: complex.id, value: ready!, source: observationSource, date: observationDate })}>Зафиксировать готовность</button></div><p class="muted text-xs">Разрыв ≥20 п.п. создаёт гипотезу R5. Подтверждение выполняется отдельно.</p></section>
  <div class="cards mb-6">{#each workspace.media.filter(m => m.zkId === complex.id) as media (media.id)}<MediaCard {media}/>{/each}</div>
  <section class="panel mb-6"><h2>Публикации · {ads.length}</h2>{#each ads as ad}
    {@const adSrc = detectPlatform({ url: ad.url, platform: ad.platform })}
    <article class="ad-item" id={ad.id}><p class="eyebrow">{adSrc.label} · определён {viaLabel(adSrc.via)} · Публикация: {ad.date ?? 'не указана'} · Фиксация: {ad.captureAt}</p><p>{ad.text}</p>{#if safeUrl(ad.url)}<a href={safeUrl(ad.url)} target="_blank" rel="noopener noreferrer">Источник ↗</a>{/if}
    {#if ad.sightings?.length}<ul>{#each ad.sightings as s}<li>Фиксация: {s.source} · {s.date ?? 'дата неизвестна'} · {s.captureAt}{#if s.url && safeUrl(s.url)} <a href={safeUrl(s.url)} target="_blank" rel="noopener noreferrer">ссылка ↗</a>{/if}</li>{/each}</ul>{/if}</article>{/each}</section>
  <section class="panel"><h2>Источники</h2>{#each complex.sources as s}<p>{#if safeUrl(s.url)}<a href={safeUrl(s.url)} target="_blank" rel="noopener noreferrer">{s.title}</a>{:else}{s.title}{/if} · {s.date}</p>{/each}</section>
{/if}
{#if !signal}<section class="panel mt-6"><h2>История</h2>{#each workspace.audit.filter(e => e.zkId === complex.id) as event}<div class="timeline-row"><span>{new Date(event.at).toLocaleString('ru-RU')}</span><p><b>{event.reviewer} · {event.action}</b><br/>{event.comment}</p></div>{/each}{#each complex.events as event}<div class="timeline-row"><span>{event.date}</span><p>{event.text}</p></div>{/each}</section>

{/if}
