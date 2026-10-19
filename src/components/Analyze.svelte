<script lang="ts">
  import { untrack, onDestroy, onMount } from 'svelte';
  import type { Ad, Analysis, AppState, Hypothesis, Media } from '../lib/types';
  import type { Command } from '../lib/domain';
  import { analyze, canonicalRunInput, newRunId, type AiRunInput } from '../lib/analysis';
  import { parseAdText, parseCsvAds, resolveCsvHint, detectPlatform, adDedupeKey } from '../lib/parser';
  import { isCalendarDate } from '../lib/validation';
  import type { CsvParseResult, CsvRow } from '../lib/types';
  import {
    uploadFile, unstageFileForCommand, stageFileForCommand, removeStagedFile, recordCleanupRetry,
    withCommandId, attachStagedMedia, newCommandId, getSessionGeneration, onSessionChange,
    StaleConflictError, SessionSupersededError, UnknownCommitResultError,
  } from '../lib/repository';
  let { workspace, zkId = '', initialText = '', commit }: { workspace: AppState; zkId?: string; initialText?: string; commit: (command: Command) => Promise<void> } = $props();
  let selected = $state(untrack(() => zkId || workspace.complexes[0]?.id || ''));
  let text = $state(untrack(() => initialText)); let url = $state(''); let account = $state(''); let platform = $state('');
  let date = $state(new Date().toISOString().slice(0,10)); let csv = $state('');
 let csvRows = $state<CsvParseResult | null>(null);
 let csvActiveId = $state<string | null>(null);
 let csvConfirmed = $state(false);
  let result = $state<Analysis | null>(null); let analyzedText = $state(''); let analyzedZk = $state('');
  let error = $state(''); let busy = $state(false); let saved = $state(false); let files = $state<FileList>();
  let analystComment = $state(''); let evidenceText = $state('');
  let commissioningSource=$state(''); let commissioningDate=$state('');
  let generation = 0;
  let controller: AbortController | null = null;
  let snapshot = $state<AiRunInput | null>(null);
  let snapshotSession = -1;
  let comments = $state<Record<string,string>>({});
  let reviewed = $state<Record<string,string>>({});
  let publishedAdId = $state('');
  let saving=$state(false);
  let reviewIntents=new Map<string,{id:string;command:Command}>();
  function cancelRun() { generation++; controller?.abort(); controller=null; busy=false; }
  onDestroy(cancelRun);
  onMount(()=>onSessionChange(()=>{cancelRun(); result=null; snapshot=null; intent=null; publishedAdId='';}));
  function currentInput():AiRunInput {
    const file=files?.[0];
    return {text,zkId:selected,url,account,date:date.trim() || null,platform:source.label,...(file ? {attachments:[{name:file.name,size:file.size,type:file.type,lastModified:file.lastModified}]} : {})};
  }

  /**
   * S2.3 (C3). Намерение сохранения: стабильные adId/mediaId/path/commandId на
   * всё время жизни одного результата анализа. Retry (потеря ответа, stale,
   * cleanup) использует ПРЕЖНИЕ ID — новых сущностей не создаётся. Сброс при
   * новом анализе, смене текста/объекта/файла.
   */
  interface SaveIntent {
    commandId: string; adId: string; mediaId: string;
    path: string | null; media: Media | null;
    resultRef: Analysis | null; fileSig: string;
    command: Command | null;
  }
  let intent = $state<SaveIntent | null>(null);
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
    cancelRun();
    error = ''; result = null; saved = false; intent = null; reviewed={}; comments={}; publishedAdId=''; reviewIntents.clear(); busy = true;
    const request = ++generation; const session=getSessionGeneration(); const input=currentInput();
    snapshot=structuredClone(input); snapshotSession=session; controller=new AbortController();
    try {
      const output = await analyze(input,{runId:newRunId(),signal:controller.signal});
      if (generation === request && session===getSessionGeneration()) { result = output; analyzedText = input.text; analyzedZk = input.zkId; }
    } catch (e) { if(generation===request && session===getSessionGeneration()) error=e instanceof Error ? e.message : String(e); }
    finally { if (generation === request && session===getSessionGeneration()) busy = false; }
  }
  /**
   * S2.3 (C3). Публикация с вложением как единое решение: upload → ОДНА команда
   * (ad + evidence/media/decision) → saved=true только после ACK.
   *  - upload fail: решения нет, commit не вызывается;
   *  - известный отказ RPC: удаляем ТОЛЬКО staged-файлы этого commandId;
   *    cleanup-fail → запись в очередь повтора, молча не глотаем;
   *  - timeout/неизвестный исход: файл НЕ удаляем, retry тем же commandId;
   *  - stale: файл НЕ удаляем, draft сохранён, решение — заново вручную.
   * Нельзя просто всегда удалять файл в catch.
   */
  async function save(decision: 'saved' | 'confirmed' | 'rejected', hypothesis?: Hypothesis) {
    busy = true; saving=true; error = '';
    const saveRequest=generation;
    const saveSession=getSessionGeneration();
    try {
      if(saveSession!==snapshotSession) throw new SessionSupersededError();
      analystComment=hypothesis ? comments[hypothesis.id ?? hypothesis.code] ?? '' : '';
      if (stale) throw new Error('Текст или объект изменён. Запустите анализ повторно.');
      if (decision !== 'saved' && !analystComment.trim()) throw new Error('Укажите обоснование решения: reason модели решением не является.');
      if (!result) throw new Error('Сначала запустите анализ.');
      if (publishedAdId && hypothesis) {
        const evidence={source:source.label || 'Ручной ввод',date:date || new Date().toISOString().slice(0,10),kind:'publication' as const,adId:publishedAdId,quote:hypothesis.quote,...(result.runId ? {runId:result.runId,hypothesisId:hypothesis.id} : {}),...(hypothesis.code==='R3' ? {text:evidenceText.trim(),...(result.runId && decision==='confirmed' ? {beforeCommissioning:{source:commissioningSource.trim(),date:commissioningDate,text:evidenceText.trim()}} : {})} : {})};
        const key=hypothesis.id ?? hypothesis.code;
        const cmd:Command={type:'factor',zkId:selected,code:hypothesis.code,status:decision==='confirmed' ? 'confirmed' : 'rejected',evidence,comment:analystComment.trim()};
        const pending=reviewIntents.get(key);
        if(pending && JSON.stringify(pending.command)!==JSON.stringify(cmd)) throw new UnknownCommitResultError('Сначала повторите прежнее решение с тем же обоснованием: его ACK ещё не получен.',pending.id);
        const next=pending ?? {id:newCommandId(),command:cmd}; reviewIntents.set(key,next);
        await commit(withCommandId(next.command,next.id));
        reviewIntents.delete(key);
        if(saveSession!==getSessionGeneration()) return;
        reviewed={...reviewed,[hypothesis.id ?? hypothesis.code]:decision}; saved=true; return;
      }
      const fileSig = currentFileSig();
      if (!intent || intent.resultRef !== result || intent.fileSig !== fileSig) {
        intent = {
          commandId: newCommandId(), adId: `AD-${newCommandId()}`, mediaId: newCommandId(),
          path: null, media: null, resultRef: result, fileSig, command: null,
        };
      }
      const active = intent;
      const file = files?.[0];
      // A lost ACK must replay the exact payload, including captureAt and metadata.
      if (active.command) {
        await commit(withCommandId(active.command, active.commandId));
        if (active.path) unstageFileForCommand(active.commandId, active.path);
        if(saveSession!==getSessionGeneration()) return;
        publishedAdId=workspace.ads.find(a => a.zkId===selected && adDedupeKey(a.zkId,a.text)===adDedupeKey(selected,text))?.id ?? active.adId; intent=null; if(hypothesis) reviewed={...reviewed,[hypothesis.id ?? hypothesis.code]:decision}; saved = true;
        return;
      }
      // 1. Upload до финального commit. Повтор — тем же mediaId (тот же путь).
      if (file && !active.media) {
        const uploaded = await uploadFile(file, selected, { mediaId: active.mediaId });
        active.media = uploaded;
        active.path = uploaded.path;
        stageFileForCommand(active.commandId, uploaded.path);
      }
      if(saveSession!==getSessionGeneration() || saveRequest!==generation) throw new SessionSupersededError();
      if(stale) throw new Error('Ввод изменён во время загрузки файла. Повторите анализ.');
      // 2. Одна команда: публикация + вложение + evidence/решение.
      const ad: Ad = { id: active.adId, zkId: selected, text, url, account, date: date.trim() ? date : null, platform: source.label, captureAt: new Date().toISOString(), analysis: result! };
      // Гипотеза уходит урезанной {code, quote}; reason модели — отдельно в modelReason.
      const wire = hypothesis ? { code: hypothesis.code, quote: hypothesis.quote,
        ...(result.runId ? {runId:result.runId,hypothesisId:hypothesis.id} : {}),
        ...(hypothesis.code === 'R3' ? { evidenceText: evidenceText.trim(),...(result.runId && decision==='confirmed' ? {beforeCommissioning:{source:commissioningSource.trim(),date:commissioningDate,text:evidenceText.trim()}} : {}) } : {}) } : undefined;
      let cmd: Command = {
        type: 'ad', ad, decision, hypothesis: wire,
        comment: decision === 'saved' ? 'Ручная проверка публикации' : analystComment.trim(),
        modelReason: hypothesis?.reason,
      };
      if (active.media) {
        const attachment: Media = { ...active.media, note: `Источник публикации ${active.adId}` };
        cmd = attachStagedMedia(cmd, attachment);
      }
      active.command = cmd;
      await commit(withCommandId(active.command, active.commandId));
      // 3. ACK получен: файл принят (ссылка в состоянии), убрать из staged БЕЗ удаления.
      if (active.path) unstageFileForCommand(active.commandId, active.path);
      else unstageFileForCommand(active.commandId);
      if(saveSession!==getSessionGeneration()) return;
      publishedAdId=workspace.ads.find(a => a.zkId===selected && adDedupeKey(a.zkId,a.text)===adDedupeKey(selected,text))?.id ?? active.adId; intent=null; if(hypothesis) reviewed={...reviewed,[hypothesis.id ?? hypothesis.code]:decision}; saved = true;
    } catch (e) {
      if(saveSession!==getSessionGeneration()) return;
      if (e instanceof StaleConflictError || e instanceof UnknownCommitResultError || e instanceof SessionSupersededError) {
        // Исход неизвестен или состояние ушло вперёд: файл НЕ удаляем,
        // повтор тем же commandId безопасен (квитанция).
        error = e instanceof Error ? e.message : String(e);
      } else {
        // Известный отказ RPC: чистим ТОЛЬКО staged-файлы этого намерения.
        const msg = e instanceof Error ? e.message : String(e);
        if(hypothesis) reviewIntents.delete(hypothesis.id ?? hypothesis.code);
        const active = intent;
        intent = null;
        if (active?.path) {
          try {
            await removeStagedFile(active.path, active.commandId);
          } catch (cleanupErr) {
            recordCleanupRetry(active.path);
            const cmsg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
            error = `${msg} (очистка staged-файла не удалась: ${cmsg}; повтор запланирован)`;
            return;
          }
        }
        error = msg;
      }
    } finally { saving=false; if(saveSession===getSessionGeneration()) busy = false; }
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
    error = ''; saved = false; intent = null; analystComment = ''; csvSaveNote = '';
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
<div class="page-heading"><div><p class="eyebrow">ПУБЛИКАЦИЯ → ГИПОТЕЗА → РЕШЕНИЕ</p><h1>Проверка объявления</h1></div></div>
<p class="muted mb-6">Вставьте текст и зафиксируйте источник. Анализ предлагает гипотезы; факторы подтверждает аналитик.</p>
<div class="two-col">
  <form class="panel space-y-4" onsubmit={e => { e.preventDefault(); void run(); }}>
    <h2>01 / Исходные данные</h2>
    <div class="actions">{#each ['SQ-001', 'SQ-002', 'SQ-003'] as id, i}<button type="button" class="small" onclick={() => preset(id)}>Пример {String.fromCharCode(65 + i)}</button>{/each}</div>
    <label>Объект<select required bind:value={selected}>{#each workspace.complexes as z}<option value={z.id}>{z.name} · {z.id}</option>{/each}</select></label>
    <label>Текст объявления<textarea required maxlength="20000" rows="8" bind:value={text} placeholder="Бронь квартиры — 500 000 тенге…"></textarea></label>
    <div class="form-grid"><label>Ссылка на источник<input type="url" bind:value={url} placeholder="https://"/></label><label>Площадка<input bind:value={platform} placeholder="Krisha.kz, Telegram…"/></label><label>Аккаунт<input bind:value={account}/></label><label>Дата публикации (пусто — не указана)<input type="date" bind:value={date}/></label></div>
    <p class="muted text-xs">Источник: {source.label} · определён {viaLabel(source.via)}. Публикация: {date.trim() ? date : 'не указана'}; фиксация — момент сохранения, датой публикации не считается. Система не загружает страницы по ссылке.</p>
    <label>Скриншот / документ<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" bind:files/></label>
    {#if busy}<button type="button" onclick={cancelRun}>Отменить анализ</button>{/if}
    <button class="primary" disabled={saving || !selected}>{busy ? 'Обработка…' : 'Проанализировать'}</button>
  </form>
  <section class="panel space-y-4" aria-live="polite">
    <h2>02 / Анализ и решение</h2>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if result}
      <span class="badge">{result.engine}</span>
      {#if stale}<p class="notice">Ввод изменён — повторите анализ перед сохранением.</p>{/if}
      {#each result.hypotheses as h}<article class="hypothesis"><b>{h.code} · гипотеза</b><blockquote>«{h.quote}»</blockquote><p>{h.reason}</p>{#if h.code === 'R3'}{#if result.realAI}<label>Источник материала о вводе<input bind:value={commissioningSource}/></label><label>Дата материала о вводе<input type="date" bind:value={commissioningDate}/></label>{/if}<label>Датированный материал о том, что объект не введён<textarea bind:value={evidenceText} placeholder="Источник, дата YYYY-MM-DD и содержание проверки ввода объекта"></textarea></label>{/if}<label>Обоснование аналитика<input required placeholder="Почему подтверждаете/отклоняете" bind:value={comments[h.id ?? h.code]}/></label><div class="actions"><button disabled={busy || !!reviewed[h.id ?? h.code] || stale} onclick={() => save('confirmed', h)}>Подтвердить {h.code}</button><button disabled={busy || !!reviewed[h.id ?? h.code] || stale} onclick={() => save('rejected', h)}>Отклонить гипотезу</button></div></article>{/each}
      {#if !result.hypotheses.length}<p>Платёжных признаков не обнаружено. Это не подтверждает безопасность объекта.</p>{/if}
      {#if parsed?.entities.length}<div class="table-scroll"><table><thead><tr><th>Сущность</th><th>Значение</th><th>Цитата</th></tr></thead><tbody>{#each parsed.entities as entity}<tr><td>{entity.label}</td><td>{entity.value}</td><td>«{entity.quote}»</td></tr>{/each}</tbody></table></div>{/if}
      <button disabled={busy || saved || stale} onclick={() => save('saved')}>Сохранить без подтверждения</button>
      {#if saved}<p class="success" role="status">Публикация и решение сохранены.</p>{/if}
    {:else}<p class="muted">Здесь появятся дословные цитаты, извлечённые данные и гипотезы.</p>{/if}
  </section>
</div>
<section class="panel ai-review-history"><h2>Сохранённые решения гипотез</h2>
{#each workspace.audit.filter(a => {const d=a.details as Command | undefined; return (d?.type==='factor' && !!d.evidence.adId) || (d?.type==='ad' && !!d.hypothesis);}) as a}
{@const d=a.details as Command}
<p>{d.type==='factor' ? d.code : d.type==='ad' ? d.hypothesis?.code : ''} · {d.type==='factor' ? d.status : d.type==='ad' ? d.decision : ''} · {a.comment} · {a.reviewer}</p>
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
