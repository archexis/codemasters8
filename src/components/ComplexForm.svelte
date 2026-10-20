<script lang="ts">
  import { untrack, onMount } from 'svelte';
  import { registerNavigationGuard } from '../lib/navigation-guard';
  import type { Complex, LegalBasisType } from '../lib/types';
  let { value, onsave, oncancel }: { value?: Complex; onsave: (z: Complex) => Promise<void>; oncancel: () => void } = $props();
  let form = $state<Complex>(untrack(() => structuredClone(value ? $state.snapshot(value) : { id: `SQ-${crypto.randomUUID().slice(0, 8)}`, name: '', city: 'Өскемен', address: '', developer: '', bin: null, lat: null, lng: null, origin: 'manual', stage: '', readinessClaimed: null, readinessConfirmed: null, readinessSources: [], readinessClaimedSource: null, legalBasis: { type: 'unknown', status: 'unknown', source: '', checkedAt: '', reviewText: '' }, note: '', factors: [], events: [], sources: [] })));
  // C1. type/status выбираются только согласованной парой — одним селектом варианта.
  const PAIR: Record<LegalBasisType, { status: 'unknown' | 'absent-verified' | 'verified'; label: string }> = {
    'unknown': { status: 'unknown', label: 'Не проверено' },
    'absent': { status: 'absent-verified', label: 'Отсутствие основания — проверено' },
    'guarantee': { status: 'verified', label: 'Гарантия Единого оператора — подтверждена' },
    'mio-permit': { status: 'verified', label: 'Разрешение МИО — подтверждено' },
  };
  let variant = $state<LegalBasisType>(untrack(() => form.legalBasis.type));
  let claimedSourceText = $state(untrack(() => form.readinessClaimedSource?.source ?? ''));
  let claimedDate = $state(untrack(() => form.readinessClaimedSource?.date ?? new Date().toISOString().slice(0,10)));
  let busy = $state(false); let error = $state('');
  const initialDraft = untrack(() => JSON.stringify([form, variant, claimedSourceText, claimedDate]));
  const dirty = $derived(JSON.stringify([form, variant, claimedSourceText, claimedDate]) !== initialDraft);
  onMount(() => {
    const scope = (hash: string) => {
      const [path, query] = hash.split('?');
      return `${path}:${new URLSearchParams(query).get('phase') ?? ''}`;
    };
    const initialScope = scope(location.hash);
    const unload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    const unregister = registerNavigationGuard(next => !dirty || scope(next) === initialScope || window.confirm('Есть несохранённые сведения объекта. Уйти и удалить черновик?'));
    window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('beforeunload', unload); unregister(); };
  });
  async function submit(e: SubmitEvent) {
    e.preventDefault(); busy = true; error = '';
    try {
      if (variant !== 'unknown' && !form.legalBasis.source.trim()) throw new Error('Укажите источник проверки основания');
      const snapshot = $state.snapshot(form);
      await onsave({ ...snapshot,
        legalBasis: { ...snapshot.legalBasis, type: variant, status: PAIR[variant].status },
        readinessClaimedSource: snapshot.readinessClaimed == null ? null : { value: snapshot.readinessClaimed, source: claimedSourceText, date: claimedDate },
      });
    } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { busy = false; }
  }
</script>
<form class="panel space-y-4" onsubmit={submit}>
  <h2>{value ? 'Редактировать объект' : 'Новый объект'}</h2>
  <div class="form-grid">
    <label>Название<input required bind:value={form.name}/></label><label>Адрес<input required bind:value={form.address}/></label>
    <label>Застройщик<input bind:value={form.developer}/></label><label>БИН<input pattern={'[0-9]{12}'} bind:value={form.bin}/></label>
    <label>Широта<input type="number" min="-90" max="90" step="any" bind:value={form.lat}/></label><label>Долгота<input type="number" min="-180" max="180" step="any" bind:value={form.lng}/></label>
    <label>Стадия<input bind:value={form.stage}/></label><label>Заявленная готовность, %<input type="number" min="0" max="100" bind:value={form.readinessClaimed}/></label>
  </div>
  {#if form.readinessClaimed != null}
  <div class="form-grid">
    <label>Источник заявленной готовности<input required bind:value={claimedSourceText} placeholder="Откуда взято значение"/></label>
    <label>Дата заявленного значения<input required type="date" bind:value={claimedDate}/></label>
  </div>
  {:else}<p class="muted text-xs">Заявленная готовность не указана — происхождение фиксировать нечего.</p>{/if}
  <div class="form-grid">
    <label>Правовое основание<select bind:value={variant}>
      <option value="unknown">{PAIR['unknown'].label}</option>
      <option value="absent">{PAIR['absent'].label}</option>
      <option value="guarantee">{PAIR['guarantee'].label}</option>
      <option value="mio-permit">{PAIR['mio-permit'].label}</option>
    </select></label>
    <label>Дата сверки<input required={variant!=='unknown'} type="date" bind:value={form.legalBasis.checkedAt}/></label>
  </div>
  <p class="muted text-xs">Пара основание/статус: {variant} / {PAIR[variant].status}. Варианты продукта, не исчерпывающая юридическая классификация.</p>
  <label>Источник проверки основания<input bind:value={form.legalBasis.source} required={variant !== 'unknown'} placeholder="Проверяемая ссылка или название документа с сохранённым содержанием"/></label>
  <label>Описание сверки и её результат<textarea bind:value={form.legalBasis.reviewText} required={variant !== 'unknown'} placeholder="Что сверено, где, с каким результатом"></textarea></label>
  <label>Примечание<textarea bind:value={form.note}></textarea></label>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <div class="actions"><button class="primary" disabled={busy}>Сохранить объект</button><button type="button" onclick={oncancel}>Отмена</button></div>
</form>
