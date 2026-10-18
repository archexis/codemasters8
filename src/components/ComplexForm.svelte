<script lang="ts">
  import { untrack } from 'svelte';
  import type { Complex } from '../lib/types';
  let { value, onsave, oncancel }: { value?: Complex; onsave: (z: Complex) => Promise<void>; oncancel: () => void } = $props();
  let form = $state<Complex>(untrack(() => structuredClone(value ? $state.snapshot(value) : { id: `SQ-${crypto.randomUUID().slice(0, 8)}`, name: '', city: 'Өскемен', address: '', developer: '', bin: null, lat: null, lng: null, origin: 'manual', stage: '', readinessClaimed: null, readinessConfirmed: null, readinessSources: [], legalBasis: { type: 'unknown', status: 'unknown', source: '', checkedAt: new Date().toISOString().slice(0,10) }, note: '', factors: [], events: [], sources: [] })));
  let busy = $state(false); let error = $state('');
  async function submit(e: SubmitEvent) {
    e.preventDefault(); busy = true; error = '';
    try { if (form.legalBasis.status !== 'unknown' && !form.legalBasis.source.trim()) throw new Error('Укажите источник проверки основания'); await onsave($state.snapshot(form)); } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { busy = false; }
  }
</script>
<form class="panel space-y-4" onsubmit={submit}>
  <h2>{value ? 'Редактировать объект' : 'Новый объект'}</h2>
  <div class="form-grid">
    <label>Название<input required bind:value={form.name}/></label><label>Адрес<input required bind:value={form.address}/></label>
    <label>Застройщик<input bind:value={form.developer}/></label><label>БИН<input pattern="[0-9]{12}" bind:value={form.bin}/></label>
    <label>Широта<input type="number" min="-90" max="90" step="any" bind:value={form.lat}/></label><label>Долгота<input type="number" min="-180" max="180" step="any" bind:value={form.lng}/></label>
    <label>Стадия<input bind:value={form.stage}/></label><label>Заявленная готовность, %<input type="number" min="0" max="100" bind:value={form.readinessClaimed}/></label>
    <label>Правовое основание<select bind:value={form.legalBasis.status}><option value="unknown">Не проверено</option><option value="verified">Основание подтверждено</option><option value="absent-verified">Отсутствие проверено</option></select></label>
    <label>Дата сверки<input required type="date" bind:value={form.legalBasis.checkedAt}/></label>
  </div>
  <label>Источник проверки основания<input bind:value={form.legalBasis.source}/></label><label>Примечание<textarea bind:value={form.note}></textarea></label>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <div class="actions"><button class="primary" disabled={busy}>Сохранить объект</button><button type="button" onclick={oncancel}>Отмена</button></div>
</form>
