<script lang="ts">
 import {untrack} from 'svelte';
 import type {Command,ConstructionPhase} from '../lib/types';
 import {newCommandId,withCommandId,StaleConflictError,UnknownCommitResultError} from '../lib/repository';
 let {phase,commit}:{phase:ConstructionPhase;commit:(c:Command)=>Promise<void>}=$props();
 let claimed=$state<number|undefined>(untrack(()=>phase.readinessClaimed??undefined));let claimedSource=$state(untrack(()=>phase.readinessClaimedSource?.source??''));let claimedDate=$state(untrack(()=>phase.readinessClaimedSource?.date??''));
 let confirmed=$state<number|undefined>();let confirmedSource=$state('');let confirmedDate=$state('');let busy=$state(false);let error=$state('');let saved=$state(false);
 let intent:{key:string;id:string;command:Command}|undefined;
 async function submit(){if(busy)return;busy=true;error='';saved=false;try{
  if(claimed!=null&&(!claimedSource.trim()||!claimedDate))throw new Error('Для заявленной готовности нужны источник и дата.');
  if(confirmed!=null&&(!confirmedSource.trim()||!confirmedDate))throw new Error('Для измеренной готовности нужны источник и дата.');
  const key=JSON.stringify([claimed,claimedSource,claimedDate,confirmed,confirmedSource,confirmedDate]);
  if(intent&&intent.key!==key)throw new Error('Повторите прежнее наблюдение с теми же полями до подтверждения.');
  if(!intent){const updated:ConstructionPhase={...phase,readinessClaimed:claimed??null,readinessClaimedSource:claimed==null?null:{value:claimed,source:claimedSource,date:claimedDate},readinessConfirmed:confirmed??phase.readinessConfirmed??null,readinessSources:[...(phase.readinessSources??[]),...(confirmed==null?[]:[{value:confirmed,source:confirmedSource,date:confirmedDate}])]};intent={key,id:newCommandId(),command:{type:'phase.update',phase:updated}};}
  await commit(withCommandId(intent.command,intent.id));intent=undefined;saved=true;confirmed=undefined;confirmedSource='';confirmedDate='';
 }catch(e){if(!(e instanceof StaleConflictError||e instanceof UnknownCommitResultError))intent=undefined;error=e instanceof Error?e.message:String(e);}finally{busy=false;}}
</script>
<details class="mt-5"><summary>Наблюдения готовности выбранной очереди</summary><form class="space-y-3 mt-4" onsubmit={e=>{e.preventDefault();void submit();}}><p class="muted">Данные всего ЖК не переносятся на очередь. Разрыв ≥20 п.п. требует отдельной проверки R5.</p><div class="form-grid"><label>Заявленная готовность очереди, %<input type="number" min="0" max="100" bind:value={claimed}/></label><label>Источник заявления<input bind:value={claimedSource}/></label><label>Дата заявления<input type="date" bind:value={claimedDate}/></label></div><h3>Добавить измерение по документу</h3><div class="form-grid"><label>Измеренная готовность очереди, %<input type="number" min="0" max="100" bind:value={confirmed}/></label><label>Источник измерения<input bind:value={confirmedSource}/></label><label>Дата измерения<input type="date" bind:value={confirmedDate}/></label></div>{#if error}<p class="error" role="alert">{error}</p>{/if}{#if saved}<p class="success" role="status">Наблюдения очереди сохранены. История измерений сохранена.</p>{/if}<button disabled={busy}>Сохранить наблюдения очереди</button></form></details>
