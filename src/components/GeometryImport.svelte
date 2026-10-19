<script lang="ts">
 import type {AppState,Command,MapGeometry} from '../lib/types';
 import {newCommandId,withCommandId,StaleConflictError,UnknownCommitResultError,SessionSupersededError} from '../lib/repository';
 let {workspace,commit}:{workspace:AppState;commit:(c:Command)=>Promise<void>}=$props();
 let complexId=$state('');let phaseId=$state('');let source=$state('');let height=$state<number|undefined>();let verified=$state(false);let geojson=$state('');let busy=$state(false);let error=$state('');let saved=$state(false);
 let pending:{key:string;command:Command;id:string}|undefined;
 $effect(()=>{complexId;phaseId='';});
 async function submit(){if(busy)return;busy=true;error='';saved=false;try{
  if(!complexId||!source.trim())throw new Error('Укажите ЖК и источник контура.');
  const parsed=JSON.parse(geojson);const geometry=parsed.type==='Feature'?parsed.geometry:parsed;
  if(geometry?.type!=='Polygon')throw new Error('Поддерживается GeoJSON Polygon или Feature с Polygon; координаты в WGS84.');
  const key=JSON.stringify([complexId,phaseId,source,height,verified,geojson]);
  if(pending&&pending.key!==key)throw new Error('Сначала повторите сохранение прежнего контура с исходными полями.');
  if(!pending){const item:MapGeometry={id:`GEO-${newCommandId()}`,complexId,...(phaseId?{phaseId}:{}),source,verified,coordinates:geometry.coordinates,...(height==null?{}:{heightMeters:height})};pending={key,command:{type:'geometry.register',geometry:item},id:newCommandId()};}
  await commit(withCommandId(pending.command,pending.id));pending=undefined;saved=true;
 }catch(e){if(!(e instanceof StaleConflictError||e instanceof UnknownCommitResultError||e instanceof SessionSupersededError))pending=undefined;error=e instanceof Error?e.message:String(e);}finally{busy=false;}}
</script>
<form class="panel space-y-4 mt-5" onsubmit={e=>{e.preventDefault();void submit();}}><h2>Контур для 3D-карты</h2><div class="form-grid"><label>ЖК<select required bind:value={complexId}><option value="">Выберите ЖК</option>{#each workspace.complexes as z}<option value={z.id}>{z.name}</option>{/each}</select></label><label>Очередь<select bind:value={phaseId}><option value="">Весь ЖК</option>{#each (workspace.phases??[]).filter(p=>p.complexId===complexId) as p}<option value={p.id}>{p.name}</option>{/each}</select></label><label>Источник и дата проверки контура<input required bind:value={source}/></label><label>Высота в метрах, если установлена<input type="number" min="0" max="1000" step="any" bind:value={height}/></label></div><label>GeoJSON Polygon (WGS84)<textarea required rows="6" bind:value={geojson} placeholder={'{"type":"Polygon","coordinates":[[[82.61,49.98],[82.611,49.98],[82.611,49.981],[82.61,49.98]]]}' }></textarea></label><label class="check-label"><input type="checkbox" bind:checked={verified}/> Я проверил контур и его источник</label><p class="muted">Непроверенный контур сохраняется как кандидат. Без установленной высоты в 3D используется условная коробка высотой 72 м. Геометрия не подтверждает юридические факты.</p>{#if error}<p class="error" role="alert">{error}</p>{/if}{#if saved}<p class="success" role="status">Контур сохранён. Он доступен на карте после переключения в 3D и увеличения масштаба.</p>{/if}<button class="primary" disabled={busy}>Сохранить контур</button></form>
