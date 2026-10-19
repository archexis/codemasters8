import type { AppState, Complex, Evidence, ExtractedClaim, FactAssertion, InvestigationCommand, InvestigationCase, SignalMaterialManifest } from './types';
import { computeScore, SIGNAL_WEIGHTS_VERSION } from './scoring';
import { validateFactor } from './domain';
import { periodContains, dateWithinPeriod } from './applicability';
import { relationEndpointExists } from './validation';

const unknownBasis = () => ({ type: 'unknown' as const, status: 'unknown' as const, source: '', checkedAt: '', reviewText: '' });
export function latestCaseAssertions(state: AppState, caseId: string): FactAssertion[] {
  const latest = new Map<string, FactAssertion>();
  for (const assertion of state.assertions ?? []) if (assertion.caseId === caseId) latest.set(assertion.claimId, assertion);
  return [...latest.values()];
}
/** Append a review requirement when the underlying legal/readiness record changes. */
export function invalidateCaseAssertions(next: AppState, previous: AppState, complexId: string, actor: string, at: string): void {
  const before=previous.complexes.find(z => z.id === complexId);
  const after=next.complexes.find(z => z.id === complexId);
  if(!before || !after) return;
  const legalChanged=JSON.stringify(before.legalBasis)!==JSON.stringify(after.legalBasis);
  const readinessChanged=JSON.stringify([before.readinessClaimed,before.readinessClaimedSource,before.readinessConfirmed,before.readinessSources])!==JSON.stringify([after.readinessClaimed,after.readinessClaimedSource,after.readinessConfirmed,after.readinessSources]);
  if(!legalChanged && !readinessChanged) return;
  for(const item of next.cases ?? []) {
    if(item.complexId !== complexId) continue;
    const stale=latestCaseAssertions(next,item.id).filter(a => a.status === 'verified' && !item.phaseId && ((legalChanged && a.code === 'R1') || (readinessChanged && a.code === 'R5')));
    for(const assertion of stale) next.assertions!.push({...assertion,id:crypto.randomUUID(),status:'candidate',actor,at,comment:`Повторная проверка: изменились ${assertion.code === 'R1' ? 'сведения о законном основании' : 'наблюдения готовности'}`});
    if(stale.length) { item.status='draft'; item.updatedAt=at; }
  }
}
export function caseComplex(state: AppState, investigation: InvestigationCase): Complex {
  const original = state.complexes.find(z => z.id === investigation.complexId);
  if (!original) throw new Error('Объект не найден');
  const complex = structuredClone(original);
  if (investigation.phaseId) {
    const phase = state.phases?.find(p => p.id === investigation.phaseId && p.complexId === original.id);
    if (!phase) throw new Error('Очередь не найдена');
    complex.legalBasis = structuredClone(phase.legalBasis ?? unknownBasis());
    // Only independently recorded phase observations can establish a phase readiness gap.
    complex.readinessClaimed=phase.readinessClaimed ?? null; complex.readinessClaimedSource=structuredClone(phase.readinessClaimedSource ?? null);
    complex.readinessConfirmed=phase.readinessConfirmed ?? null; complex.readinessSources=structuredClone(phase.readinessSources ?? []);
  }
  complex.factors = latestCaseAssertions(state, investigation.id).map(a => ({ code:a.code, status:a.status === 'verified' ? 'confirmed' : a.status === 'candidate' ? 'needs-verification' : 'rejected', evidence:a.evidence, reviewer:a.actor, updatedAt:a.at }));
  return complex;
}
export function validateFactApplicability(state: AppState, item: InvestigationCase, claim: ExtractedClaim, evidence: Evidence): void {
  const phase=state.phases?.find(p=>p.id===item.phaseId);
  if(phase?.period && item.period && !periodContains(phase.period,item.period)) throw new Error('Период дела вне области очереди');
  if(phase?.period && claim.period && !periodContains(phase.period,claim.period)) throw new Error('Период утверждения вне области очереди');
  if(item.period && (!claim.period || !periodContains(claim.period,item.period))) throw new Error('Период утверждения не покрывает период дела');
  const effective=item.period ?? claim.period;
  if(!effective) return;
  if(claim.code==='R1') {
    const basis=caseComplex(state,item).legalBasis;
    if(!basis.period || !periodContains(basis.period,effective)) throw new Error('Применимость законного основания к периоду дела не установлена');
  }
  if(claim.code==='R3') {
    const ad=state.ads.find(a=>a.id===evidence.adId);
    if(!ad?.date || !dateWithinPeriod(ad.date,effective) || !dateWithinPeriod(evidence.date,effective)) throw new Error('Для R3 даты публикации и доказательства должны входить в период дела');
  }
}
export function previewCaseSignal(state: AppState, caseId: string) {
  const investigation = state.cases?.find(c => c.id === caseId);
  if (!investigation) throw new Error('Дело не найдено');
  const complex = caseComplex(state, investigation);
  const assertions = latestCaseAssertions(state, caseId);
  const artifacts = (state.artifacts ?? []).filter(a => investigation.artifactIds.includes(a.id));
  const relations=structuredClone((state.relations ?? []).filter(r=>r.complexId===investigation.complexId && r.phaseId===investigation.phaseId && r.sourceArtifactIds.some(id=>investigation.artifactIds.includes(id))));
  const adIds=new Set([...artifacts.map(a=>a.adId),...assertions.map(a=>a.evidence.adId)].filter(Boolean));
  const ads=structuredClone(state.ads.filter(ad=>adIds.has(ad.id) && ad.zkId===investigation.complexId));
  const mediaIds=new Set([...artifacts.map(a=>a.mediaId),...assertions.flatMap(a=>a.evidence.mediaIds ?? [])].filter(Boolean));
  const mediaManifest:SignalMaterialManifest[]=state.media.filter(m=>mediaIds.has(m.id) && m.zkId===investigation.complexId).map(m=>({kind:'media',id:m.id,name:m.name,mediaKind:m.kind,path:m.path,sha256:m.sha256 ?? null,bytes:m.bytes ?? null,capturedAt:m.capturedAt ?? m.date,note:m.note}));
  const limitations: string[] = [];
  if(!investigation.period) limitations.push('Период применимости не установлен');
  if(investigation.phaseId && (complex.readinessClaimed==null || complex.readinessConfirmed==null)) limitations.push('Наблюдения готовности конкретной очереди не установлены');
  if (complex.legalBasis.status === 'unknown') limitations.push('Применимое законное основание не установлено');
  if (!complex.bin) limitations.push('БИН не указан');
  const claimIds = new Set(assertions.map(a => a.claimId));
  if (assertions.some(a => a.status === 'candidate') || (state.claims ?? []).some(c => c.complexId === investigation.complexId && c.phaseId === investigation.phaseId && !claimIds.has(c.id))) limitations.push('Есть непроверенные утверждения');
  return { complex, relations,period:structuredClone(investigation.period),phase:structuredClone(state.phases?.find(p => p.id === investigation.phaseId)), assertions:structuredClone(assertions), artifacts:structuredClone(artifacts), ads, mediaManifest, ...computeScore(complex.factors), weightsVersion:SIGNAL_WEIGHTS_VERSION, limitations, demo:complex.demo === true || complex.origin === 'demo' };
}

