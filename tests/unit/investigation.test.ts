import { describe, expect, it } from 'vitest';
import { applyCommand, initialState } from '../../src/lib/domain';
import type { AppState } from '../../src/lib/types';
import { previewCaseSignal } from '../../src/lib/investigation';
import { dossierReadModel } from '../../src/lib/read-models';
import { validateLoadedState } from '../../src/lib/validation';
import { applyImportTransform } from '../../src/lib/backup';
const actor='analyst@example.test';
function setup(phaseId?:string) {
  let state=initialState();
  const complexId=state.complexes[0].id;
  const ad={...state.ads[0],id:'flow-ad',zkId:complexId,text:'Бронь 300 000 тенге',date:'2026-10-19'};
  state=applyCommand(state,{type:'ad',ad,decision:'saved',comment:''},actor);
  if(phaseId) state=applyCommand(state,{type:'phase.create',phase:{id:phaseId,complexId,name:'Очередь 2'}},actor);
  state=applyCommand(state,{type:'artifact.register',artifact:{id:'artifact-flow',complexId,phaseId,kind:'publication',source:'Публикация',text:ad.text,date:'2026-10-19',adId:ad.id}},actor);
  state=applyCommand(state,{type:'claim.propose',claim:{id:'claim-flow',complexId,phaseId,artifactId:'artifact-flow',code:'R2',quote:'Бронь 300 000 тенге'}},actor);
  return {state,complexId};
}
function open(state:AppState,complexId:string,phaseId?:string) {
  state=applyCommand(state,{type:'case.create',id:'case-flow',complexId,phaseId},actor);
  return applyCommand(state,{type:'case.attach',caseId:'case-flow',artifactId:'artifact-flow'},actor);
}
function verify(state:AppState) {
  return applyCommand(state,{type:'fact.review',caseId:'case-flow',claimId:'claim-flow',status:'verified',evidence:{source:'Публикация',date:'2026-10-19'},comment:'Цитата сверена с оригиналом'},actor);
}
describe('investigation flow',()=>{
  it('preserves dossier factors when opening an untouched case without adopting them into its signal',()=>{
    let {state,complexId}=setup();
    const before=dossierReadModel(state,complexId);
    expect(before.score).toBeGreaterThan(0);
    state=open(state,complexId);
    expect(dossierReadModel(state,complexId)).toMatchObject({score:before.score,zone:before.zone,factors:before.factors});
    expect(previewCaseSignal(state,'case-flow').score).toBe(0);
    expect(()=>applyCommand(state,{type:'case.decide',caseId:'case-flow',status:'confirmed',comment:'Без проверки'},actor)).toThrow('Нет подтверждённых факторов');
    state=verify(state);
    expect(dossierReadModel(state,complexId).score).toBe(25);
    state=applyCommand(state,{type:'case.create',id:'new-empty-case',complexId},actor);
    state.cases!.find(c=>c.id==='new-empty-case')!.updatedAt='2099-01-01T00:00:00Z';
    expect(dossierReadModel(state,complexId).score).toBe(25);
    expect(previewCaseSignal(state,'new-empty-case').score).toBe(0);
  });
  it('keeps deliberate zero assessments and never restores baseline after a rejected fact or returned decision',()=>{
    let {state,complexId}=setup();
    state=open(state,complexId);
    state=applyCommand(state,{type:'fact.review',caseId:'case-flow',claimId:'claim-flow',status:'rejected',evidence:{source:'Публикация'},comment:'Не подтверждено'},actor);
    expect(dossierReadModel(state,complexId).score).toBe(0);
    const other=state.complexes[1].id;
    state=applyCommand(state,{type:'case.create',id:'empty-returned',complexId:other},actor);
    state=applyCommand(state,{type:'case.decide',caseId:'empty-returned',status:'returned',comment:'Возврат без фактов'},actor);
    state=applyCommand(state,{type:'case.reopen',caseId:'empty-returned',comment:'Пересмотр'},actor);
    expect(dossierReadModel(state,other).score).toBe(0);
  });
  it('preserves a previous phase assessment when another phase case is opened and does not inherit whole-complex factors',()=>{
    let {state,complexId}=setup('phase-two');
    state=open(state,complexId,'phase-two');
    expect(dossierReadModel(state,complexId,'phase-two').score).toBe(0);
    state=verify(state);
    state=applyCommand(state,{type:'case.create',id:'empty-phase-case',complexId,phaseId:'phase-two'},actor);
    state.cases!.find(c=>c.id==='empty-phase-case')!.updatedAt='2099-01-01T00:00:00Z';
    expect(dossierReadModel(state,complexId,'phase-two').score).toBe(25);
    expect(previewCaseSignal(state,'empty-phase-case').score).toBe(0);
    expect(dossierReadModel(state,complexId).score).toBe(35);
  });
  it('keeps triage separate from fact verification and immutable decisions',()=>{
    let {state,complexId}=setup();
    const original=structuredClone(state.complexes[0].factors);
    state=applyCommand(state,{type:'ai.review',claimId:'claim-flow',decision:'accepted',comment:'Извлечение верное'},actor);
    expect(state.assertions ?? []).toHaveLength(0);
    expect(state.complexes[0].factors).toEqual(original);
    state=open(state,complexId);
    expect(previewCaseSignal(state,'case-flow').score).toBe(0);
    state=verify(state);
    expect(previewCaseSignal(state,'case-flow')).toMatchObject({score:25,zone:'yellow'});
    state=applyCommand(state,{type:'case.decide',caseId:'case-flow',status:'confirmed',comment:'Проверенные факторы приняты'},actor,{commandId:'decision-one'});
    const snapshot=structuredClone(state.caseSnapshots![0]);
    expect(snapshot.ads?.map(a=>a.id)).toEqual(['flow-ad']);
    expect(applyCommand(state,{type:'case.decide',caseId:'case-flow',status:'confirmed',comment:'Проверенные факторы приняты'},actor,{commandId:'decision-one'})).toEqual(state);
    expect(()=>verify(state)).toThrow('доработку');
    state=applyCommand(state,{type:'case.reopen',caseId:'case-flow',comment:'Новый источник'},actor);
    state=applyCommand(state,{type:'fact.review',caseId:'case-flow',claimId:'claim-flow',status:'rejected',evidence:{source:'Публикация'},comment:'Уточнена применимость'},actor);
    expect(previewCaseSignal(state,'case-flow').score).toBe(0);
    expect(state.caseSnapshots![0]).toEqual(snapshot);
    expect(validateLoadedState(state).cases).toHaveLength(1);
  });
  it('requires active case and exact source quotes and rejects spoofed actors',()=>{
    const {state,complexId}=setup();
    expect(()=>verify(state)).toThrow('Дело');
    expect(()=>applyCommand(state,{type:'claim.propose',claim:{id:'fake',complexId,artifactId:'artifact-flow',code:'R2',quote:'Вымысел'}},actor)).toThrow('Цитата');
    expect(()=>applyCommand(state,{type:'case.create',id:'fake-case',complexId,owner:'spoof'},actor)).toThrow();
    expect(state.cases ?? []).toHaveLength(0);
  });
  it('isolates phases and never inherits legal basis or factors',()=>{
    let {state,complexId}=setup('phase-two');
    state=open(state,complexId,'phase-two');
    state=verify(state);
    expect(dossierReadModel(state,complexId,'phase-two')).toMatchObject({score:25,zone:'yellow'});
    expect(previewCaseSignal(state,'case-flow').complex.legalBasis.status).toBe('unknown');
    expect(dossierReadModel(state,complexId).cases).toHaveLength(0);
    state=applyCommand(state,{type:'case.decide',caseId:'case-flow',status:'confirmed',comment:'Публикация проверена'},actor);
    expect(validateLoadedState(state).caseSnapshots![0].complex.legalBasis.checkedAt).toBe('');
    state=applyCommand(state,{type:'phase.update',phase:{id:'phase-two',complexId,name:'Переименованная очередь'}},actor);
    expect(state.caseSnapshots![0].phase?.name).toBe('Очередь 2');
    state=applyCommand(state,{type:'case.create',id:'other-case',complexId},actor);
    expect(()=>applyCommand(state,{type:'case.attach',caseId:'other-case',artifactId:'artifact-flow'},actor)).toThrow('очереди');
  });
  it('checks persisted scope links and requires imported facts to be reviewed again',()=>{
    let {state,complexId}=setup();
    state=verify(open(state,complexId));
    const imported=applyImportTransform(state,'importer');
    expect(previewCaseSignal(imported,'case-flow').score).toBe(0);
    const damaged=structuredClone(state); damaged.cases![0].phaseId='missing-phase';
    expect(()=>validateLoadedState(damaged)).toThrow('очередь');
    expect(validateLoadedState(state).assertions).toHaveLength(1);
  });
  it('invalidates case decisions by appending candidates after underlying observations change',()=>{
    let state=initialState();
    const complex=state.complexes[1];
    state=applyCommand(state,{type:'readiness',zkId:complex.id,value:12,source:'Исходный акт измерения',date:'2026-10-19'},actor);
    state=applyCommand(state,{type:'case.create',id:'readiness-case',complexId:complex.id},actor);
    state=applyCommand(state,{type:'artifact.register',artifact:{id:'readiness-artifact',complexId:complex.id,kind:'observation',source:'Акт',text:'Готовность 12 процентов',date:'2026-10-19'}},actor);
    state=applyCommand(state,{type:'case.attach',caseId:'readiness-case',artifactId:'readiness-artifact'},actor);
    state=applyCommand(state,{type:'claim.propose',claim:{id:'readiness-claim',complexId:complex.id,artifactId:'readiness-artifact',code:'R5',quote:'Готовность 12 процентов'}},actor);
    state=applyCommand(state,{type:'fact.review',caseId:'readiness-case',claimId:'readiness-claim',status:'verified',evidence:{source:'Акт',date:'2026-10-19'},comment:'Сверены два источника'},actor);
    state=applyCommand(state,{type:'case.decide',caseId:'readiness-case',status:'confirmed',comment:'Проверен разрыв'},actor);
    const snapshot=structuredClone(state.caseSnapshots![0]);
    state=applyCommand(state,{type:'readiness',zkId:complex.id,value:50,source:'Новый акт',date:'2026-10-19'},actor);
    expect(state.assertions?.map(a=>a.status)).toEqual(['verified','candidate']);
    expect(state.cases![0].status).toBe('draft');
    expect(previewCaseSignal(state,'readiness-case').score).toBe(0);
    expect(state.caseSnapshots![0]).toEqual(snapshot);
    expect(()=>dossierReadModel(state,complex.id,'unknown-phase')).toThrow('Очередь');
  });
  it('freezes publication bytes metadata and separates source origin from availability',()=>{
    let {state,complexId}=setup();
    state.media.push({id:'media-shot',zkId:complexId,name:'screenshot.png',kind:'image',date:'2026-10-19',note:'Оригинал',ready:null,path:'private/media-shot.png',sha256:'a'.repeat(64),bytes:123});
    const original=state.artifacts![0];
    state=applyCommand(state,{type:'artifact.register',artifact:{id:'artifact-shot',complexId,kind:'publication',source:original.source,text:original.text,adId:original.adId,mediaId:'media-shot',origin:'import',availability:'unavailable'}},actor);
    state=open(state,complexId);
    state=applyCommand(state,{type:'case.attach',caseId:'case-flow',artifactId:'artifact-shot'},actor);
    state=verify(state);
    state=applyCommand(state,{type:'case.decide',caseId:'case-flow',status:'confirmed',comment:'Цитата и файл сверены'},actor);
    expect(state.caseSnapshots![0].mediaManifest![0]).toMatchObject({id:'media-shot',bytes:123,sha256:'a'.repeat(64),path:'private/media-shot.png'});
    state.media[0].name='Переименован.png';
    expect(state.caseSnapshots![0].mediaManifest![0].name).toBe('screenshot.png');
    expect(validateLoadedState(state).caseSnapshots![0].artifacts[1]).toMatchObject({origin:'import',availability:'unavailable'});
    const imported=applyImportTransform(state,'importer');
    expect(imported.caseSnapshots![0]).toMatchObject({imported:true,actor,status:'confirmed'});
    expect(()=>applyCommand(state,{type:'artifact.register',artifact:{id:'fake-official',complexId,kind:'document',source:'URL не доказывает происхождение',text:'Документ',origin:'official'}},actor)).toThrow('Официальное происхождение');
  });
  it('persists explicitly sourced geometry without changing risk and rejects invalid contours',()=>{
    const state=initialState(), complexId=state.complexes[0].id;
    const geometry={id:'contour-one',complexId,source:'Ручная сверка GeoJSON 19.10.2026',verified:true,coordinates:[[[71,51],[71.01,51],[71.01,51.01],[71,51]]] as [number,number][][],heightMeters:40};
    const next=applyCommand(state,{type:'geometry.register',geometry},actor);
    expect(next.complexes).toEqual(state.complexes);
    expect(validateLoadedState(next).geometries![0]).toEqual(geometry);
    expect(applyImportTransform(next,'importer').geometries![0].verified).toBe(false);
    for(const malformed of [{...geometry,heightMeters:1001},{...geometry,coordinates:[]},{...geometry,coordinates:[[[71,51],[71.01,51],[71.01,51.01],[72,51]]]},{...geometry,coordinates:[[[181,51],[71.01,51],[71.01,51.01],[181,51]]]},{...geometry,phaseId:'missing'}]) expect(()=>applyCommand(state,{type:'geometry.register',geometry:malformed},actor)).toThrow();
    expect(state.geometries).toBeUndefined();
  });
  it('does not use whole-complex readiness observations to verify a different phase',()=>{
    let state=initialState();const complexId=state.complexes[1].id;
    state=applyCommand(state,{type:'phase.create',phase:{id:'phase-no-readiness',complexId,name:'Очередь без наблюдений'}},actor);
    state=applyCommand(state,{type:'case.create',id:'phase-readiness-case',complexId,phaseId:'phase-no-readiness'},actor);
    state=applyCommand(state,{type:'artifact.register',artifact:{id:'phase-readiness-artifact',complexId,phaseId:'phase-no-readiness',kind:'observation',source:'Наблюдение',text:'Готовность 12 процентов',date:'2026-10-19'}},actor);
    state=applyCommand(state,{type:'case.attach',caseId:'phase-readiness-case',artifactId:'phase-readiness-artifact'},actor);
    state=applyCommand(state,{type:'claim.propose',claim:{id:'phase-readiness-claim',complexId,phaseId:'phase-no-readiness',artifactId:'phase-readiness-artifact',code:'R5',quote:'Готовность 12 процентов'}},actor);
    expect(()=>applyCommand(state,{type:'fact.review',caseId:'phase-readiness-case',claimId:'phase-readiness-claim',status:'verified',evidence:{source:'Наблюдение',date:'2026-10-19'},comment:'Нельзя переносить наблюдения'},actor)).toThrow('R5');
  });
  it('stores the source page and assigns quote offsets from the original including emoji',()=>{
    let state=initialState();const complexId=state.complexes[0].id;
    const artifact={id:'page-source',complexId,kind:'document',source:'PDF акт',text:'📄 Документ: Просрочка 12 месяцев.',pageNumber:7};
    state=applyCommand(state,{type:'artifact.register',artifact},actor);
    const claim={id:'page-claim',complexId,artifactId:artifact.id,code:'R6',quote:'Просрочка 12 месяцев.'};
    state=applyCommand(state,{type:'claim.propose',claim},actor);
    expect(state.claims![0]).toMatchObject({quoteStart:13,quoteEnd:34});
    expect(validateLoadedState(state).artifacts!.find(a=>a.id==='page-source')!.pageNumber).toBe(7);
    expect(()=>applyCommand(state,{type:'claim.propose',claim:{...claim,id:'spoof-offset',quoteStart:0,quoteEnd:3}},actor)).toThrow('неизвестные поля');
    expect(()=>applyCommand(state,{type:'artifact.register',artifact:{...artifact,id:'bad-page',pageNumber:0}},actor)).toThrow();
    const malformed=structuredClone(state);malformed.claims![0].quoteStart=0;
    expect(()=>validateLoadedState(malformed)).toThrow('положение цитаты');
  });
  it('requires explicit assertion coverage for a dated case and freezes its period',()=>{
    let {state,complexId}=setup();
    const period={from:'2026-10-01',to:'2026-10-31'};
    state=applyCommand(state,{type:'case.create',id:'case-flow',complexId,period},actor);
    state=applyCommand(state,{type:'case.attach',caseId:'case-flow',artifactId:'artifact-flow'},actor);
    expect(()=>verify(state)).toThrow('Период утверждения');
    state=applyCommand(state,{type:'claim.propose',claim:{id:'claim-dated',complexId,artifactId:'artifact-flow',code:'R2',quote:'Бронь 300 000 тенге',period:{from:'2026-01-01'}}},actor);
    state=applyCommand(state,{type:'fact.review',caseId:'case-flow',claimId:'claim-dated',status:'verified',evidence:{source:'Публикация',date:'2026-10-19'},comment:'Область применимости проверена'},actor);
    expect(state.assertions![0].period).toEqual(period);
    state=applyCommand(state,{type:'case.decide',caseId:'case-flow',status:'confirmed',comment:'Период проверен'},actor);
    expect(validateLoadedState(state).caseSnapshots![0].period).toEqual(period);
    expect(state.caseSnapshots![0].limitations).not.toContain('Период применимости не установлен');
    expect(()=>applyCommand(state,{type:'case.create',id:'reversed',complexId,period:{from:'2026-12-01',to:'2026-01-01'}},actor)).toThrow('Конец периода');
  });
  it('checks phase boundaries and legal basis coverage without inheriting coverage',()=>{
    let state=initialState();const complexId=state.complexes[0].id;
    const period={from:'2026-10-01',to:'2026-10-31'};
    state=applyCommand(state,{type:'phase.create',phase:{id:'dated-phase',complexId,name:'Датированная очередь',period,legalBasis:{type:'absent',status:'absent-verified',source:'Сверка',checkedAt:'2026-10-19',reviewText:'Проверены все применимые механизмы'}}},actor);
    expect(()=>applyCommand(state,{type:'case.create',id:'too-broad',complexId,phaseId:'dated-phase',period:{from:'2026-01-01'}},actor)).toThrow('Период дела');
    state=applyCommand(state,{type:'case.create',id:'legal-case',complexId,phaseId:'dated-phase',period},actor);
    state=applyCommand(state,{type:'artifact.register',artifact:{id:'legal-artifact',complexId,phaseId:'dated-phase',kind:'legal-review',source:'Сверка',text:'Проверены все применимые механизмы',date:'2026-10-19'}},actor);
    state=applyCommand(state,{type:'case.attach',caseId:'legal-case',artifactId:'legal-artifact'},actor);
    state=applyCommand(state,{type:'claim.propose',claim:{id:'legal-claim',complexId,phaseId:'dated-phase',artifactId:'legal-artifact',code:'R1',quote:'Проверены все применимые механизмы',period}},actor);
    const review={type:'fact.review',caseId:'legal-case',claimId:'legal-claim',status:'verified',evidence:{source:'Сверка',date:'2026-10-19',text:'Проверены все применимые механизмы'},comment:'Проверка применимости'};
    expect(()=>applyCommand(state,review,actor)).toThrow('Применимость законного основания');
    const phase=state.phases![0];
    state=applyCommand(state,{type:'phase.update',phase:{...phase,legalBasis:{...phase.legalBasis!,period}}},actor);
    state=applyCommand(state,review,actor);
    expect(previewCaseSignal(state,'legal-case').score).toBe(35);
    expect(()=>applyCommand(state,{type:'phase.update',phase:{...phase,period:{from:'2026-10-20',to:'2026-10-21'}}},actor)).toThrow('Период очереди');
  });
  it('does not use an advertisement outside the selected period as dated R3 evidence',()=>{
    let {state,complexId}=setup();
    const period={from:'2026-11-01',to:'2026-11-30'};
    state=applyCommand(state,{type:'case.create',id:'r3-dated-case',complexId,period},actor);
    state=applyCommand(state,{type:'case.attach',caseId:'r3-dated-case',artifactId:'artifact-flow'},actor);
    state=applyCommand(state,{type:'claim.propose',claim:{id:'r3-claim',complexId,artifactId:'artifact-flow',code:'R3',quote:'Бронь 300 000 тенге',period}},actor);
    expect(()=>applyCommand(state,{type:'fact.review',caseId:'r3-dated-case',claimId:'r3-claim',status:'verified',evidence:{source:'Публикация',date:'2026-11-03',text:'2026-11-03 объект не введён'},comment:'Реклама до ввода'},actor)).toThrow('даты публикации');
    expect(state.assertions ?? []).toHaveLength(0);
  });
  it('verifies phase R5 from its own sourced observations and invalidates only that phase',()=>{
    let state=initialState();const complexId=state.complexes[1].id;
    const phase={id:'observed-phase',complexId,name:'Очередь со своими наблюдениями',readinessClaimed:70,readinessClaimedSource:{value:70,source:'Заявление очереди',date:'2026-10-01'},readinessConfirmed:50,readinessSources:[{value:50,source:'Акт очереди',date:'2026-10-19'}]};
    state=applyCommand(state,{type:'phase.create',phase},actor);
    state=applyCommand(state,{type:'case.create',id:'observed-case',complexId,phaseId:phase.id},actor);
    state=applyCommand(state,{type:'artifact.register',artifact:{id:'observed-artifact',complexId,phaseId:phase.id,kind:'observation',source:'Акт очереди',text:'Готовность очереди составляет 50 процентов',date:'2026-10-19'}},actor);
    state=applyCommand(state,{type:'case.attach',caseId:'observed-case',artifactId:'observed-artifact'},actor);
    state=applyCommand(state,{type:'claim.propose',claim:{id:'observed-claim',complexId,phaseId:phase.id,artifactId:'observed-artifact',code:'R5',quote:'Готовность очереди составляет 50 процентов'}},actor);
    state=applyCommand(state,{type:'fact.review',caseId:'observed-case',claimId:'observed-claim',status:'verified',evidence:{source:'Акт очереди',date:'2026-10-19'},comment:'Проверен разрыв 20 п.п.'},actor);
    state=applyCommand(state,{type:'case.decide',caseId:'observed-case',status:'confirmed',comment:'Проверена готовность очереди'},actor);
    expect(state.caseSnapshots![0].score).toBe(10);
    state=applyCommand(state,{type:'readiness',zkId:complexId,value:52,source:'Акт всего ЖК',date:'2026-10-20'},actor);
    expect(previewCaseSignal(state,'observed-case').score).toBe(10);
    const updated={...phase,readinessConfirmed:55,readinessSources:[...phase.readinessSources,{value:55,source:'Новый акт очереди',date:'2026-10-20'}]};
    state=applyCommand(state,{type:'phase.update',phase:updated},actor);
    expect(previewCaseSignal(state,'observed-case').score).toBe(0);
    expect(state.assertions!.map(a=>a.status)).toEqual(['verified','candidate']);
    expect(state.caseSnapshots![0].score).toBe(10);
    expect(()=>applyCommand(state,{type:'phase.update',phase:{...updated,readinessSources:[{value:55,source:'Подмена акта',date:'2026-10-20'}]}},actor)).toThrow('неизменяемы');
    expect(()=>applyCommand(state,{type:'phase.update',phase:{...updated,readinessConfirmed:20}},actor)).toThrow('последним наблюдением');
    expect(validateLoadedState(state).phases![0].readinessConfirmed).toBe(55);
  });
  it('persists sourced typed relations with independent reviews and no automatic risk points',()=>{
    let {state,complexId}=setup();
    const relation={id:'typed-link',complexId,fromId:`complex:${complexId}`,toId:'publication:flow-ad',relationType:'advertises',sourceArtifactIds:['artifact-flow'],matchMethod:'manual'};
    const factors=structuredClone(state.complexes[0].factors);
    state=applyCommand(state,{type:'relation.register',relation},actor);
    expect(state.relations!.find(r=>r.id===relation.id)).toMatchObject({verificationStatus:'candidate',actor});
    state=applyCommand(state,{type:'relation.review',relationId:relation.id,status:'verified',comment:'Оригинал связывает рекламу с объектом'},actor);
    expect(state.relations!.find(r=>r.id===relation.id)!.verificationStatus).toBe('verified');
    expect(state.audit[0].before).toMatchObject({verificationStatus:'candidate'});
    expect(state.complexes[0].factors).toEqual(factors);
    state=open(state,complexId);state=verify(state);
    state=applyCommand(state,{type:'case.decide',caseId:'case-flow',status:'confirmed',comment:'Факт проверен отдельно от связи'},actor);
    expect(state.caseSnapshots![0].relations![0].verificationStatus).toBe('verified');
    state=applyCommand(state,{type:'relation.review',relationId:relation.id,status:'rejected',comment:'Область связи уточнена'},actor);
    expect(state.caseSnapshots![0].relations![0].verificationStatus).toBe('verified');
    expect(validateLoadedState(state).relations!.map(r=>r.id)).toContain('typed-link');
    const imported=applyImportTransform({...state,relations:[{...state.relations![0],verificationStatus:'verified'}]},'importer');
    expect(imported.relations![0].verificationStatus).toBe('candidate');
    expect(()=>applyCommand(state,{type:'relation.register',relation:{...relation,id:'self-link',toId:relation.fromId}},actor)).toThrow('разные');
    expect(()=>applyCommand(state,{type:'relation.register',relation:{...relation,id:'spoof-link',verificationStatus:'verified'}},actor)).toThrow();
    state=applyCommand(state,{type:'relation.register',relation:{...relation,id:'unsourced-link',sourceArtifactIds:[]}},actor);
    expect(()=>applyCommand(state,{type:'relation.review',relationId:'unsourced-link',status:'verified',comment:'Нет документа'},actor)).toThrow('первичный материал');
  });
  it('closes legacy confirmation routes once the complex has an investigation case',()=>{
    let {state,complexId}=setup();state=open(state,complexId);
    const ad={...state.ads.find(a=>a.id==='flow-ad')!,id:'old-route-ad'};
    for(const command of [
      {type:'factor',zkId:complexId,code:'R2',status:'confirmed',evidence:{source:'Публикация',adId:'flow-ad',quote:'Бронь 300 000 тенге'},comment:'Нельзя обойти дело'},
      {type:'ad',ad,hypothesis:{code:'R2',quote:'Бронь 300 000 тенге'},decision:'confirmed',comment:'Нельзя обойти дело'},
      {type:'signal',zkId:complexId,status:'confirmed',comment:'Нельзя обойти дело'},
    ]) expect(()=>applyCommand(state,command,actor)).toThrow('активном деле');
    const unchanged=state.complexes[0].factors;
    state=applyCommand(state,{type:'complex',complex:{...state.complexes[0],factors:[{code:'R1',status:'confirmed'}]}},actor);
    expect(state.complexes[0].factors).toEqual(unchanged);
  });
});
