import {describe,it,expect} from 'vitest';
import {initialState,applyCommand} from '../../src/lib/domain';
import {claimsForMaterial,buildFactReview,inPreparationScope,preparationJob,deliverPreparation} from '../../src/lib/preparation';
import {demoRunFor} from '../../src/lib/analysis';
import {previewCaseSignal} from '../../src/lib/investigation';
import type {Command} from '../../src/lib/types';
function setup(){
 let state=initialState();const complexId=state.complexes[0].id;
 state=applyCommand(state,{type:'ad',ad:{id:'prep-ad',zkId:complexId,text:'Депозит 300 000 тенге.',date:'2026-10-20',captureAt:'2026-10-20T00:00:00Z',platform:'web',account:'account',url:'https://example.com'},decision:'saved',comment:''},'analyst');
 state=applyCommand(state,{type:'artifact.register',artifact:{id:'prep-art',complexId,adId:'prep-ad',kind:'publication',source:'Оригинал',date:'2026-10-20',text:'Депозит 300 000 тенге.'}},'analyst');
 state=applyCommand(state,{type:'case.create',id:'prep-case',complexId},'analyst');
 return state;
}
describe('automatic case preparation',()=>{
 it('proposes exact local-parser candidates, deduplicates and never scores or triages them',()=>{
  let state=setup();const c=state.cases![0],a=state.artifacts![0];
  const run=demoRunFor({text:a.text,zkId:c.complexId,url:'',account:'',date:a.date!,platform:'web'});
  const commands=claimsForMaterial(state,c,a,{engine:run.engine,realAI:false,hypotheses:run.hypotheses});
  expect(commands.length).toBeGreaterThan(0);
  for(const command of commands)state=applyCommand(state,command,'analyst');
  expect(state.claims!.every(claim=>a.text.includes(claim.quote)&&!claim.triage&&!claim.runId)).toBe(true);
  expect(claimsForMaterial(state,c,a,{engine:run.engine,realAI:false,hypotheses:run.hypotheses})).toEqual([]);
  expect(previewCaseSignal(state,c.id).score).toBe(0);
  expect(state.assertions??[]).toEqual([]);
 });
 it('validates every selected fact before delivery including R1/R3 and unknown dates',()=>{
  let state=setup();const c=state.cases![0];
  for(const [id,code] of [['r2','R2'],['r1','R1'],['r3','R3']] as const)state=applyCommand(state,{type:'claim.propose',claim:{id,complexId:c.complexId,artifactId:'prep-art',code,quote:'Депозит'}},'analyst');
  expect(()=>buildFactReview(state,c.id,[],'verified','Сверено')).toThrow('Выберите');
  expect(()=>buildFactReview(state,c.id,['r2','r1'],'verified','Сверено')).toThrow('R1');
  expect(()=>buildFactReview(state,c.id,['r2','r3'],'verified','Сверено')).toThrow('R3');
  expect(state.assertions??[]).toEqual([]);
  const commands=buildFactReview(state,c.id,['r2'],'verified','Сверено');
  for(const command of commands)state=applyCommand(state,command,'analyst');
  expect(previewCaseSignal(state,c.id).score).toBe(25);
  state.artifacts![0].date=undefined;
  expect(()=>buildFactReview(state,c.id,['r2'],'verified','Сверено')).toThrow('дату');
 });
 it('does not assign another phase or undated material into a period',()=>{
  const state=setup(),c=state.cases![0],a=state.artifacts![0];
  expect(inPreparationScope(c,a)).toBe(true);
  expect(inPreparationScope({...c,phaseId:'p2'},a)).toBe(false);
  expect(inPreparationScope({...c,period:{from:'2026-10-21'}},a)).toBe(false);
  expect(inPreparationScope({...c,period:{from:'2026-10-01'}},{...a,date:undefined})).toBe(false);
 });
 it('resumes partial delivery using the original command IDs after a lost ACK',async()=>{
  const job=preparationJob('retry-test',1);const seen:Command[]=[];let lost=true;
  const commit=async(c:Command)=>{seen.push(c);if(seen.length===2&&lost){lost=false;throw new Error('ACK lost');}};
  const commands:Command[]=[{type:'case.attach',caseId:'case',artifactId:'a1'},{type:'case.attach',caseId:'case',artifactId:'a2'}];
  await expect(deliverPreparation(job,commands,commit,()=>{})).rejects.toThrow('ACK lost');
  expect(job.next).toBe(1);
  await deliverPreparation(job,[],commit,()=>{});
  expect(seen).toHaveLength(3);expect(seen[1]).toEqual(seen[2]);expect(job.pending).toEqual([]);
 });
});

it('does not attach trusted full-publication provenance to a truncated analysis window',()=>{
 const state=setup(),item=state.cases![0];
 const artifact={...state.artifacts![0],text:'Депозит 300 000 тенге.'+' '.repeat(20000)};
 const commands=claimsForMaterial(state,item,artifact,{engine:'LLM',realAI:true,runId:'run-window',hypotheses:[{id:'h-window',code:'R2',quote:'Депозит',reason:'Проверить'}]});
 expect(commands[0]).toMatchObject({type:'claim.propose',claim:{quote:'Депозит'}});
 if(commands[0].type==='claim.propose')expect(commands[0].claim.runId).toBeUndefined();
});
