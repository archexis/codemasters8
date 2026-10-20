<script lang="ts">
  import { tick } from 'svelte';
  import type { EvidenceArtifact, ExtractedClaim, FactAssertion } from '../lib/types';

  let { claim, source, fact, active, busy, selected, error = '', onselect, onoriginal, onreview }: {
    claim: ExtractedClaim;
    source?: EvidenceArtifact;
    fact?: FactAssertion;
    active: boolean;
    busy: boolean;
    selected: boolean;
    error?: string;
    onselect: (selected: boolean) => void;
    onoriginal: () => void;
    onreview: (status: 'verified' | 'rejected', comment: string, date: string, extra: string) => Promise<boolean>;
  } = $props();

  let comment = $state('');
  let date = $state('');
  let extra = $state('');
  let feedback = $state<HTMLParagraphElement>();

  $effect(() => {
    if (error) void tick().then(() => {
      feedback?.focus({ preventScroll: true });
      feedback?.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
  });

  async function review(status: 'verified' | 'rejected') {
    if (await onreview(status, comment, date, extra)) comment = '';
  }
</script>

<article class="hypothesis mb-4" aria-label={`Проверка ${claim.code}: ${claim.quote}`}>
  {#if active}
    <label class="claim-selection">
      <input type="checkbox" checked={selected} disabled={busy}
        aria-label={`Выбрать факт ${claim.code}: ${claim.quote}`}
        onchange={e => onselect(e.currentTarget.checked)} />
      Выбрать факт {claim.code}
    </label>
  {/if}
  <b>{claim.code} · {fact?.status === 'verified' ? 'Факт проверен' : fact?.status === 'rejected' ? 'Факт отклонён' : 'Кандидат'}</b>
  <blockquote>{claim.quote}</blockquote>
  <button class="small" onclick={onoriginal}>Показать оригинал</button>

  {#if active}
    {#if (claim.code === 'R2' || claim.code === 'R3') && (source?.kind !== 'publication' || !source?.adId)}
      <p class="notice mt-3">Для проверки нужна связанная публикация. Оформите рекламный материал как публикацию, затем подготовьте материалы дела и проверьте нового кандидата.</p>
      <a class="button small mt-3" href={`#/publications?add=1&complex=${claim.complexId}&text=${encodeURIComponent(source?.text ?? '')}`}>Оформить публикацию из материала</a>
    {/if}
    <label class="mt-4">Обоснование проверки факта
      <textarea rows="2" placeholder="Почему подтверждаете или отклоняете этот факт" bind:value={comment} disabled={busy}></textarea>
    </label>
    <details class="my-3" open={!source?.date || claim.code === 'R3'}>
      <summary>Дата и дополнительные сведения</summary>
      <label class="mt-3">Дата доказательства
        <input type="date" bind:value={date} disabled={busy} />
      </label>
      {#if source?.date}<p class="muted text-xs">Если дату не менять, используется дата источника: {source.date}.</p>{/if}
      <label class="mt-3">Дополнительный датированный материал (для R3: состояние до ввода)
        <textarea rows="2" bind:value={extra} disabled={busy}></textarea>
      </label>
    </details>
    <div class="actions mt-3">
      <button class="primary" disabled={busy || !comment.trim()} onclick={() => review('verified')}>Подтвердить факт {claim.code}</button>
      <button disabled={busy || !comment.trim()} onclick={() => review('rejected')}>Отклонить факт</button>
    </div>
    {#if error}<p class="error mt-3" role="alert" tabindex="-1" bind:this={feedback}>{error}</p>{/if}
  {/if}

  {#if fact}<p class="text-xs mt-3">{fact.actor} · {fact.at} · {fact.comment}</p>{/if}
  <details class="mt-3">
    <summary>Сведения о кандидате</summary>
    <p class="mt-2">{claim.reason}</p>
    <p class="muted text-xs mt-2">Триаж AI: {claim.triage === 'accepted' ? 'Гипотеза принята' : claim.triage === 'rejected' ? 'Гипотеза отклонена' : 'Не оценена / ручное извлечение'}</p>
    {#if claim.runId}<p class="muted text-xs">Запуск анализа: {claim.runId}</p>{/if}
  </details>
</article>

<style>
  .claim-selection { display:flex;flex-direction:row;align-items:center;gap:.5rem;margin-bottom:.75rem; }
  .claim-selection input { width:auto;flex:none; }
</style>
