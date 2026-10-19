<script lang="ts">
  import { untrack, onDestroy, onMount } from 'svelte';
  import type { Ad, Analysis, AppState, Hypothesis, Media } from '../lib/types';
  import type { Command } from '../lib/domain';
  import { analyze, canonicalRunInput, newRunId, type AiRunInput } from '../lib/analysis';
  import { parseAdText, parseCsvAds, resolveCsvHint, detectPlatform, adDedupeKey } from '../lib/parser';
  import { isCalendarDate } from '../lib/validation';
  import type { CsvParseResult, CsvRow } from '../lib/types';
  import {supabase} from '../lib/supabase';
  import {extractImage} from '../lib/workspace-api';
  import {
    uploadFile, unstageFileForCommand, stageFileForCommand, removeStagedFile, recordCleanupRetry,
    withCommandId, attachStagedMedia, newCommandId, getSessionGeneration, onSessionChange,
    StaleConflictError, SessionSupersededError, UnknownCommitResultError,
  } from '../lib/repository';
  let { workspace, zkId = '', initialText = '', commit }: { workspace: AppState; zkId?: string; initialText?: string; commit: (command: Command) => Promise<void> } = $props();
  let selected = $state(untrack(() => zkId || workspace.complexes[0]?.id || ''));
  let text = $state(untrack(() => initialText)); let url = $state(''); let account = $state(''); let platform = $state('');
  let date = $state(''); let csv = $state('');
 let csvRows = $state<CsvParseResult | null>(null);
 let csvActiveId = $state<string | null>(null);
 let csvConfirmed = $state(false);
  let result = $state<Analysis | null>(null); let analyzedText = $state(''); let analyzedZk = $state('');
  let error = $state(''); let busy = $state(false); let saved = $state(false); let files = $state<FileList>();
  let generation = 0;
  let controller: AbortController | null = null;
  let snapshot = $state<AiRunInput | null>(null);
  let comments = $state<Record<string,string>>({});
  let reviewed = $state<Record<string,string>>({});
  let publishedAdId = $state('');
  let phaseId = $state('');
  let saving=$state(false);
  $effect(()=>{selected;phaseId='';});
  const phases = $derived((workspace.phases ?? []).filter(p=>p.complexId===selected));
  interface ReviewIntent {
    claimId:string; claimCommand:Command; claimCommandId:string; claimDone:boolean;
    reviewCommand:Command; reviewCommandId:string; reviewDone:boolean;
  }
  interface MaterialIntent {
    key:string; session:number; adId:string; existing:boolean; adCommandId:string; adCommand:Command|null; adDone:boolean;
    mediaId:string; mediaCommandId:string; media:Media|null; mediaDone:boolean;
    artifactId:string; artifactCommandId:string; artifactCommand:Command|null; artifactDone:boolean;
    reviews:Map<string,ReviewIntent>;
  }
  const materialIntents=new Map<string,MaterialIntent>();
  function materialKey() { return JSON.stringify([selected,phaseId,text,url,account,date,source.label,currentFileSig()]); }
  $effect(()=>{materialKey();saved=false;publishedAdId='';reviewed={};});
  async function saveMaterial(hypothesis?:Hypothesis, decision:'accepted'|'rejected'='accepted') {
    if(saving) return;
    error=''; busy=true; saving=true;
    const session=getSessionGeneration();
    let active:MaterialIntent|undefined;
    const assertCurrent=()=>{
      if(session!==getSessionGeneration()) throw new SessionSupersededError();
      if(active && materialKey()!==active.key) throw new Error('Ввод изменён во время сохранения. Верните исходные поля для повтора или сохраните новый материал.');
    };
    try {
      if(!text.trim() || !selected) throw new Error('Укажите текст и ЖК.');
      if(date && !isCalendarDate(date)) throw new Error('Укажите реальную дату публикации или оставьте поле пустым.');
      if(hypothesis && (!result || stale || !text.includes(hypothesis.quote))) throw new Error('Нужна точная цитата из актуального оригинала.');
      const comment=hypothesis ? comments[hypothesis.id ?? hypothesis.code]?.trim() : 'Ручное сохранение источника';
      if(!comment) throw new Error('Укажите обоснование триажа.');
      const key=materialKey();
      active=materialIntents.get(key);
      if(!active) {
        const existing=workspace.ads.find(a=>adDedupeKey(a.zkId,a.text)===adDedupeKey(selected,text));
        active={key,session,adId:existing?.id ?? `AD-${newCommandId()}`,existing:!!existing,adCommandId:newCommandId(),adCommand:null,adDone:!!existing,mediaId:newCommandId(),mediaCommandId:newCommandId(),media:null,mediaDone:false,artifactId:`ART-${newCommandId()}`,artifactCommandId:newCommandId(),artifactCommand:null,artifactDone:false,reviews:new Map()};
        // Reuse the immutable original, including its exact text and publication date.
        const original=existing ? $state.snapshot(existing) : {id:active.adId,zkId:selected,text,url,account,date:date || null,platform:source.label,captureAt:new Date().toISOString(),...(result && !stale ? {analysis:$state.snapshot(result)} : {})};
        if(hypothesis && !original.text.includes(hypothesis.quote)) throw new Error('Текст уже сохранён в иной записи. Откройте исходную публикацию и повторите анализ её точного текста.');
        active.adCommand={type:'ad',ad:original,decision:'saved',comment:'Сохранение первоисточника без подтверждения факторов'};
        active.artifactCommand={type:'artifact.register',artifact:{id:active.artifactId,complexId:selected,...(phaseId ? {phaseId} : {}),kind:'publication',source:original.platform || 'Ручной ввод',text:original.text,...(original.date ? {date:original.date} : {}),adId:original.id,...(original.url ? {url:original.url} : {})}};
        const priorArtifact=workspace.artifacts?.find(a=>a.adId===original.id && a.phaseId===(phaseId || undefined) && (!files?.[0] || !!a.mediaId));
        if(priorArtifact && !files?.[0]) {active.artifactId=priorArtifact.id;active.artifactDone=true;}
        materialIntents.set(key,active);
      }
      if(active.session!==session) throw new SessionSupersededError();
      const file=files?.[0];
      if(file && !active.media) {
        active.media=await uploadFile(file,selected,{mediaId:active.mediaId});
        const fileCommandId=active.existing ? active.mediaCommandId : active.adCommandId;
        stageFileForCommand(fileCommandId,active.media.path);
        assertCurrent();
        if(active.adCommand?.type==='ad' && !active.existing) active.adCommand=attachStagedMedia(active.adCommand,active.media);
        if(active.artifactCommand?.type==='artifact.register') active.artifactCommand.artifact.mediaId=active.media.id;
      }
      assertCurrent();
      if(!active.adDone) {
        await commit(withCommandId(active.adCommand!,active.adCommandId));
        active.adDone=true;
        if(active.media) {active.mediaDone=true;unstageFileForCommand(active.adCommandId,active.media.path);}
        assertCurrent();
      }
      if(active.existing && active.media && !active.mediaDone) {
        await commit(withCommandId({type:'media',media:active.media},active.mediaCommandId));
        active.mediaDone=true;unstageFileForCommand(active.mediaCommandId,active.media.path);
        assertCurrent();
      }
      if(!active.artifactDone) {
        await commit(withCommandId(active.artifactCommand!,active.artifactCommandId));
        active.artifactDone=true;assertCurrent();
      }
      if(hypothesis) {
        const reviewKey=JSON.stringify([hypothesis.id ?? '',hypothesis.code,hypothesis.quote,result?.runId ?? '']);
        let review=active.reviews.get(reviewKey);
        const prior=workspace.claims?.find(c=>c.artifactId===active!.artifactId && c.code===hypothesis.code && c.quote===hypothesis.quote && c.runId===result?.runId);
        if(!review) {
          const claimId=prior?.id ?? `CL-${newCommandId()}`;
          review={claimId,claimCommandId:newCommandId(),claimDone:!!prior,claimCommand:{type:'claim.propose',claim:{id:claimId,complexId:selected,...(phaseId ? {phaseId} : {}),artifactId:active.artifactId,code:hypothesis.code,quote:hypothesis.quote,reason:hypothesis.reason,...(result?.runId ? {runId:result.runId,hypothesisId:hypothesis.id} : {})}},reviewCommandId:newCommandId(),reviewDone:false,reviewCommand:{type:'ai.review',claimId,decision,comment}};
          active.reviews.set(reviewKey,review);
        } else if(review.reviewCommand.type==='ai.review' && (review.reviewCommand.decision!==decision || review.reviewCommand.comment!==comment)) {
          if(!review.reviewDone) throw new UnknownCommitResultError('Сначала повторите прежний триаж с тем же обоснованием: его подтверждение ещё не получено.',review.reviewCommandId);
          review.reviewCommand={type:'ai.review',claimId:review.claimId,decision,comment};review.reviewCommandId=newCommandId();review.reviewDone=false;
        }
        if(!review.claimDone) {await commit(withCommandId(review.claimCommand,review.claimCommandId));review.claimDone=true;assertCurrent();}
        if(!review.reviewDone) {await commit(withCommandId(review.reviewCommand,review.reviewCommandId));review.reviewDone=true;assertCurrent();}
        reviewed={...reviewed,[hypothesis.id ?? hypothesis.code]:decision};
      }
      assertCurrent();publishedAdId=active.adId;saved=true;
    } catch(e) {
      if(session!==getSessionGeneration()) return;
      const unknown=e instanceof StaleConflictError || e instanceof UnknownCommitResultError || e instanceof SessionSupersededError;
      error=e instanceof Error ? e.message : String(e);
      // Acknowledged media stays attached even when a later workflow step fails.
      if(!unknown && active?.media && !active.mediaDone) {
        const failedPath=active.media.path;
        try {await removeStagedFile(failedPath,active.existing ? active.mediaCommandId : active.adCommandId);active.media=null;active.adCommand=null;materialIntents.delete(active.key);}
        catch(cleanupError) {recordCleanupRetry(failedPath);error+=` Очистка файла будет повторена: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;}
      }
    } finally {if(session===getSessionGeneration()) {busy=false;saving=false;}}
  }
  function cancelRun() { generation++; controller?.abort(); controller=null; busy=false; }
  onDestroy(cancelRun);
  onMount(()=>onSessionChange(()=>{cancelRun(); result=null; snapshot=null; materialIntents.clear(); saving=false; publishedAdId='';error='';saved=false;comments={};reviewed={};text='';url='';account='';platform='';date='';files=undefined;selected='';phaseId='';csv='';csvRows=null;csvActiveId=null;csvConfirmed=false;}));
  async function ocrImage(){const file=files?.[0];if(!file)return;const session=getSessionGeneration();const signature=currentFileSig();busy=true;error='';try{const output=await extractImage(file);if(session!==getSessionGeneration()||signature!==currentFileSig())return;text=output.text;result=null;snapshot=null;saved=false;if(!text.trim())throw new Error('Текст не распознан. Введите содержание вручную.');}catch(e){if(session===getSessionGeneration())error=e instanceof Error?e.message:String(e);}finally{if(session===getSessionGeneration())busy=false;}}
  function currentInput():AiRunInput {
    const file=files?.[0];
    return {text,zkId:selected,url,account,date:date.trim() || null,platform:source.label,...(file ? {attachments:[{name:file.name,size:file.size,type:file.type,lastModified:file.lastModified}]} : {})};
  }

  function currentFileSig(): string {
    const f = files?.[0];
    return f ? `${f.name}:${f.size}:${f.lastModified}` : '';
  }
  const parsed = $derived(analyzedText ? parseAdText(analyzedText) : null);
  const source = $derived(detectPlatform({ url, platform }));
  /**
   * S3.4 (C4). Способ определения площадки — отдельно от её названия:
   * ручная подсказка против URL показывает hint/manual, а не проверенный домен.
   */
  function viaLabel(via: string): string {
    return via === 'url' ? 'по ссылке' : via === 'hint' ? 'по подсказке' : via === 'manual' ? 'вручную' : 'не указан';
  }
  /**
   * S3.4 (C4). Статус повтора для preview — строго в пределах ЖК строки
   * (единый ключ adDedupeKey): точная подсказка исхода — отказ с ID либо
   * новая фиксация без второго ad. Preview-зеркало правила domain ad-ветки.
   */
  function findCsvDupe(row: CsvRow) {
    if (!row.mappedZkId) return undefined;
    return workspace.ads.find((a) => a.zkId === row.mappedZkId && adDedupeKey(a.zkId, a.text) === adDedupeKey(row.mappedZkId as string, row.text));
  }
  function csvRowDupeNote(row: CsvRow): string | null {
    const dupe = findCsvDupe(row);
    if (!dupe) return null;
    const recorded = [{ source: dupe.platform, date: dupe.date, url: dupe.url }, ...(dupe.sightings ?? [])];
    const seen = recorded.some((r) =>
      (r.source ?? '') === (row.platform ?? '') &&
      (r.date ?? null) === (row.date ?? null) &&
      (r.url ?? '') === (row.url ?? ''));
    return seen
      ? `Уже сохранена как ${dupe.id} с той же фиксацией — повтор будет отклонён.`
      : `Текст уже сохранён как ${dupe.id} — сохранение добавит новую фиксацию, второго ad не будет.`;
  }
  const stale = $derived(!snapshot || canonicalRunInput(currentInput()) !== canonicalRunInput(snapshot));
  function preset(id: string) { selected = id; text = workspace.ads.find(a => a.zkId === id)?.text || ''; result = null; saved = false; }
  async function run() {
    if(saving) return;
    cancelRun();
    error = ''; result = null; saved = false; reviewed={}; comments={}; publishedAdId=''; busy = true;
    const request = ++generation; const session=getSessionGeneration(); const input=currentInput();
    snapshot=structuredClone(input); controller=new AbortController();
    try {
      const output = await analyze(input,{runId:newRunId(),signal:controller.signal});
      if (generation === request && session===getSessionGeneration()) { result = output; analyzedText = input.text; analyzedZk = input.zkId; }
    } catch (e) { if(generation===request && session===getSessionGeneration()) error=e instanceof Error ? e.message : String(e); }
    finally { if (generation === request && session===getSessionGeneration()) busy = false; }
  }
  /**
   * S3.3 (C4). Построчный CSV: preview → выбор одной валидной строки →
   * явное сопоставление ЖК → сохранение. Подсказка exact-ID даёт
   * предсопоставление, unique-name — предложение, unknown/ambiguous — null;
   * предыдущий выбор не наследуется, подтверждение ЖК обязательно.
   */
  function previewCsv() {
    try {
      const parsed = parseCsvAds(csv);
      const targets = workspace.complexes.map(z => ({ id: z.id, name: z.name }));
      for (const row of parsed.rows) {
        const hint = resolveCsvHint(row.zkHint, targets);
        row.mappedZkId = hint.mappedZkId; row.suggestionId = hint.suggestionId; row.hintKind = hint.kind;
      }
      csvRows = parsed; csvActiveId = null; csvConfirmed = false; error = '';
    } catch (e) { csvRows = null; csvActiveId = null; csvConfirmed = false; error = e instanceof Error ? e.message : String(e); }
  }
  const csvActive = $derived(csvRows?.rows.find(r => r.rowId === csvActiveId) ?? null);
  function selectRow(row: CsvRow) {
    if (row.errors.length > 0 || row.savedAdId) return;
    // Полный сброс: все значения формы и старый анализ, без наследования.
    text = row.text; url = row.url; platform = row.platform; account = row.account;
    date = row.date ?? ''; // неизвестна → null, не предыдущая/сегодня
    selected = row.mappedZkId ?? '';
    result = null; analyzedText = ''; analyzedZk = '';
    error = ''; saved = false; csvSaveNote = '';
    files = undefined;
    csvActiveId = row.rowId; csvConfirmed = false;
  }
  function confirmCsvZk() {
    if (!csvActive) { error = 'Сначала выберите строку CSV.'; return; }
    if (!workspace.complexes.some(z => z.id === selected)) { error = 'Выберите ЖК для строки.'; return; }
    csvConfirmed = true; error = '';
  }
  /**
   * Сохранение строки CSV без обязательного анализа: публикация без
   * подтверждённых факторов; AI не dependency импорта. Свежий анализ,
   * если он есть и не устарел, прикладывается.
   */
  let csvSaveNote = $state('');
  async function saveCsvRow() {
    const row = csvRows?.rows.find(r => r.rowId === csvActiveId);
    if (!row) { error = 'Сначала выберите строку CSV.'; return; }
    if (row.errors.length > 0) { error = row.errors[0]; return; }
    if (row.savedAdId) { error = 'Строка уже сохранена.'; return; }
    if (!csvConfirmed) { error = 'Подтвердите ЖК до сохранения.'; return; }
    const target = workspace.complexes.find(z => z.id === selected);
    if (!target) { error = 'Выберите ЖК для строки.'; return; }
    if (!text.trim()) { error = 'Пустой текст строки.'; return; }
    let adDate: string | null = null;
    const rawDate = date.trim();
    if (rawDate) {
      if (!isCalendarDate(rawDate)) { error = `Неверная дата «${rawDate}» (нужна реальная YYYY-MM-DD).`; return; }
      adDate = rawDate;
    }
    busy = true; error = '';
    try {
      const ad: Ad = {
        id: `AD-${newCommandId()}`, zkId: target.id, text, url, account,
        date: adDate, platform: source.label, captureAt: new Date().toISOString(),
        ...(result && !stale ? { analysis: result } : {}),
      };
      // Снимок повтора ДО commit: после commit workspace перезагружен, и поиск
      // нашёл бы уже смерженное состояние. Повтор вторым ad не становится.
      const dupe = findCsvDupe(row);
      await commit(withCommandId({ type: 'ad', ad, decision: 'saved', comment: 'Ручная проверка публикации (CSV-импорт)' }, newCommandId()));
      // commit добавил фиксацию к существующей публикации — показываем её ID,
      // а не выброшенный новый. savedAdId блокирует повторное сохранение строки.
      row.savedAdId = dupe ? dupe.id : ad.id;
      csvSaveNote = dupe
        ? `Сохранено как новая фиксация к ${dupe.id}, второй публикации нет.`
        : '';
      saved = true;
    } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { busy = false; }
  }
</script>
<div class="page-heading"><div><p class="eyebrow">Публикация → гипотеза → решение</p><h1>Проверка объявления</h1></div></div>
<p class="muted mb-6">Вставьте текст и зафиксируйте источник. Анализ предлагает гипотезы; факторы подтверждает аналитик.</p>
<div class="two-col">
  <form class="panel space-y-4" onsubmit={e => { e.preventDefault(); void run(); }}>
    <h2>Исходные данные</h2>
    <div class="actions">{#each ['SQ-001', 'SQ-002', 'SQ-003'] as id, i}<button type="button" class="small" onclick={() => preset(id)}>Пример {String.fromCharCode(65 + i)}</button>{/each}</div>
    <label>Объект<select required bind:value={selected}>{#each workspace.complexes as z}<option value={z.id}>{z.name} · {z.id}</option>{/each}</select></label>
    <label>Очередь<select bind:value={phaseId}><option value="">Очередь не определена / весь ЖК</option>{#each phases as p}<option value={p.id}>{p.name}</option>{/each}</select></label><label>Текст объявления<textarea required maxlength="20000" rows="8" bind:value={text} placeholder="Бронь квартиры — 500 000 тенге…"></textarea></label>
    <div class="form-grid"><label>Ссылка на источник<input type="url" bind:value={url} placeholder="https://"/></label><label>Площадка<input bind:value={platform} placeholder="Krisha.kz, Telegram…"/></label><label>Аккаунт<input bind:value={account}/></label><label>Дата публикации (пусто — не указана)<input type="date" bind:value={date}/></label></div>
    <p class="muted text-xs">Источник: {source.label} · определён {viaLabel(source.via)}. Публикация: {date.trim() ? date : 'не указана'}; фиксация — момент сохранения, датой публикации не считается. Система не загружает страницы по ссылке.</p>
    <label>Скриншот / документ<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" bind:files/></label>{#if supabase}<button type="button" disabled={busy||!files?.[0]?.type.startsWith('image/')} onclick={ocrImage}>Распознать изображение</button>{/if}
    {#if busy && !saving}<button type="button" onclick={cancelRun}>Отменить анализ</button>{/if}
    <button class="primary" disabled={saving || !selected}>{busy ? 'Обработка…' : 'Проанализировать'}</button>
    <button type="button" disabled={busy || !text.trim() || !selected} onclick={()=>saveMaterial()}>Сохранить материал без AI</button>
    {#if saved && publishedAdId}<p class="success" role="status">Материал сохранён: {publishedAdId}. Его можно добавить в материалы дела.</p>{/if}
  </form>
  <section class="panel space-y-4" aria-live="polite">
    <h2>Гипотезы ИИ</h2><p class="notice">Принятие гипотезы передаёт её на проверку. Баллы меняются только после проверки факта в деле.</p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if result}
      <span class="badge">{result.engine}</span>
      {#if stale}<p class="notice">Ввод изменён — повторите анализ перед сохранением.</p>{/if}
      {#each result.hypotheses as h}<article class="hypothesis"><b>{h.code} · гипотеза</b><blockquote>«{h.quote}»</blockquote><p>{h.reason}</p><label>Обоснование аналитика<input required placeholder="Почему принимаете/отклоняете гипотезу" bind:value={comments[h.id ?? h.code]}/></label><div class="actions"><button disabled={busy || !!reviewed[h.id ?? h.code] || stale} onclick={() => saveMaterial(h, 'accepted')}>Принять гипотезу {h.code}</button><button disabled={busy || !!reviewed[h.id ?? h.code] || stale} onclick={() => saveMaterial(h, 'rejected')}>Отклонить гипотезу</button></div></article>{/each}
      {#if !result.hypotheses.length}<p>Платёжных признаков не обнаружено. Это не подтверждает безопасность объекта.</p>{/if}
      {#if parsed?.entities.length}<div class="table-scroll"><table><thead><tr><th>Сущность</th><th>Значение</th><th>Цитата</th></tr></thead><tbody>{#each parsed.entities as entity}<tr><td>{entity.label}</td><td>{entity.value}</td><td>«{entity.quote}»</td></tr>{/each}</tbody></table></div>{/if}
      <button disabled={busy || saved || stale} onclick={() => saveMaterial()}>Сохранить без подтверждения</button>
      {#if saved}<p class="success" role="status">Публикация сохранена. Триаж гипотезы не начисляет баллы.</p>{/if}
    {:else}<p class="muted">Здесь появятся дословные цитаты, извлечённые данные и гипотезы.</p>{/if}
  </section>
</div>
<section class="panel ai-review-history"><h2>Сохранённые решения гипотез</h2>
{#each workspace.audit.filter(a => {const d=a.details as Command | undefined; return d?.type==='ai.review';}) as a}
{@const d=a.details as Command}
<p>{d.type==='ai.review' ? workspace.claims?.find(c=>c.id===d.claimId)?.code : ''} · {d.type==='ai.review' ? (d.decision==='accepted' ? 'Гипотеза принята' : 'Гипотеза отклонена') : ''} · {a.comment} · {a.reviewer}</p>
{/each}</section>
<details class="panel mt-6"><summary>Импорт из CSV</summary><p class="muted my-3">Заголовки: text/текст, url/ссылка, platform/площадка, account/аккаунт, date/дата, zk/жк. Каждую строку проверяет человек.</p><label>CSV<textarea rows="4" data-testid="csv-input" bind:value={csv}></textarea></label><button data-testid="csv-preview" onclick={previewCsv}>Предпросмотр CSV</button>
  {#if csvRows}{#each csvRows.errors as e}<p class="error" data-testid="csv-error">{e}</p>{/each}
    {#each csvRows.rows as row}
      {@const rowSrc = detectPlatform({ url: row.url, platform: row.platform })}
      {@const rowTarget = row.mappedZkId ? workspace.complexes.find(z => z.id === row.mappedZkId) : null}
      {@const rowDupeNote = csvRowDupeNote(row)}
      <div class="csv-row" data-testid="csv-row" data-rowid={row.rowId}><span><b>Строка {row.rowNumber}</b> · {row.text}</span>
      <p class="muted" data-testid="csv-row-source">Площадка: {rowSrc.label} ({viaLabel(rowSrc.via)}) · Публикация: {row.date ?? 'не указана'} · Фиксация: при сохранении · ЖК: {rowTarget ? `${rowTarget.name} (${rowTarget.id})` : 'не сопоставлен'}</p>
      {#if rowDupeNote}<p class="muted" data-testid="csv-row-dupe">{rowDupeNote}</p>{/if}
      {#if row.savedAdId}<p class="success" data-testid="csv-row-saved">Сохранена как {row.savedAdId}; повторный импорт запрещён.</p>{/if}
      {#each row.errors as e}<p class="error" data-testid="csv-row-error">{e}</p>{/each}
      {#if row.hintKind === 'id'}<p class="muted" data-testid="csv-row-hint">ЖК сопоставлен по ID: {workspace.complexes.find(z => z.id === row.mappedZkId)?.name} ({row.mappedZkId}). Подтвердите выбор.</p>
      {:else if row.hintKind === 'name'}<p class="muted" data-testid="csv-row-hint">Похоже на «{workspace.complexes.find(z => z.id === row.suggestionId)?.name}». Выберите ЖК и подтвердите.</p>
      {:else if row.hintKind === 'ambiguous'}<p class="muted" data-testid="csv-row-hint">Подсказка «{row.zkHint}» неоднозначна — выберите ЖК вручную.</p>
      {:else}<p class="muted" data-testid="csv-row-hint">{row.zkHint ? `ЖК «${row.zkHint}» не найден — выберите вручную.` : 'ЖК не указан — выберите вручную.'}</p>{/if}
      <button data-testid="csv-select" disabled={row.errors.length > 0 || !!row.savedAdId} onclick={() => selectRow(row)}>Проверить строку</button></div>{/each}
    {#if csvActive}<div class="csv-active" data-testid="csv-active"><p>Активна строка {csvActive.rowNumber} ({csvActive.rowId}). Площадка: {detectPlatform({ url: csvActive.url, platform: csvActive.platform }).label} ({viaLabel(detectPlatform({ url: csvActive.url, platform: csvActive.platform }).via)}); публикация: {csvActive.date ?? 'не указана'}, фиксация — момент сохранения.</p>
      <label>ЖК для строки<select data-testid="csv-zk" bind:value={selected}><option value="">— выберите —</option>{#each workspace.complexes as z}<option value={z.id}>{z.name} · {z.id}</option>{/each}</select></label>
      <button data-testid="csv-confirm" disabled={!selected || busy} onclick={confirmCsvZk}>Подтвердить ЖК</button>
      {#if csvConfirmed}<p class="success" data-testid="csv-confirmed">ЖК подтверждён.</p>{/if}
      <button data-testid="csv-save" disabled={!csvConfirmed || busy || !!csvActive.savedAdId || csvActive.errors.length > 0} onclick={() => void saveCsvRow()}>Сохранить строку без анализа</button>
      {#if csvSaveNote}<p class="success" data-testid="csv-save-note">{csvSaveNote}</p>{/if}</div>{/if}
  {/if}
</details>
