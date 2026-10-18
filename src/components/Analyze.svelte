<script lang="ts">
  import { untrack } from 'svelte';
  import type { Ad, Analysis, AppState, Hypothesis } from '../lib/types';
  import type { Command } from '../lib/domain';
  import { analyze } from '../lib/analysis';
  import { parseAdText, parseCsvAds, detectPlatform, dedupeKey } from '../lib/parser';
  import { uploadFile, removeFile } from '../lib/repository';
  let { workspace, zkId = '', initialText = '', commit }: { workspace: AppState; zkId?: string; initialText?: string; commit: (command: Command) => Promise<void> } = $props();
  let selected = $state(untrack(() => zkId || workspace.complexes[0]?.id || ''));
  let text = $state(untrack(() => initialText)); let url = $state(''); let account = $state(''); let platform = $state('');
  let date = $state(new Date().toISOString().slice(0,10)); let csv = $state('');
  let csvRows = $state<ReturnType<typeof parseCsvAds> | null>(null);
  let result = $state<Analysis | null>(null); let analyzedText = $state(''); let analyzedZk = $state('');
  let error = $state(''); let busy = $state(false); let saved = $state(false); let files = $state<FileList>();
  let generation = 0;
  const parsed = $derived(analyzedText ? parseAdText(analyzedText) : null);
  const source = $derived(detectPlatform({ url, platform }));
  const stale = $derived(text !== analyzedText || selected !== analyzedZk);
  function preset(id: string) { selected = id; text = workspace.ads.find(a => a.zkId === id)?.text || ''; result = null; saved = false; }
  async function run() {
    error = ''; result = null; saved = false; busy = true; const request = ++generation;
    const input = text; const object = selected;
    try { const output = await analyze(input, workspace.complexes.find(z => z.id === object)?.name || ''); if (generation === request) { result = output; analyzedText = input; analyzedZk = object; } }
    catch (e) { error = e instanceof Error ? e.message : String(e); } finally { if (generation === request) busy = false; }
  }
  async function save(decision: 'saved' | 'confirmed' | 'rejected', hypothesis?: Hypothesis) {
    busy = true; error = '';
    try {
      if (stale) throw new Error('Текст или объект изменён. Запустите анализ повторно.');
      const ad: Ad = { id: `AD-${crypto.randomUUID()}`, zkId: selected, text, url, account, date, platform: source.label, captureAt: new Date().toISOString(), analysis: result! };
      await commit({ type: 'ad', ad, decision, hypothesis, comment: hypothesis?.reason || 'Ручная проверка публикации' });
      saved = true;
      if (files?.[0]) {
        const media = await uploadFile(files[0], selected);
        media.note = `Источник публикации ${ad.id}`;
        try { await commit({ type: 'media', media }); } catch (e) { await removeFile(media.path); throw e; }
      }
    } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { busy = false; }
  }
  function previewCsv() { try { csvRows = parseCsvAds(csv); error = ''; } catch (e) { error = String(e); } }
  function selectRow(row: NonNullable<typeof csvRows>['rows'][number]) {
    text = row.text; url = row.url; platform = row.platform; account = row.account;
    if (/^\d{4}-\d{2}-\d{2}$/.test(row.date)) date = row.date;
    const object = workspace.complexes.find(z => z.id === row.zkHint || z.name === row.zkHint); if (object) selected = object.id;
    result = null; saved = false;
  }
</script>
<div class="page-heading"><div><p class="eyebrow">ПУБЛИКАЦИЯ → ГИПОТЕЗА → РЕШЕНИЕ</p><h1>Проверка объявления</h1></div></div>
<p class="muted mb-6">Вставьте текст и зафиксируйте источник. Анализ предлагает гипотезы; факторы подтверждает аналитик.</p>
<div class="two-col">
  <form class="panel space-y-4" onsubmit={e => { e.preventDefault(); void run(); }}>
    <h2>01 / Исходные данные</h2>
    <div class="actions">{#each ['SQ-001', 'SQ-002', 'SQ-003'] as id, i}<button type="button" class="small" onclick={() => preset(id)}>Пример {String.fromCharCode(65 + i)}</button>{/each}</div>
    <label>Объект<select required bind:value={selected}>{#each workspace.complexes as z}<option value={z.id}>{z.name} · {z.id}</option>{/each}</select></label>
    <label>Текст объявления<textarea required maxlength="20000" rows="8" bind:value={text} placeholder="Бронь квартиры — 500 000 тенге…"></textarea></label>
    <div class="form-grid"><label>Ссылка на источник<input type="url" bind:value={url} placeholder="https://"/></label><label>Площадка<input bind:value={platform} placeholder="Krisha.kz, Telegram…"/></label><label>Аккаунт<input bind:value={account}/></label><label>Дата публикации<input type="date" required bind:value={date}/></label></div>
    <p class="muted text-xs">Источник: {source.label}. Система не загружает страницы по ссылке.</p>
    <label>Скриншот / документ<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" bind:files/></label>
    <button class="primary" disabled={busy || !selected}>{busy ? 'Обработка…' : 'Проанализировать'}</button>
  </form>
  <section class="panel space-y-4" aria-live="polite">
    <h2>02 / Анализ и решение</h2>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if result}
      <span class="badge">{result.engine}</span>
      {#if stale}<p class="notice">Ввод изменён — повторите анализ перед сохранением.</p>{/if}
      {#each result.hypotheses as h}<article class="hypothesis"><b>{h.code} · гипотеза</b><blockquote>«{h.quote}»</blockquote><p>{h.reason}</p><div class="actions"><button disabled={busy || saved || stale} onclick={() => save('confirmed', h)}>Подтвердить {h.code}</button><button disabled={busy || saved || stale} onclick={() => save('rejected', h)}>Отклонить гипотезу</button></div></article>{/each}
      {#if !result.hypotheses.length}<p>Платёжных признаков не обнаружено. Это не подтверждает безопасность объекта.</p>{/if}
      {#if parsed?.entities.length}<div class="table-scroll"><table><thead><tr><th>Сущность</th><th>Значение</th><th>Цитата</th></tr></thead><tbody>{#each parsed.entities as entity}<tr><td>{entity.label}</td><td>{entity.value}</td><td>«{entity.quote}»</td></tr>{/each}</tbody></table></div>{/if}
      <button disabled={busy || saved || stale} onclick={() => save('saved')}>Сохранить без подтверждения</button>
      {#if saved}<p class="success" role="status">Публикация и решение сохранены.</p>{/if}
    {:else}<p class="muted">Здесь появятся дословные цитаты, извлечённые данные и гипотезы.</p>{/if}
  </section>
</div>
<details class="panel mt-6"><summary>Импорт из CSV</summary><p class="muted my-3">Заголовки: text/текст, url/ссылка, platform/площадка, account/аккаунт, date/дата, zk/жк. Каждую строку проверяет человек.</p><label>CSV<textarea rows="4" bind:value={csv}></textarea></label><button onclick={previewCsv}>Предпросмотр CSV</button>
  {#if csvRows}{#each csvRows.errors as e}<p class="error">{e}</p>{/each}{#each csvRows.rows as row}<div class="csv-row"><span>{row.text.slice(0,100)} {workspace.ads.some(a => dedupeKey(a) === dedupeKey(row)) ? '· ДУБЛЬ' : ''}</span><button onclick={() => selectRow(row)}>Проверить строку</button></div>{/each}{/if}
</details>
