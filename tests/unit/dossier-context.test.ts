import {describe,it,expect} from 'vitest';
import {initialState} from '../../src/lib/domain';
import {dossierRelations,dossierTimeline} from '../../src/lib/dossier-context';
describe('shared dossier context',()=>{
 it('does not turn a capture date into an unknown publication event date',()=>{
  const state=initialState();state.artifacts=[];state.ads=[{...state.ads[0],date:null,captureAt:'2026-10-19T12:00:00Z'}];
  const event=dossierTimeline(state,state.ads[0].zkId).find(e=>e.id===state.ads[0].id)!;
  expect(event.occurredAt).toBeNull();expect(event.capturedAt).toBe('2026-10-19T12:00:00Z');
 });
 it('a different phase cannot inherit another phase publication or legacy event',()=>{
  const state=initialState();const id=state.complexes[0].id;
  state.artifacts=[{id:'phase-one-report',complexId:id,phaseId:'one',kind:'document',source:'Инженерный отчёт',text:'Отчёт за июль',date:'2026-07-01',capturedAt:'2026-10-19T12:00:00Z'}];
  expect(dossierTimeline(state,id,'two')).toEqual([]);
  expect(dossierTimeline(state,id,'one')[0].occurredAt).toBe('2026-07-01');
 });
 it('shared advertising account is only a candidate with both originals, and needs same platform',()=>{
  const state=initialState();state.relations=[];const [a,b]=state.complexes;
  const template=state.ads[0];state.ads=[{...template,id:'ad-a',zkId:a.id,account:'shared',platform:'Telegram'},{...template,id:'ad-b',zkId:b.id,account:'shared',platform:'Telegram'}];
  const relation=dossierRelations(state,a.id).find(r=>r.type==='same_ad_account')!;
  expect(relation.verificationStatus).toBe('candidate');expect(relation.sourceEvidenceIds).toEqual(['ad-a','ad-b']);
  state.ads[1].platform='Instagram';expect(dossierRelations(state,a.id).filter(r=>r.type==='same_ad_account')).toEqual([]);
 });
});
