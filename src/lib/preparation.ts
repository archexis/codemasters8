import type {AppState, Command, EvidenceArtifact, InvestigationCase, Analysis} from './types';
import {applyCommand} from './domain';
import {dateWithinPeriod} from './applicability';
import {newCommandId, withCommandId} from './repository';

export function inPreparationScope(item:InvestigationCase, artifact:EvidenceArtifact) {
  return artifact.complexId===item.complexId && artifact.phaseId===item.phaseId
    && (!item.period || !!artifact.date && dateWithinPeriod(artifact.date,item.period));
}
export function claimsForMaterial(state:AppState,item:InvestigationCase,artifact:EvidenceArtifact,result:Analysis):Command[] {
  return result.hypotheses.filter(h=>h.quote.trim() && artifact.text.includes(h.quote)
    && !(state.claims??[]).some(c=>c.artifactId===artifact.id && c.code===h.code && c.quote===h.quote && JSON.stringify(c.period)===JSON.stringify(item.period)))
    .map(h=>({type:'claim.propose',claim:{id:`CL-${newCommandId()}`,complexId:item.complexId,...(item.phaseId?{phaseId:item.phaseId}:{}),artifactId:artifact.id,
      code:h.code,quote:h.quote,reason:`${result.realAI?'LLM':'Локальный parser, без LLM'} · ${result.engine}: ${h.reason}`,
      ...(item.period?{period:item.period}:{}),...(artifact.adId && artifact.text.length<=20000 && result.realAI && result.runId && h.id?{runId:result.runId,hypothesisId:h.id}:{})}}));
}

/** Validate the WHOLE explicit selection before committing its first command. */
export function buildFactReview(state:AppState,caseId:string,selected:string[],status:'verified'|'rejected',comment:string,factDate='',extra=''):Command[] {
  const item=state.cases?.find(c=>c.id===caseId);
  if(!item || item.status!=='draft')throw new Error('Откройте дело на доработку перед проверкой');
  if(!selected.length)throw new Error('Выберите хотя бы один факт');
  if(!comment.trim())throw new Error('Укажите обоснование проверки факта');
  const commands:Command[]=[];
  for(const id of new Set(selected)) {
    const claim=state.claims?.find(c=>c.id===id);
    const artifact=state.artifacts?.find(a=>a.id===claim?.artifactId);
    if(!claim || !artifact || claim.complexId!==item.complexId || claim.phaseId!==item.phaseId)throw new Error('Кандидат не относится к делу');
    if(status==='verified' && !factDate && !artifact.date)throw new Error('Укажите дату доказательства: дата первичного материала неизвестна.');
    if(status==='verified' && claim.code==='R3' && !extra.trim())throw new Error('Для R3 нужен отдельный датированный материал о состоянии до ввода');
    if(!item.artifactIds.includes(artifact.id))commands.push({type:'case.attach',caseId,artifactId:artifact.id});
    commands.push({type:'fact.review',caseId,claimId:claim.id,status,comment,evidence:{source:artifact.source,date:factDate||artifact.date||'',text:extra||artifact.text,
      ...(artifact.mediaId?{mediaIds:[artifact.mediaId]}:{}),...(claim.code==='R3'&&claim.runId?{beforeCommissioning:{source:artifact.source,date:factDate||artifact.date||'',text:extra}}:{})}});
  }
  let preview=state;
  for(const command of commands)preview=applyCommand(preview,command,'Предварительная проверка пакета');
  return commands;
}

// One delivery lane per case survives dossier remount/navigation. Commands keep their IDs after a lost ACK.
export interface PreparationJob {
  running:boolean; stage:string; error:string; notes:string[]; completed:number; total:number;
  pending:Command[]; next:number; session:number;
}
const jobs=new Map<string,PreparationJob>();
export function preparationJob(key:string,session:number):PreparationJob {
  let job=jobs.get(key);
  if(!job || job.session!==session) {
    job={running:false,stage:'Подготовка ещё не запускалась',error:'',notes:[],completed:0,total:0,pending:[],next:0,session};
    jobs.set(key,job);
  }
  return job;
}
export async function deliverPreparation(job:PreparationJob,commands:Command[],commit:(c:Command)=>Promise<void>,assertCurrent:()=>void) {
  if(!job.pending.length) {job.pending=commands.map(c=>withCommandId(c,newCommandId()));job.next=0;}
  while(job.next<job.pending.length) {
    assertCurrent(); await commit(job.pending[job.next]); assertCurrent();job.next++;
  }
  job.pending=[];job.next=0;
}
