import {describe,it,expect} from 'vitest';
import {initialState,applyCommand} from '../../src/lib/domain';
import {claimsForMaterial,buildFactReview,inPreparationScope,preparationJob,deliverPreparation,demoPreparationCommands} from '../../src/lib/preparation';
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
 it('verifies all six demo templates against a linked immutable publication without scoring before review',()=>{
  let state=setup();
  for(let pass=0;pass<6;pass++){
   const item=state.cases![0],id=`DEMO-review-${pass}`;
   for(const command of demoPreparationCommands(state,item,id))state=applyCommand(state,command,'demo');
   const artifact=state.artifacts!.find(a=>a.id===id)!,claim=state.claims!.find(c=>c.artifactId===id)!;
   expect(artifact.kind).toBe('publication');
   expect(state.ads.find(a=>a.id===artifact.adId)).toMatchObject({text:artifact.text,zkId:item.complexId,date:artifact.date});
   expect((state.assertions??[]).filter(a=>a.claimId===claim.id)).toEqual([]);
   for(const command of buildFactReview(state,item.id,[claim.id],'verified','Учебный оригинал сверён'))state=applyCommand(state,command,'analyst');
   expect(state.assertions!.at(-1)).toMatchObject({claimId:claim.id,status:'verified',evidence:{adId:artifact.adId,quote:claim.quote}});
   expect(previewCaseSignal(state,item.id).score).toBe(25);
  }
 });
 it('adds one different demo source and unchecked candidate per pass, including after template rotation',()=>{
  let state=setup();const texts=new Set<string>();
  for(let pass=0;pass<8;pass++){
   const item=state.cases![0],id=`DEMO-pass-${pass}`;
   const before={artifacts:state.artifacts!.length,claims:state.claims?.length??0};
   for(const command of demoPreparationCommands(state,item,id))state=applyCommand(state,command,'demo');
   const artifact=state.artifacts!.find(a=>a.id===id)!,claim=state.claims!.find(c=>c.artifactId===id)!;
   expect(state.artifacts).toHaveLength(before.artifacts+1);
   expect(state.claims).toHaveLength(before.claims+1);
   expect(artifact.origin).toBe('demo');expect(artifact.source).toContain('DEMO');
   expect(state.cases![0].artifactIds).toContain(id);
   expect(artifact.text).toContain(claim.quote);expect(claim.triage).toBeUndefined();
   texts.add(artifact.text);
   expect(demoPreparationCommands(state,state.cases![0],id)).toEqual([]);
   // Future passes over saved materials must not propose a second copy.
   const run=demoRunFor({text:artifact.text,zkId:item.complexId,url:'',account:'',date:artifact.date!,platform:artifact.source});
   expect(claimsForMaterial(state,state.cases![0],artifact,{engine:run.engine,realAI:false,hypotheses:run.hypotheses})).toEqual([]);
  }
  expect(texts.size).toBe(8);expect(state.assertions??[]).toEqual([]);
  expect(previewCaseSignal(state,state.cases![0].id).score).toBe(0);
 });
 it('keeps a demo source within the case phase and period and resumes partial registration',()=>{
  let state=setup();const complexId=state.cases![0].complexId;
  state=applyCommand(state,{type:'phase.create',phase:{id:'demo-phase',complexId,name:'Очередь 2'}},'demo');
  state=applyCommand(state,{type:'case.create',id:'demo-period-case',complexId,phaseId:'demo-phase',period:{from:'2026-01-01',to:'2026-01-31'}},'demo');
  let item=state.cases!.find(c=>c.id==='demo-period-case')!;
  const commands=demoPreparationCommands(state,item,'DEMO-period');
  state=applyCommand(state,commands[0],'demo');
  for(const command of demoPreparationCommands(state,item,'DEMO-period'))state=applyCommand(state,command,'demo');
  item=state.cases!.find(c=>c.id===item.id)!;
  expect(inPreparationScope(item,state.artifacts!.find(a=>a.id==='DEMO-period')!)).toBe(true);
  expect(state.claims!.find(c=>c.artifactId==='DEMO-period')).toMatchObject({phaseId:'demo-phase',period:item.period});
  expect(demoPreparationCommands(state,item,'DEMO-period')).toEqual([]);
 });
 it('proposes exact local-parser candidates, deduplicates and never scores or triages them',()=>{
  let state=setup();const c=state.cases![0],a=state.artifacts!.find(x=>x.id==='prep-art')!;
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
  state.artifacts!.find(x=>x.id==='prep-art')!.date=undefined;
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
