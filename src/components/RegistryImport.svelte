<script lang="ts">
  import type {AppState,Command} from '../lib/types';
  import {importSources,parseImportFile,previewLocalImport,localImportCommands,stageLabel,type ImportPreview,type ImportSourceId} from '../lib/registry-import';
  import {previewRegistryImport,commitRegistryImport} from '../lib/workspace-api';
  import {supabase} from '../lib/supabase';
  import {getSessionGeneration,getSessionUser,SessionSupersededError,newCommandId,withCommandId} from '../lib/repository';
  import {dossierUrl} from '../lib/navigation';
  let {workspace,commit,onImported}:{workspace:AppState;commit:(c:Command)=>Promise<void>;onImported:()=>Promise<void>}=$props();
  let chosen=$state<ImportSourceId[]>(importSources.map(s=>s.id));let file=$state<FileList>();
  let preview=$state<ImportPreview|null>(null);let selected=$state<string[]>([]);let busy=$state(false);let error=$state('');let notice=$state('');let delivered=$state(false);let frozen=$state(false);
  let pending:{commands:Command[];position:number;session:number}|null=null;
  let previewSession:number|null=null;
  const available=$derived(preview?.candidates.filter(c=>c.action==='create'||c.action==='enrich')??[]);
  const actions:Record<string,string>={create:'Новый объект',enrich:'Дополнить источниками',duplicate:'Уже импортирован',review:'Ручная проверка'};
  function invalidate(){if(busy||frozen)return;preview=null;selected=[];error='';notice='';delivered=false;pending=null;}
  function checkSession(generation:number){if(generation!==getSessionGeneration())throw new SessionSupersededError();}
  async function fetchPreview(){
    if(busy)return;busy=true;error='';notice='';selected=[];preview=null;delivered=false;pending=null;frozen=false;const generation=getSessionGeneration();
    try{const f=file?.[0];if(f&&f.size>2*1024*1024)throw new Error('Выгрузка превышает 2 МБ.');const records=f?parseImportFile(await f.text(),f.name):[];checkSession(generation);
      const result=supabase&&getSessionUser()?await previewRegistryImport([...chosen],records):await previewLocalImport(records,[...chosen],$state.snapshot(workspace));checkSession(generation);previewSession=generation;preview=result;selected=result.candidates.filter(c=>c.action==='create'||c.action==='enrich').map(c=>c.id);
      if(!result.candidates.length&&!result.errors.length)notice='Объекты не получены. Проверьте доступность источников или загрузите подготовленную выгрузку.';
    }catch(e){if(generation===getSessionGeneration())error=e instanceof Error?e.message:String(e);}finally{busy=false;}
  }
  async function save(){
    if(busy||!preview||!selected.length)return;busy=true;error='';notice='';frozen=true;const generation=getSessionGeneration();
    try{
      if(previewSession!==generation)throw new SessionSupersededError();
      if(supabase&&getSessionUser()){const result=await commitRegistryImport(preview.id,[...selected]);checkSession(generation);await onImported();checkSession(generation);notice=`Импорт завершён: новых объектов — ${result.created}, источников — ${result.sources_added}.`;}
      else {pending??={commands:(await localImportCommands($state.snapshot(preview),[...selected],$state.snapshot(workspace))).map(c=>withCommandId(c,`${c.type==='complex'?'registry-create-':'registry-source-'}${newCommandId()}`)),position:0,session:generation};
        if(pending.session!==generation)throw new SessionSupersededError();
        while(pending.position<pending.commands.length){await commit(pending.commands[pending.position]);checkSession(generation);pending.position++;}
        notice=`Импорт завершён: выбрано объектов — ${selected.length}. Источники сохранены в досье. Данные хранятся в этом браузере.`;
      }
      delivered=true;pending=null;frozen=false;
    }catch(e){if(generation===getSessionGeneration())error=`${e instanceof Error?e.message:String(e)}${pending?` Сохранено команд: ${pending.position} из ${pending.commands.length}. Повтор продолжит этот импорт.`:''}`;}finally{busy=false;}
  }
</script>

