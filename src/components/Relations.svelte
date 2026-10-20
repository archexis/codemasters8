<script lang="ts">
 import RelationGraph from './RelationGraph.svelte';
 import {workspaceRelations,connectedRelations,relationLabels} from '../lib/relation-graph';
 import type {AppState,Command,RelationType} from '../lib/types';
 import {dossierRelations,relationNodes,type DossierRelation} from '../lib/dossier-context';
 import {safeUrl} from '../lib/domain';
 import {newCommandId,withCommandId,StaleConflictError,UnknownCommitResultError} from '../lib/repository';
 let {workspace,complexId,phaseId,caseId,commit}:{workspace:AppState;complexId:string;phaseId?:string;caseId?:string;commit:(c:Command)=>Promise<void>}=$props();
 let mode=$state('graph');let type=$state('');let selectedId=$state('');let limit=$state(40);let expanded=$state(false);let error=$state('');let busy=$state(false);
 let scope=$state('subject');
 const subject=$derived(dossierRelations(workspace,complexId,phaseId));
 const centerId=$derived(`complex:${complexId}`);
 const centerLabel=$derived(workspace.complexes.find(z=>z.id===complexId)?.name??'ЖК');
 const all=$derived(scope==='subject'||phaseId?subject:scope==='connected'?connectedRelations(workspaceRelations(workspace),`complex:${complexId}`):workspaceRelations(workspace));const filtered=$derived(all.filter(r=>!type||r.type===type));const visible=$derived(filtered.slice(0,limit));const selected=$derived(filtered.find(r=>r.id===selectedId));
 const types=relationLabels;
 const statusLabel=(status:string)=>status==='verified'?'Подтверждена':status==='rejected'?'Отклонена':'Кандидат';
 const nodes=$derived(relationNodes(workspace));
 const materials=$derived((workspace.artifacts??[]).filter(a=>a.complexId===complexId&&a.phaseId===phaseId));
 let fromId=$state('');let toId=$state('');let relationType=$state<RelationType>('mentions');let sourceIds=$state<string[]>([]);let reviewComment=$state('');let creating=$state(false);
 let registerIntent:{key:string;id:string;command:Command}|undefined;
 const reviewIntents=new Map<string,{key:string;id:string;command:Command}>();
 async function register(){if(busy)return;busy=true;error='';try{const key=JSON.stringify([fromId,toId,relationType,sourceIds]);if(registerIntent&&registerIntent.key!==key)throw new Error('Повторите прежнее сохранение связи до получения подтверждения.');registerIntent??={key,id:newCommandId(),command:{type:'relation.register',relation:{id:`LINK-${newCommandId()}`,complexId,...(phaseId?{phaseId}:{}),fromId,toId,relationType,sourceArtifactIds:sourceIds,matchMethod:'manual'}}};await commit(withCommandId(registerIntent.command,registerIntent.id));registerIntent=undefined;creating=false;}catch(e){if(!(e instanceof StaleConflictError||e instanceof UnknownCommitResultError))registerIntent=undefined;error=e instanceof Error?e.message:String(e);}finally{busy=false;}}
 async function review(r:DossierRelation,status:'verified'|'rejected'){if(busy)return;busy=true;error='';try{if(!reviewComment.trim())throw new Error('Укажите обоснование проверки связи.');const key=JSON.stringify([status,reviewComment]);let pending=reviewIntents.get(r.id);if(pending&&pending.key!==key)throw new Error('Повторите прежнее решение с тем же обоснованием.');pending??={key,id:newCommandId(),command:{type:'relation.review',relationId:r.id,status,comment:reviewComment}};reviewIntents.set(r.id,pending);await commit(withCommandId(pending.command,pending.id));reviewIntents.delete(r.id);reviewComment='';}catch(e){if(!(e instanceof StaleConflictError||e instanceof UnknownCommitResultError))reviewIntents.delete(r.id);error=e instanceof Error?e.message:String(e);}finally{busy=false;}}
 async function attach(r:DossierRelation){if(!caseId)return;busy=true;error='';try{if(r.stored)for(const artifactId of r.sourceEvidenceIds)await commit({type:'case.attach',caseId,artifactId});const id=`REL-${newCommandId()}`;await commit({type:'artifact.register',artifact:{id,complexId,...(phaseId?{phaseId}:{}),kind:'relationship',source:r.sourceEvidenceIds.join(', ')||'Контекст из карточки; первичный документ не приложен',text:`${types[r.type]}: ${r.from} → ${r.to}. Статус: ${statusLabel(r.verificationStatus)}. ${r.matchMethod}. ${r.label}`,...(r.url?{url:r.url}:{})}});await commit({type:'case.attach',caseId,artifactId:id});}catch(e){error=String(e);}finally{busy=false;}}
</script>

