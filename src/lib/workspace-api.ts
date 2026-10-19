import {supabase} from './supabase';
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
