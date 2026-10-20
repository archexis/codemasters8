import {supabase} from './supabase';
import {z} from 'zod';
async function apiFetch(path:string,init:RequestInit={}) {
  if(!supabase)throw new Error('Серверная обработка доступна после входа оператора. В DEMO используйте ручной текст и печать.');
  const {data,error}=await supabase.auth.getSession();
  if(error||!data.session)throw new Error('Войдите в персональное рабочее пространство.');
  const response=await fetch(`${import.meta.env.VITE_API_URL||'http://127.0.0.1:8000'}${path}`,{...init,headers:{...init.headers,Authorization:`Bearer ${data.session.access_token}`},signal:AbortSignal.timeout(45000)});
  if(!response.ok){const detail=await response.json().catch(()=>({detail:`HTTP ${response.status}`}));throw new Error(String(detail.detail||`HTTP ${response.status}`));}
  return response;
}
export async function downloadCasePdf(caseId:string,snapshotId:string){
  const response=await apiFetch(`/api/cases/${encodeURIComponent(caseId)}/snapshots/${encodeURIComponent(snapshotId)}/pdf`);
  const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download=`saq-${caseId}-${snapshotId}.pdf`;a.click();URL.revokeObjectURL(url);
}
export interface PdfExtraction {status:'candidate';sha256:string;bytes:number;pages:{page:number;text:string}[];limitations:string[]}
export async function extractPdf(file:File):Promise<PdfExtraction>{
  if(file.size>20*1024*1024)throw new Error('PDF превышает 20 МБ.');
  const response=await apiFetch('/api/import/pdf',{method:'POST',headers:{'Content-Type':'application/pdf'},body:file});
  return response.json();
}
export async function extractImage(file:File):Promise<{status:'candidate';text:string;limitations:string[]}>{
  if(file.size>20*1024*1024)throw new Error('Изображение превышает 20 МБ.');
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Поддерживаются PNG, JPEG и WebP.');
  const response=await apiFetch('/api/import/image',{method:'POST',headers:{'Content-Type':file.type},body:file});
  return response.json();
}

const sourceSchema=z.object({id:z.string().regex(/^[a-f0-9]{64}$/),url:z.url().refine(u=>u.startsWith('https://')),title:z.string().max(2000),text:z.string().max(30000),date:z.string().nullable(),capturedAt:z.number(),stage:z.string(),originalCaptured:z.boolean(),inPeriod:z.boolean(),match:z.enum(['obvious','uncertain']),matchReason:z.string(),engine:z.string(),candidates:z.array(z.object({code:z.enum(['R2','R3']),quote:z.string(),reason:z.string()})).max(6)});
const jobSchema=z.object({id:z.string(),status:z.enum(['queued','running','succeeded','failed']),createdAt:z.number(),error:z.string().nullable(),result:z.object({sources:z.array(sourceSchema).max(12),limitations:z.array(z.string()),searches:z.array(z.object({stage:z.string(),status:z.string(),domains:z.array(z.string())})),target:z.object({complex:z.object({id:z.string(),name:z.string(),address:z.string(),developer:z.string()}).passthrough(),phase:z.object({id:z.string(),name:z.string()}).nullable(),period:z.object({from:z.string(),to:z.string().optional()}).nullable(),domains:z.array(z.string()).optional()})}).nullable()});
const researchSchema=z.object({configured:z.boolean(),monitorConfigured:z.boolean(),domains:z.array(z.string()),job:jobSchema.nullable(),history:z.array(jobSchema),monitor:z.object({hours:z.number(),nextRunAt:z.number(),domains:z.array(z.string()).nullable().optional()}).nullable()});
export type ResearchStatus=z.infer<typeof researchSchema>;
export type ResearchSource=z.infer<typeof sourceSchema>;
export async function getResearch(caseId:string):Promise<ResearchStatus> {
  return researchSchema.parse(await (await apiFetch(`/api/cases/${encodeURIComponent(caseId)}/research`)).json());
}
export async function startResearch(caseId:string,domains?:string[]) {
  return (await apiFetch(`/api/cases/${encodeURIComponent(caseId)}/research`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({domains})})).json();
}
export async function setResearchMonitor(caseId:string,hours:number,domains?:string[]) {
  await apiFetch(`/api/cases/${encodeURIComponent(caseId)}/research/monitor`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({monitor_hours:hours,domains})});
}