{#snippet relationDetails()}
{#if selected}<article class="panel mt-4"><h3>{types[selected.type]} · {statusLabel(selected.verificationStatus)}</h3><p>{selected.from} → {selected.to}</p><p>{selected.label}</p><p class="muted">{selected.matchMethod}</p><p class="text-xs">Доказательства: {selected.sourceEvidenceIds.join(', ') || 'не приложены'} · фиксация: {selected.capturedAt}</p><div class="actions mt-4">{#if safeUrl(selected.url)}<a class="button" href={safeUrl(selected.url)} target="_blank" rel="noopener noreferrer">К оригиналу ↗</a>{/if}{#if caseId&&subject.some(r=>r.id===selected.id)}<button disabled={busy} onclick={()=>attach(selected)}>Добавить связь в дело</button>{/if}</div>{#if selected.stored&&subject.some(r=>r.id===selected.id)}<label class="mt-4">Обоснование проверки связи<textarea bind:value={reviewComment}></textarea></label><div class="actions mt-3"><button disabled={busy||!reviewComment.trim()} onclick={()=>review(selected,'verified')}>Подтвердить связь</button><button disabled={busy||!reviewComment.trim()} onclick={()=>review(selected,'rejected')}>Отклонить связь</button></div>{/if}</article>{/if}
{/snippet}
<svelte:window onkeydown={e=>{if(e.key==='Escape')expanded=false;}}/>

<section class:graph-expanded={expanded}><div class="actions mb-4"><button aria-pressed={mode==='graph'} onclick={()=>mode='graph'}>Граф</button><button aria-pressed={mode==='list'} onclick={()=>mode='list'}>Список</button><label>Охват графа<select bind:value={scope} onchange={()=>selectedId=''}><option value="subject">Только это досье</option>{#if !phaseId}<option value="connected">Связанное окружение</option><option value="workspace">Все связи рабочего пространства</option>{/if}</select></label><label>Тип связи<select bind:value={type} onchange={()=>selectedId=''}><option value="">Все типы</option>{#each Object.entries(types) as [key,label]}<option value={key}>{label}</option>{/each}</select></label><button onclick={()=>creating=!creating}>Добавить типизированную связь</button><button onclick={()=>expanded=!expanded}>{expanded ? 'Свернуть' : 'Развернуть'}</button></div><p class="relation-context mb-4">Связи дают контекст. Общий аккаунт не доказывает общего владельца и не добавляет баллы.</p>{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if mode==='graph'}<RelationGraph {workspace} relations={filtered} {centerId} {centerLabel} {selectedId} onselect={id=>selectedId=id} details={relationDetails}/>
{:else}<div class="space-y-3">{#each visible as r}<button class="relation-row" onclick={()=>selectedId=r.id}><span><b>{types[r.type]}</b> · {r.from} → {r.to}<small>{r.matchMethod}</small></span><span class="badge">{statusLabel(r.verificationStatus)}</span></button>{:else}<p class="muted">Связи по выбранной очереди пока не зафиксированы.</p>{/each}</div>{/if}
{#if mode==='list' && filtered.length>visible.length}<button class="mt-4" onclick={()=>limit+=40}>Скрыто ещё {filtered.length-visible.length} связей · показать ещё</button>{/if}
{#if creating}<form class="panel space-y-4 mt-4" onsubmit={e=>{e.preventDefault();void register();}}><h3>Новая связь · кандидат</h3><label>Откуда<select required bind:value={fromId}><option value="">Выберите сторону</option>{#each nodes as n}<option value={n.id}>{n.label}</option>{/each}</select></label><label>Куда<select required bind:value={toId}><option value="">Выберите сторону</option>{#each nodes as n}<option value={n.id}>{n.label}</option>{/each}</select></label><label>Тип отношения<select bind:value={relationType}>{#each Object.entries(types) as [key,label]}<option value={key}>{label}</option>{/each}</select></label><label>Первичные материалы отношения<select multiple bind:value={sourceIds}>{#each materials as a}<option value={a.id}>{a.source}</option>{/each}</select></label><p class="muted">Выберите один или несколько материалов. Подтверждение отношения — отдельное решение; риск R1–R6 не меняется.</p><button disabled={busy}>Сохранить кандидата связи</button></form>{/if}
{#if mode==='list'}{@render relationDetails()}{/if}</section>

<style>
 section.graph-expanded{display:flex;flex-direction:column;overflow:hidden;background:#f5f6f4;border-radius:4px;backdrop-filter:none}
 .relation-context{font-size:12px;color:#52615a;border-left:2px solid #a9b2ac;padding:2px 12px;line-height:1.5}
 :global(.network-inspector article.panel){border:0;padding:0;box-shadow:none;border-radius:0;background:transparent;margin-top:0}
 :global(.network-inspector article p){font-size:12px;margin:10px 0;line-height:1.6}
 :global(.network-inspector article h3){font-size:15px}
 :global(.network-inspector article .actions){gap:6px}
 :global(.network-inspector article button),:global(.network-inspector article a.button){font-size:12px;padding:7px 10px;box-shadow:none;border-radius:3px}
</style>