<section class="registry-import panel mb-6" aria-labelledby="registry-import-title" aria-busy={busy}>
  <div class="import-heading"><div><p class="eyebrow">Импорт из внешних источников</p><h2 id="registry-import-title">Объекты строительства и юридические лица</h2><p class="muted">Реальные сведения с историей происхождения и отдельной проверкой фактов.</p></div><span class="country-tag" aria-label="Казахстан">KZ</span></div>
  <div class="region"><span>Регион</span><strong>Өскемен, Восточно-Казахстанская область</strong></div>
  <fieldset disabled={busy||frozen}><legend>Источники данных</legend><div class="source-options">{#each ['Государственные реестры','Каталоги недвижимости','Проверка юридических лиц'] as group}<div><p>{group}</p>{#each importSources.filter(s=>s.group===group) as s}<label class="source-option"><input type="checkbox" value={s.id} bind:group={chosen} onchange={invalidate}/><span>{s.name}</span><a href={s.url} target="_blank" rel="noopener noreferrer" aria-label={`Открыть ${s.name}`}>↗</a></label>{/each}</div>{/each}</div></fieldset>
  <details class="export-settings"><summary>Подготовленная выгрузка · CSV / JSON</summary><p class="muted">Для источников с разрешённым доступом. Excel: сохраните лист как CSV UTF-8. БИН храните как текст, чтобы сохранить начальные нули.</p><label>Файл выгрузки<input type="file" accept=".csv,.json" bind:files={file} disabled={busy||frozen} onchange={invalidate}/></label><p class="muted">Обязательные поля: name, city, address, source_url. Дополнительно: developer, developer_bin, construction_status, observed_at (YYYY-MM-DD), lat, lng. Не более 100 строк / 2 МБ. Тип источника определяется по домену ссылки.</p><p class="muted">Юридическое лицо вносится в контексте объекта; отдельные списки организаций сначала сопоставьте с объектами по БИН.</p></details>
  <div class="import-controls"><div><p class="eyebrow">Предпросмотр импорта</p><p class="muted">Количество объектов и доступность источников определяются при запросе. Совпадения проверяются до записи.</p></div><button class="primary" disabled={busy||!chosen.length} onclick={fetchPreview}>{busy&&!frozen?'Получение…':'Получить данные'}</button></div>
  {#if !supabase||!getSessionUser()}<p class="import-footnote">Локальный режим: импорт подготовленных выгрузок в этот браузер. Получение через API доступно в подключённом рабочем пространстве.</p>{/if}
  {#if error}<p class="error mt-4" role="alert">{error}</p>{/if}{#if notice}<p class="notice mt-4" role="status">{notice}</p>{/if}
  {#if preview}<div class="import-results"><ul class="source-statuses" aria-label="Доступность источников">{#each preview.sources as s}<li><b>{importSources.find(x=>x.id===s.id)?.name??s.id}</b><span class:source-failed={s.status==='error'}>{s.message} Получено: {s.count}.</span></li>{/each}</ul>
    {#if preview.errors.length}<details class="mt-4"><summary>Строки с ошибками: {preview.errors.length}</summary>{#each preview.errors as e}<p class="error mt-2">{e}</p>{/each}</details>{/if}
    {#if preview.candidates.length}<div class="selection-bar"><p><b>{preview.candidates.length}</b> объектов · выбрано {selected.length}</p><button class="small" disabled={busy||delivered||frozen||!available.length} onclick={()=>selected=selected.length===available.length?[]:available.map(c=>c.id)}>{available.length&&selected.length===available.length?'Снять выбор':'Выбрать доступные'}</button></div><div class="candidate-list">{#each preview.candidates as c}<article class="import-candidate"><label><input type="checkbox" value={c.id} bind:group={selected} disabled={busy||delivered||frozen||c.action==='review'||c.action==='duplicate'}/><span><b>{c.record.name}</b><small>{c.record.address}</small></span></label><span class="badge">{actions[c.action]}</span><p>{stageLabel[c.record.construction_status]} · БИН: {c.record.developer_bin??'не установлен'}</p><p class="muted">{c.record.developer??'Застройщик не установлен'} · источников: {c.sources.length} · не проверено</p><div class="candidate-sources">{#each c.sources as s}<a href={s.source_url} target="_blank" rel="noopener noreferrer">{importSources.find(x=>x.id===s.source_id)?.name} ↗</a><span>Дата источника: {s.observed_at??'неизвестна'}</span>{/each}</div>{#each c.warnings as warning}<p class="import-warning">{warning}</p>{/each}{#if delivered||c.existing_id}<a href={dossierUrl(c.existing_id??c.id)}>Открыть досье →</a>{/if}</article>{/each}</div>
    <div class="import-controls"><p class="muted">Импорт сохраняет сведения как непроверенные. Недоступность реестра не добавляет риск. Проверенные карточки дополняются источниками без перезаписи решений.</p><button class="primary" disabled={busy||delivered||!selected.length} onclick={save}>{delivered?'Импортировано':busy?'Сохранение…':frozen?'Повторить импорт':'Импортировать выбранные'}</button></div>{/if}
    <p class="import-footnote">Получено: {new Date(preview.created_at).toLocaleString('ru-RU')}{preview.expires_at?` · Предпросмотр действует до ${new Date(preview.expires_at).toLocaleString('ru-RU')}`:''}. {preview.geocoding?.configured?`Geoapify: найдено точных адресов ${preview.geocoding.matched} из ${preview.geocoding.attempted}; предел — ${preview.geocoding.limit} адресов за запрос.`:'Геокодер не подключён.'} Адреса без координат требуют ручной проверки.</p>
  </div>{/if}
</section>

<style>
 .registry-import{padding:26px;background:#fff;border:1px solid #dbe3dd;border-radius:12px}
 .import-heading{display:flex;justify-content:space-between;gap:20px}.import-heading h2{font-size:23px;line-height:1.25;max-width:650px;margin:8px 0}.eyebrow{font-size:10px;letter-spacing:.12em;color:#53675a}
 .country-tag{display:grid;place-items:center;align-self:flex-start;min-width:42px;height:32px;border:1px solid #cad7cd;border-radius:4px;font-size:12px;color:#346044}
 .region{display:flex;gap:18px;align-items:baseline;padding:18px 0;margin-top:8px;border-bottom:1px solid #e4e9e5}.region>span{font-size:11px;text-transform:uppercase;color:#66756c;letter-spacing:.08em}.region strong{font-size:14px}
 fieldset{border:0;padding:20px 0 0;margin:0;min-width:0}legend{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.source-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}.source-options>div>p{font-weight:600;font-size:13px;margin-bottom:10px}.source-option{display:flex;align-items:center;gap:9px;font-size:13px;margin:8px 0}.source-option input,.import-candidate input{width:16px;height:16px;flex-shrink:0;accent-color:#1e6b34}.source-option a{margin-left:auto;color:#587160}
 .source-option,.import-candidate label{flex-direction:row}
 .export-settings{margin-top:18px;border-top:1px solid #e4e9e5;padding-top:16px;font-size:12px}.export-settings p{margin:12px 0;line-height:1.6}.export-settings label{max-width:560px}
 .import-controls{display:flex;justify-content:space-between;align-items:center;gap:22px;margin-top:22px}.import-controls p{font-size:12px;line-height:1.6;max-width:720px}.import-controls button{flex-shrink:0}.import-footnote{font-size:11px;color:#6a766e;margin-top:14px;line-height:1.6}.import-results{border-top:1px solid #dbe3dd;margin-top:22px;padding-top:18px}.source-statuses{list-style:none;padding:0;margin:0;display:grid;gap:8px}.source-statuses li{display:flex;gap:12px;font-size:12px}.source-statuses b{min-width:108px}.source-statuses span{color:#5b6e60}.source-statuses .source-failed{color:#9b361e}
 .selection-bar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:20px 0 12px;font-size:13px}.candidate-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.import-candidate{border:1px solid #dce4de;padding:16px;border-radius:6px;min-width:0;font-size:12px;overflow-wrap:anywhere}.import-candidate label{display:flex;gap:10px;align-items:flex-start;margin-bottom:10px}.import-candidate label b{font-size:15px}.import-candidate small{display:block;color:#617168;font-size:12px;margin-top:5px}.import-candidate .badge{display:inline-block;margin-bottom:10px}.import-candidate p{line-height:1.6}.candidate-sources{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.candidate-sources span{color:#6e766f}.import-warning{border-left:2px solid #b88c40;padding-left:9px;margin:8px 0;color:#7d5c27}
 @media(max-width:700px){.registry-import{padding:18px}.import-heading h2{font-size:20px}.source-options{grid-template-columns:1fr;gap:12px}.region{flex-direction:column;gap:6px}.import-controls{align-items:stretch;flex-direction:column;gap:12px}.candidate-list{grid-template-columns:1fr}.source-statuses li{flex-direction:column;gap:2px}}
</style>
