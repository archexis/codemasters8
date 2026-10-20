import Papa from 'papaparse';
import {z} from 'zod';
import type {AppState, Command, Complex} from './types';
import {isCalendarDate, parseCommand} from './validation';

export const importSources = [
  {id:'egov',name:'data.egov.kz',url:'https://data.egov.kz',type:'official_open_data',group:'Государственные реестры'},
  {id:'equrylys',name:'eQurylys',url:'https://reestr.equrylys.kz/organizations',type:'official_registry',group:'Проверка юридических лиц'},
  {id:'homeportal',name:'Homeportal',url:'https://homeportal.kz',type:'official_registry',group:'Государственные реестры'},
  {id:'krisha',name:'Krisha.kz',url:'https://krisha.kz/complex/search/ust-kamenogorsk/',type:'commercial_catalog',group:'Каталоги недвижимости'},
  {id:'developers',name:'Developers.kz',url:'https://developers.kz/market/oskemen',type:'commercial_catalog',group:'Каталоги недвижимости'},
] as const;
export type ImportSourceId = typeof importSources[number]['id'];
export const normalizeImportText=(v:string)=>v.normalize('NFKC').toLowerCase().replaceAll('ё','е').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
export const normalizeImportCity=(v:string)=>['өскемен','оскемен','усть каменогорск','ust kamenogorsk','oskemen'].includes(normalizeImportText(v))?'Өскемен':v.trim();
const nameKey=(v:string)=>normalizeImportText(v).replace(/^жк\s+/,'');
export const importIdentity=(r:{city:string;name:string;address:string})=>JSON.stringify([normalizeImportCity(r.city),nameKey(r.name),normalizeImportText(r.address)]);
const optionalText=z.preprocess(v=>v===''||v===undefined?null:v,z.string().trim().max(500).nullable());
const coordinate=(min:number,max:number)=>z.preprocess(v=>v===''||v==null?null:typeof v==='string'?Number(v):v,z.number().finite().min(min).max(max).nullable());
export const importRecordSchema=z.object({
  name:z.string().trim().min(1).max(300),city:z.string().trim().min(1).max(100).transform(normalizeImportCity),address:z.string().trim().min(1).max(500),
  developer:optionalText,developer_bin:optionalText.refine(v=>v===null||/^[0-9]{12}$/.test(v),'БИН должен содержать 12 цифр'),
  construction_status:z.preprocess(v=>v===''||v==null?'unknown':v,z.enum(['unknown','planned','under_construction','commissioned','on_hold'])),
  source_url:z.url().max(2000).refine(v=>{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.searchParams.has('apiKey');},'Нужна HTTPS-ссылка на источник без ключа API'),
  observed_at:optionalText.refine(v=>v===null||isCalendarDate(v),'Дата источника: YYYY-MM-DD или пустое значение'),
  lat:coordinate(-85.051129,85.051129),lng:coordinate(-180,180),
}).transform(r=>{
  const host=new URL(r.source_url).hostname;
  const source=importSources.find(s=>{const domain=new URL(s.url).hostname;return host===domain||host.endsWith(`.${domain}`);});
  if(!source)throw new Error('Источник должен относиться к одному из пяти выбранных каталогов или реестров.');
  if((r.lat===null)!==(r.lng===null))throw new Error('Укажите обе координаты или оставьте обе пустыми.');
  return {...r,source_id:source.id,source_type:source.type,verification_status:'unverified' as const};
});
export type ImportRecord=z.infer<typeof importRecordSchema>;
export interface ImportCandidate {id:string;record:ImportRecord;sources:ImportRecord[];existing_id:string|null;action:'create'|'enrich'|'duplicate'|'review';warnings:string[]}
export interface ImportPreview {id:string;status:string;created_at:string;expires_at:string|null;candidates:ImportCandidate[];errors:string[];sources:{id:string;status:string;message:string;count:number}[];geocoding?:{configured:boolean;attempted:number;matched:number;limit:number}}
export const stageLabel:Record<string,string>={unknown:'Стадия неизвестна',planned:'Планируется',under_construction:'Строится',commissioned:'Введён в эксплуатацию',on_hold:'Приостановлен'};
export async function importHash(value:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export const recordFingerprint=(r:ImportRecord)=>JSON.stringify([r.name,r.city,r.address,r.developer,r.developer_bin,r.construction_status,r.source_url,r.observed_at,r.lat,r.lng]);

export function parseImportFile(text:string,filename:string):unknown[]{
  if(new TextEncoder().encode(text).length>2*1024*1024)throw new Error('Выгрузка превышает 2 МБ.');
  if(filename.toLowerCase().endsWith('.json')){const value=JSON.parse(text);if(!Array.isArray(value))throw new Error('JSON должен содержать массив записей.');if(value.length>100)throw new Error('Не более 100 строк за один импорт.');return value;}
  const parsed=Papa.parse<Record<string,string>>(text,{header:true,skipEmptyLines:'greedy',transformHeader:h=>h.trim().replace(/^\uFEFF/,'')});
  if(parsed.errors.length)throw new Error(`Ошибка CSV: ${parsed.errors[0].message}`);
  if(parsed.data.length>100)throw new Error('Не более 100 строк за один импорт.');return parsed.data;
}

export async function previewLocalImport(raw:unknown[],chosen:ImportSourceId[],workspace:AppState):Promise<ImportPreview>{
  const errors:string[]=[];const records:ImportRecord[]=[];
  for(const [i,row] of raw.entries())try{const r=importRecordSchema.parse(row);if(r.city!=='Өскемен')throw new Error('Город вне выбранного региона');if(chosen.includes(r.source_id))records.push(r);}catch(e){errors.push(`Строка ${i+1}: ${e instanceof z.ZodError?e.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; '):e instanceof Error?e.message:String(e)}`);}
  const groups=new Map<string,ImportRecord[]>();for(const r of records){const key=importIdentity(r);const group=groups.get(key)??[];if(!group.some(s=>recordFingerprint(s)===recordFingerprint(r)))group.push(r);groups.set(key,group);}
  const candidates:ImportCandidate[]=[];
  for(const [identity,sources] of groups){
    const r=sources[0];const matches=workspace.complexes.filter(z=>!z.demo&&z.origin!=='demo'&&importIdentity(z)===identity);
    const existing=matches.length===1?matches[0]:null;const warnings:string[]=[];
    for(const field of ['developer_bin','developer','construction_status'] as const){const values=new Set(sources.map(s=>s[field]).filter(v=>v&&v!=='unknown').map(v=>normalizeImportText(v!)));if(values.size>1)warnings.push(`Источники расходятся: ${field}`);}
    const points=new Set(sources.filter(s=>s.lat!==null).map(s=>`${s.lat},${s.lng}`));if(points.size>1)warnings.push('Источники расходятся: координаты');
    if(matches.length>1)warnings.push('Несколько совпадений в рабочем пространстве');
    if(existing?.bin&&sources.some(s=>s.developer_bin&&s.developer_bin!==existing.bin))warnings.push('БИН отличается от сохранённого');
    if(workspace.complexes.some(z=>!z.demo&&z.origin!=='demo'&&normalizeImportCity(z.city)===r.city&&(nameKey(z.name)===nameKey(r.name)||normalizeImportText(z.address)===normalizeImportText(r.address))&&importIdentity(z)!==identity))warnings.push('Частичное совпадение названия или адреса: требуется ручное сопоставление');
    if([...groups.keys()].some(key=>{if(key===identity)return false;const other=groups.get(key)![0];return nameKey(other.name)===nameKey(r.name)||normalizeImportText(other.address)===normalizeImportText(r.address);}))warnings.push('Частичное совпадение внутри выгрузки: требуется ручное сопоставление');
    const merged={...r,construction_status:sources.find(s=>s.construction_status!=='unknown')?.construction_status??'unknown',developer:sources.find(s=>s.developer)?.developer??null,developer_bin:sources.find(s=>s.developer_bin)?.developer_bin??null,lat:sources.find(s=>s.lat!==null)?.lat??null,lng:sources.find(s=>s.lng!==null)?.lng??null};
    let action:ImportCandidate['action']=warnings.length?'review':existing?'enrich':'create';
    const sourceIds=await Promise.all(sources.map(async s=>`IMP-${(await importHash(recordFingerprint(s))).slice(0,48)}`));
    if(existing&&action!=='review'&&sourceIds.every(id=>(workspace.artifacts??[]).some(a=>a.complexId===existing.id&&a.id===id)))action='duplicate';
    if(merged.lat===null)warnings.push('Без координат: адрес ожидает ручной проверки; точка на карте не создаётся');
    candidates.push({id:`IMP-${(await importHash(identity)).slice(0,32)}`,record:merged,sources,existing_id:existing?.id??null,action,warnings});
  }
  return {id:crypto.randomUUID(),status:'preview',created_at:new Date().toISOString(),expires_at:null,candidates,errors,sources:chosen.map(id=>({id,status:records.some(r=>r.source_id===id)?'export':'not_configured',count:records.filter(r=>r.source_id===id).length,message:records.some(r=>r.source_id===id)?'Подготовленная выгрузка; подлинность требует проверки':'Прямой доступ не настроен. Загрузите разрешённую выгрузку.'}))};
}

export async function localImportCommands(preview:ImportPreview,ids:string[],workspace:AppState):Promise<Command[]>{
  const commands:Command[]=[];
  for(const c of preview.candidates.filter(c=>ids.includes(c.id))){
    if(c.action==='review'||c.action==='duplicate')continue;
    const r=c.record;const matches=workspace.complexes.filter(z=>!z.demo&&z.origin!=='demo'&&importIdentity(z)===importIdentity(r));
    if(matches.length>1||matches.some(z=>z.bin&&c.sources.some(s=>s.developer_bin&&s.developer_bin!==z.bin)))throw new Error('Сопоставление изменилось. Получите данные заново.');
    const existing=matches[0];const complexId=existing?.id??c.id;
    if(!existing){const complex:Complex={id:complexId,name:r.name,city:r.city,address:r.address,developer:r.developer??'',bin:r.developer_bin,lat:r.lat,lng:r.lng,demo:false,origin:'import',stage:stageLabel[r.construction_status],readinessClaimed:null,readinessConfirmed:null,readinessClaimedSource:null,readinessSources:[],legalBasis:{type:'unknown',status:'unknown',source:'',checkedAt:'',reviewText:''},note:'Импорт внешних данных. Сведения и роль застройщика требуют проверки.',factors:[],events:[],sources:[]};commands.push({type:'complex',complex});}
    for(const s of c.sources){const id=`IMP-${(await importHash(recordFingerprint(s))).slice(0,48)}`;const text=JSON.stringify({schema:'saq-registry-source/v1',...s,retrieved_at:preview.created_at,access_method:'prepared_export'},null,2);const found=workspace.artifacts?.find(a=>a.id===id);if(found){if(found.complexId!==complexId)throw new Error('Конфликт идентификатора источника');continue;}commands.push({type:'artifact.register',artifact:{id,complexId,kind:'document',origin:'import',availability:'ok',source:`${importSources.find(x=>x.id===s.source_id)!.name} · непроверенная выгрузка`,url:s.source_url,text,...(s.observed_at?{date:s.observed_at}:{})}});}
  }
  commands.forEach(parseCommand);return commands;
}