/** Called by the workspace reducer after runtime parsing. Never mutates the input state. */
export function applyInvestigationCommand(state: AppState, cmd: InvestigationCommand, actor: string, commandId?: string): AppState {
  if (!actor.trim()) throw new Error('Нужен авторизованный аналитик');
  if (commandId && state.audit.some(e => e.commandId === commandId)) return structuredClone(state);
  const next = structuredClone(state);
  next.phases ??= []; next.artifacts ??= []; next.claims ??= []; next.assertions ??= []; next.cases ??= []; next.caseSnapshots ??= [];
  next.relations ??= [];
  const at = new Date().toISOString();
  const findCase = (id: string, active = false) => {
    const item = next.cases!.find(c => c.id === id);
    if (!item) throw new Error('Дело не найдено');
    if (active && item.status !== 'draft') throw new Error('Откройте дело на доработку перед изменением');
    return item;
  };
  const scope = (complexId: string, phaseId?: string) => {
    if (!next.complexes.some(z => z.id === complexId)) throw new Error('Объект не найден');
    if (phaseId && !next.phases!.some(p => p.id === phaseId && p.complexId === complexId)) throw new Error('Очередь относится к другому объекту или не найдена');
  };
  const unique = (items: {id:string}[], id:string) => { if(items.some(i => i.id === id)) throw new Error('Идентификатор уже существует'); };
  let complexId = '';
  let auditBefore:unknown;
  let auditAfter:unknown;
  switch(cmd.type) {
    case 'relation.register': {
      const relation=cmd.relation; scope(relation.complexId,relation.phaseId);complexId=relation.complexId;unique(next.relations,relation.id);
      if(relation.fromId===relation.toId || !relationEndpointExists(next,relation.fromId) || !relationEndpointExists(next,relation.toId)) throw new Error('Выберите разные существующие стороны связи');
      for(const id of relation.sourceArtifactIds) if(!next.artifacts.some(a=>a.id===id && a.complexId===complexId && a.phaseId===relation.phaseId)) throw new Error('Источник связи относится к другому объекту или очереди');
      next.relations.push({...relation,verificationStatus:'candidate',capturedAt:at,actor});break;
    }
    case 'relation.review': {
      const relation=next.relations.find(r=>r.id===cmd.relationId);if(!relation) throw new Error('Связь не найдена');complexId=relation.complexId;
      auditBefore=structuredClone(relation);
      if(cmd.status==='verified') {
        if(!relation.sourceArtifactIds.length) throw new Error('Проверка связи требует хотя бы один первичный материал');
        if(!relationEndpointExists(next,relation.fromId) || !relationEndpointExists(next,relation.toId)) throw new Error('Сторона связи не найдена');
        for(const id of relation.sourceArtifactIds) if(!next.artifacts.some(a=>a.id===id && a.complexId===complexId && a.phaseId===relation.phaseId)) throw new Error('Источник связи относится к другому объекту или очереди');
      }
      Object.assign(relation,{verificationStatus:cmd.status,reviewedBy:actor,reviewedAt:at,reviewComment:cmd.comment});auditAfter=structuredClone(relation);break;
    }
    case 'geometry.register': {
      scope(cmd.geometry.complexId,cmd.geometry.phaseId); complexId=cmd.geometry.complexId;
      next.geometries ??= []; unique(next.geometries,cmd.geometry.id); next.geometries.push(cmd.geometry); break;
    }
    case 'phase.create': case 'phase.update': {
      scope(cmd.phase.complexId); complexId = cmd.phase.complexId;
      if(cmd.type === 'phase.create') { unique(next.phases,cmd.phase.id); next.phases.push(cmd.phase); }
      else {
        const phase = next.phases.find(p => p.id === cmd.phase.id && p.complexId === complexId);
        if (!phase) throw new Error('Очередь не найдена');
        if(cmd.phase.period && [...next.cases.filter(c=>c.phaseId===phase.id),...next.claims.filter(c=>c.phaseId===phase.id)].some(c=>c.period && !periodContains(cmd.phase.period!,c.period))) throw new Error('Период очереди не покрывает уже созданные дела или утверждения');
        const legalChanged=JSON.stringify([phase.legalBasis,phase.period])!==JSON.stringify([cmd.phase.legalBasis,cmd.phase.period]);
        if(legalChanged && next.cases.some(c => c.phaseId === phase.id && latestCaseAssertions(next,c.id).some(a => a.status === 'verified' && a.code === 'R1'))) throw new Error('Основание очереди связано с решением R1: сначала пересмотрите факт');
        const oldSources=phase.readinessSources ?? [], newSources=cmd.phase.readinessSources ?? [];
        if(oldSources.length>newSources.length || oldSources.some((source,index)=>JSON.stringify(source)!==JSON.stringify(newSources[index]))) throw new Error('Сохранённые наблюдения очереди неизменяемы: добавьте новое наблюдение');
        const readinessChanged=JSON.stringify([phase.readinessClaimed,phase.readinessClaimedSource,phase.readinessConfirmed,oldSources])!==JSON.stringify([cmd.phase.readinessClaimed,cmd.phase.readinessClaimedSource,cmd.phase.readinessConfirmed,newSources]);
        Object.assign(phase, cmd.phase);
        if(readinessChanged) for(const item of next.cases.filter(c=>c.phaseId===phase.id)) {
          const stale=latestCaseAssertions(next,item.id).filter(a=>a.status==='verified' && a.code==='R5');
          for(const assertion of stale) next.assertions.push({...assertion,id:crypto.randomUUID(),status:'candidate',actor,at,comment:'Повторная проверка: изменились наблюдения готовности очереди'});
          if(stale.length) {item.status='draft';item.updatedAt=at;}
        }
      }
      break;
    }
    case 'artifact.register': {
      const a=cmd.artifact; scope(a.complexId,a.phaseId); complexId=a.complexId; unique(next.artifacts,a.id);
      if(a.adId && !next.ads.some(ad => ad.id === a.adId && ad.zkId === complexId && ad.text === a.text)) throw new Error('Артефакт не совпадает с исходной публикацией');
      if(a.mediaId && !next.media.some(m => m.id === a.mediaId && m.zkId === complexId)) throw new Error('Файл относится к другому объекту или не найден');
      next.artifacts.push({...a,origin:a.origin ?? 'manual',availability:a.availability ?? 'ok',capturedAt:at}); break;
    }
    case 'case.create': {
      scope(cmd.complexId,cmd.phaseId); complexId=cmd.complexId; unique(next.cases,cmd.id);
      const phase=next.phases.find(p=>p.id===cmd.phaseId);
      if(phase?.period && cmd.period && !periodContains(phase.period,cmd.period)) throw new Error('Период дела вне области очереди');
      next.cases.push({id:cmd.id,complexId,phaseId:cmd.phaseId,title:cmd.title,period:cmd.period,owner:actor,status:'draft',artifactIds:[],createdAt:at,updatedAt:at}); break;
    }
    case 'claim.propose': {
      const claim=cmd.claim; scope(claim.complexId,claim.phaseId); complexId=claim.complexId; unique(next.claims,claim.id);
      const artifact=next.artifacts.find(a => a.id === claim.artifactId);
      if(!artifact || artifact.complexId !== complexId || artifact.phaseId !== claim.phaseId) throw new Error('Утверждение и материал имеют разную область применимости');
      if(!artifact.text.includes(claim.quote)) throw new Error('Цитата отсутствует в исходном тексте');
      const phase=next.phases.find(p=>p.id===claim.phaseId);
      if(phase?.period && claim.period && !periodContains(phase.period,claim.period)) throw new Error('Период утверждения вне области очереди');
      if(claim.hypothesisId && !claim.runId) throw new Error('Гипотеза требует runId');
      const quoteStart=artifact.text.indexOf(claim.quote);
      next.claims.push({...claim,quoteStart,quoteEnd:quoteStart+claim.quote.length}); break;
    }
    case 'ai.review': {
      const claim=next.claims.find(c => c.id === cmd.claimId); if(!claim) throw new Error('Утверждение не найдено'); complexId=claim.complexId;
      const artifact=next.artifacts.find(a => a.id === claim.artifactId);
      if(cmd.decision === 'accepted' && !artifact?.text.includes(claim.quote)) throw new Error('Цитата отсутствует в исходном тексте');
      Object.assign(claim,{triage:cmd.decision,triagedBy:actor,triagedAt:at,triageComment:cmd.comment}); break;
    }
    case 'case.attach': {
      const item=findCase(cmd.caseId,true); complexId=item.complexId;
      const artifact=next.artifacts.find(a => a.id === cmd.artifactId);
      if(!artifact || artifact.complexId !== complexId || artifact.phaseId !== item.phaseId) throw new Error('Материал относится к другому ЖК или очереди');
      if(!item.artifactIds.includes(artifact.id)) item.artifactIds.push(artifact.id); item.updatedAt=at; break;
    }
    case 'fact.review': {
      const item=findCase(cmd.caseId,true); complexId=item.complexId;
      const claim=next.claims.find(c => c.id === cmd.claimId);
      if(!claim || claim.complexId !== complexId || claim.phaseId !== item.phaseId || !item.artifactIds.includes(claim.artifactId)) throw new Error('Утверждение не входит в активное дело');
      const artifact=next.artifacts.find(a => a.id === claim.artifactId)!;
      if(!artifact.text.includes(claim.quote)) throw new Error('Цитата отсутствует в исходном тексте');
      const evidence: Evidence={...cmd.evidence,id:cmd.evidence.id ?? crypto.randomUUID(),zkId:complexId,kind:cmd.evidence.kind ?? (artifact.kind === 'publication' ? 'publication' : artifact.kind === 'legal-review' ? 'legal-review' : 'document'),date:cmd.evidence.date ?? artifact.date ?? (cmd.status === 'rejected' ? at : ''),quote:claim.quote,adId:artifact.adId,runId:claim.runId,hypothesisId:claim.hypothesisId};
      if(cmd.evidence.zkId && cmd.evidence.zkId !== complexId) throw new Error('Доказательство относится к другому объекту');
      if(cmd.status === 'verified') {
        if(!evidence.date) throw new Error('Укажите дату доказательства');
        if(evidence.mediaIds?.some(id => !next.media.some(m => m.id === id && m.zkId === complexId))) throw new Error('Файл доказательства не найден');
        validateFactor(next,caseComplex(next,item),claim.code,'confirmed',evidence);
        validateFactApplicability(next,item,claim,evidence);
      }
      next.assertions.push({id:crypto.randomUUID(),caseId:item.id,claimId:claim.id,code:claim.code,status:cmd.status,period:structuredClone(item.period ?? claim.period),evidence,actor,at,comment:cmd.comment}); item.updatedAt=at; break;
    }
    case 'case.decide': {
      const item=findCase(cmd.caseId,true); complexId=item.complexId; const preview=previewCaseSignal(next,item.id);
      if(cmd.status === 'confirmed') {
        if(!preview.confirmed.length) throw new Error('Нет подтверждённых факторов');
        for(const fact of preview.complex.factors.filter(f => f.status === 'confirmed')) validateFactor(next,preview.complex,fact.code,'confirmed',fact.evidence!);
        for(const assertion of preview.assertions.filter(a=>a.status==='verified')) validateFactApplicability(next,item,next.claims.find(c=>c.id===assertion.claimId)!,assertion.evidence);
      }
      next.caseSnapshots.push({id:commandId ?? crypto.randomUUID(),caseId:item.id,complexId,phaseId:item.phaseId,relations:preview.relations,period:preview.period,revision:1+next.caseSnapshots.filter(s => s.caseId === item.id).reduce((max,s)=>Math.max(max,s.revision),0),status:cmd.status,actor,at,comment:cmd.comment,complex:preview.complex,phase:preview.phase,assertions:preview.assertions,artifacts:preview.artifacts,ads:preview.ads,mediaManifest:preview.mediaManifest,score:preview.score,zone:preview.zone,weightsVersion:preview.weightsVersion,limitations:preview.limitations,demo:preview.demo});
      item.status=cmd.status; item.updatedAt=at; break;
    }
    case 'case.reopen': { const item=findCase(cmd.caseId); complexId=item.complexId; item.status='draft'; item.updatedAt=at; break; }
  }
  next.audit.unshift({id:crypto.randomUUID(),commandId,zkId:complexId,actorId:actor,at,reviewer:actor,action:cmd.type,comment:'comment' in cmd ? cmd.comment : '',before:auditBefore,after:auditAfter,details:structuredClone(cmd)});
  return next;
}
