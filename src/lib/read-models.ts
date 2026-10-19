import type { AppState } from './types';
import { caseComplex, latestCaseAssertions, previewCaseSignal } from './investigation';
import { computeScore } from './scoring';
export const phasesForComplex = (state: AppState, complexId: string) => (state.phases ?? []).filter(p => p.complexId === complexId);
export const casesForComplex = (state: AppState, complexId: string, phaseId?: string) => (state.cases ?? []).filter(c => c.complexId === complexId && c.phaseId === phaseId);
export const relationsForComplex=(state:AppState,complexId:string,phaseId?:string)=>(state.relations ?? []).filter(r=>r.complexId===complexId && r.phaseId===phaseId);
export function caseReadModel(state: AppState, caseId: string) {
  const investigation = state.cases?.find(c => c.id === caseId);
  if(!investigation) throw new Error('Дело не найдено');
  return { investigation, complex:caseComplex(state,investigation), assertions:latestCaseAssertions(state,caseId), artifacts:(state.artifacts ?? []).filter(a => investigation.artifactIds.includes(a.id)), snapshots:(state.caseSnapshots ?? []).filter(s => s.caseId === caseId), preview:previewCaseSignal(state,caseId) };
}
export function dossierReadModel(state: AppState, complexId: string, phaseId?: string) {
  const complex = state.complexes.find(z => z.id === complexId);
  if(!complex) throw new Error('Объект не найден');
  if(phaseId && !state.phases?.some(p => p.id === phaseId && p.complexId === complexId)) throw new Error('Очередь не найдена');
  const cases=casesForComplex(state,complexId,phaseId);
  const activeCase=cases.filter(c => c.status === 'draft').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
  const latestCase=[...cases].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
  const factors=latestCase ? caseComplex(state,latestCase).factors : phaseId ? [] : complex.factors;
  return {complex,phase:state.phases?.find(p=>p.id===phaseId && p.complexId===complexId),phases:phasesForComplex(state,complexId),cases,activeCase,artifacts:(state.artifacts ?? []).filter(a=>a.complexId===complexId && a.phaseId===phaseId),claims:(state.claims ?? []).filter(c=>c.complexId===complexId && c.phaseId===phaseId),factors,...computeScore(factors)};
}
