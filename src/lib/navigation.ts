export type DossierTab = 'overview' | 'verification' | 'relations' | 'timeline';
export const dossierTabs: {id:DossierTab; label:string}[] = [
  {id:'overview',label:'Обзор'}, {id:'verification',label:'Проверка'},
  {id:'relations',label:'Связи'}, {id:'timeline',label:'Хронология'},
];
export function dossierUrl(id:string, phaseId?:string, tab:DossierTab='overview', evidenceId?:string) {
  const params=new URLSearchParams({tab});
  if(phaseId) params.set('phase',phaseId);
  if(evidenceId) params.set('evidence',evidenceId);
  return `#/complexes/${encodeURIComponent(id)}?${params}`;
}
export function normalizedRoute(hash:string) {
  const raw=hash.replace(/^#\//,'') || 'map';
  const [path,query='']=raw.split('?'); const [page,id]=path.split('/');
  const aliases:Record<string,string>={home:'map',overview:'map',ads:'publications',detail:'complexes'};
  return `${aliases[page] ?? page}${id ? '/'+id : ''}${query ? '?'+query : ''}`;
}
