import type {AppState,Media,RelationType} from './types';
import {constructionFrames,type ConstructionFrame} from './construction-images';
export interface DossierRelation {id:string;from:string;to:string;label:string;type:RelationType;sourceEvidenceIds:string[];verificationStatus:'candidate'|'verified'|'rejected';matchMethod:string;capturedAt:string;url?:string;stored?:boolean;fromId?:string;toId?:string}
export function relationNodes(state:AppState){
  const result=new Map<string,string>();
  for(const z of state.complexes){result.set(`complex:${z.id}`,z.name);if(z.bin)result.set(`organization:${z.bin}`,`${z.developer||'Организация'} · БИН ${z.bin}`);}
  for(const p of state.phases??[])result.set(`phase:${p.id}`,`${state.complexes.find(z=>z.id===p.complexId)?.name??p.complexId} / ${p.name}`);
  for(const a of state.ads){result.set(`publication:${a.id}`,`Публикация ${a.id}`);if(a.account)result.set(`account:${a.platform}:${a.account}`,`${a.platform} · ${a.account}`);}
  for(const a of state.artifacts??[])result.set(`document:${a.id}`,a.source);
  return [...result].map(([id,label])=>({id,label}));
}
export function dossierRelations(state:AppState,id:string,phaseId?:string):DossierRelation[] {
  const z=state.complexes.find(z=>z.id===id);if(!z)return [];
  const result:DossierRelation[]=[];
  if(z.developer) result.push({id:`developer-${id}`,from:z.developer,to:z.name,fromId:z.bin?`organization:${z.bin}`:`developer:${id}`,toId:`complex:${id}`,label:z.bin ? `БИН ${z.bin}` : 'БИН неизвестен',type:'developer_of',sourceEvidenceIds:z.sources.map((_,i)=>`${id}-source-${i}`),verificationStatus:'candidate',matchMethod:z.bin ? 'БИН из карточки; роль требует документа' : 'Название из карточки',capturedAt:'неизвестно',url:z.sources[0]?.url});
  const ads=state.ads.filter(a=>a.zkId===id);
  for(const ad of ads){
    if(!ad.account)continue;
    const artifact=state.artifacts?.find(a=>a.adId===ad.id && a.phaseId===phaseId);
    if(phaseId && !artifact)continue;
    result.push({id:`ad-${ad.id}`,from:`${ad.platform} · ${ad.account}`,to:z.name,fromId:`account:${ad.platform.trim().toLowerCase()}:${ad.account.trim().toLowerCase()}`,toId:`complex:${id}`,label:ad.text.slice(0,85),type:'advertises',sourceEvidenceIds:[artifact?.id ?? ad.id],verificationStatus:'candidate',matchMethod:'Аккаунт публикации; принадлежность не проверена',capturedAt:ad.captureAt,url:ad.url});
    for(const other of state.ads.filter(a=>a.zkId!==id && a.platform.trim().toLowerCase()===ad.platform.trim().toLowerCase() && a.account.trim().toLowerCase()===ad.account.trim().toLowerCase())) {
      const otherZ=state.complexes.find(z=>z.id===other.zkId);if(!otherZ)continue;
      const key=JSON.stringify(['account',...[id,other.zkId].sort(),ad.platform.trim().toLowerCase(),ad.account.trim().toLowerCase()]);
      const existing=result.find(r=>r.id===key);if(existing){existing.sourceEvidenceIds=[...new Set([...existing.sourceEvidenceIds,ad.id,other.id])];continue;}
      result.push({id:key,from:z.name,to:otherZ.name,fromId:`complex:${id}`,toId:`complex:${otherZ.id}`,label:`Общий аккаунт: ${ad.account}`,type:'same_ad_account',sourceEvidenceIds:[ad.id,other.id],verificationStatus:'candidate',matchMethod:'Точное совпадение площадки и аккаунта; не доказывает общего владельца',capturedAt:ad.captureAt,url:ad.url});
    }
  }
  for(const a of state.artifacts ?? []) if(a.complexId===id && a.phaseId===phaseId && (a.kind==='document'||a.kind==='legal-review'))result.push({id:`document-${a.id}`,from:a.source,to:z.name,fromId:`document:${a.id}`,toId:`complex:${id}`,label:a.text.slice(0,85),type:'covered_by',sourceEvidenceIds:[a.id],verificationStatus:'candidate',matchMethod:'Ручная привязка; применимость проверяется отдельно',capturedAt:a.capturedAt,url:a.url});
  const nodes=new Map(relationNodes(state).map(n=>[n.id,n.label]));
  for(const r of state.relations??[])if(r.complexId===id&&r.phaseId===phaseId){const artifact=state.artifacts?.find(a=>r.sourceArtifactIds.includes(a.id));result.unshift({id:r.id,from:nodes.get(r.fromId)??r.fromId,to:nodes.get(r.toId)??r.toId,fromId:r.fromId,toId:r.toId,label:r.reviewComment??'Контекстная связь; отдельная проверка роли',type:r.relationType,sourceEvidenceIds:r.sourceArtifactIds,verificationStatus:r.verificationStatus,matchMethod:r.matchMethod,capturedAt:r.capturedAt,url:artifact?.url,stored:true});}
  return result;
}
export interface DossierEvent {id:string;kind:'Документы'|'Стройка'|'Реклама'|'Решения';occurredAt:string|null;capturedAt:string|null;text:string;source:string;artifactId?:string;media?:Media;url?:string;illustration?:ConstructionFrame}
export function dossierTimeline(state:AppState,id:string,phaseId?:string):DossierEvent[]{
  const artifacts=(state.artifacts ?? []).filter(a=>a.complexId===id && a.phaseId===phaseId);
  const events:DossierEvent[]=artifacts.map(a=>({id:a.id,kind:a.kind==='publication' ? 'Реклама' : a.kind==='observation' ? 'Стройка' : 'Документы',occurredAt:a.date || null,capturedAt:a.capturedAt,text:a.text,source:a.source,artifactId:a.id,url:a.url,media:state.media.find(m=>m.id===a.mediaId)}));
  if(!phaseId){
    for(const frame of constructionFrames(state.complexes.find(z=>z.id===id)))events.push({id:frame.id,kind:'Стройка',occurredAt:frame.date,capturedAt:null,text:`AI-реконструкция ЖК «${frame.complexName}». Условная дата; вымышленная хронология строительства.`,source:'AI-визуализация · DEMO',illustration:frame});
    for(const a of state.ads.filter(a=>a.zkId===id))if(!artifacts.some(e=>e.adId===a.id))events.push({id:a.id,kind:'Реклама',occurredAt:a.date,capturedAt:a.captureAt,text:a.text,source:`${a.platform} · ${a.account}`,url:a.url});
    for(const m of state.media.filter(m=>m.zkId===id))if(!artifacts.some(a=>a.mediaId===m.id))events.push({id:m.id,kind:'Стройка',occurredAt:m.date || null,capturedAt:m.capturedAt ?? null,text:m.note || m.name,source:m.name,media:m});
    for(const [i,e] of (state.complexes.find(z=>z.id===id)?.events ?? []).entries())events.push({id:`legacy-${i}`,kind:'Стройка',occurredAt:e.date || null,capturedAt:null,text:e.text,source:'История карточки; первоисточник не указан'});
  }
  const caseIds=new Set((state.cases ?? []).filter(c=>c.complexId===id && c.phaseId===phaseId).map(c=>c.id));
  for(const snap of (state.caseSnapshots ?? []).filter(s=>caseIds.has(s.caseId)))events.push({id:snap.id,kind:'Решения',occurredAt:snap.at,capturedAt:snap.at,text:`${snap.status==='confirmed' ? 'Сигнал подтверждён' : 'Сигнал возвращён'}: ${snap.comment}`,source:snap.actor});
  return events.sort((a,b)=>(b.occurredAt ?? '').localeCompare(a.occurredAt ?? '') || a.id.localeCompare(b.id));
}
