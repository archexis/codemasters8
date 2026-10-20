import {test,expect} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {buildBackup} from '../../src/lib/backup';
import {dossierRelations,dossierTimeline} from '../../src/lib/dossier-context';
import {previewCaseSignal} from '../../src/lib/investigation';

test('real case A/B/C scores, scope rejection and immutable historical PDF',async({},info)=>{
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 const url=process.env.SAQ_LIVE_SUPABASE_URL!,key=process.env.SAQ_LIVE_SUPABASE_KEY!;
 const admin=createClient(url,process.env.SAQ_LIVE_SERVICE_KEY!,options),client=createClient(url,key,options);
 const email=`cases-${randomUUID()}@example.test`,password=randomUUID()+'Aa9!';
 const created=await admin.auth.admin.createUser({email,password,email_confirm:true});expect(created.error).toBeNull();
 try {
  const signed=await client.auth.signInWithPassword({email,password});expect(signed.error).toBeNull();
  let current=(await client.rpc('initialize_workspace')).data;
  const send=async(command:object)=>{const r=await client.rpc('apply_command',{command,expected_version:current.version,command_id:randomUUID()});expect(r.error).toBeNull();current=r.data;};
  const proof:any[]=[];
  for(const [complexId,score,zone,codes] of [['SQ-001',35,'yellow',['R2','R3']],['SQ-002',70,'red',['R1','R2','R3']],['SQ-003',10,'green',['R3']]] as const) {
   const complex=current.data.complexes.find((z:any)=>z.id===complexId);
   const caseId='CASE-'+randomUUID();await send({type:'case.create',id:caseId,complexId});
   for(const code of codes) {
    const factor=complex.factors.find((f:any)=>f.code===code);
    const ad=code==='R1'?undefined:current.data.ads.find((a:any)=>a.id===factor.evidence.adId);
    const artifactId='ART-'+randomUUID(),claimId='CL-'+randomUUID();
    const text=code==='R1'?complex.legalBasis.reviewText:ad.text;
    const quote=code==='R1'?text:factor.evidence.quote;
    await send({type:'artifact.register',artifact:{id:artifactId,complexId,kind:code==='R1'?'legal-review':'publication',source:'Synthetic live acceptance',text,date:'2026-10-19',...(ad?{adId:ad.id}:{})}});
    await send({type:'claim.propose',claim:{id:claimId,complexId,artifactId,code,quote,reason:'Синтетическая приёмка'}});
    await send({type:'case.attach',caseId,artifactId});
    await send({type:'fact.review',caseId,claimId,status:'verified',comment:'Сверено человеком для synthetic приёмки',evidence:{source:'Synthetic live acceptance',date:'2026-10-19',text:code==='R3'?'2026-10-19: синтетический акт: объект не введён на дату публикации.':text}});
   }
   await send({type:'case.decide',caseId,status:'confirmed',comment:'Synthetic A/B/C independent case review'});
   const v1=structuredClone(current.data.caseSnapshots.find((s:any)=>s.caseId===caseId));
   expect(v1.score).toBe(score);expect(v1.zone).toBe(zone);expect(v1.actor).toBe(email);
   const headers={authorization:`Bearer ${signed.data.session!.access_token}`};
   const pdfUrl=`http://127.0.0.1:8005/api/cases/${caseId}/snapshots/${v1.id}/pdf`;
   const response=await fetch(pdfUrl,{headers});expect(response.status).toBe(200);
   const pdf=new Uint8Array(await response.arrayBuffer());expect(new TextDecoder().decode(pdf.slice(0,5))).toBe('%PDF-');await writeFile(info.outputPath(`${complexId}-v1.pdf`),pdf);
   await send({type:'case.reopen',caseId,comment:'Проверка неизменности версии'});
   const fact=current.data.assertions.find((a:any)=>a.caseId===caseId);
   await send({type:'fact.review',caseId,claimId:fact.claimId,status:'rejected',comment:'Уточнена применимость',evidence:{source:'Повторная synthetic сверка'}});
   const phaseId='PH-'+randomUUID();await send({type:'phase.create',phase:{id:phaseId,complexId,name:'Другая очередь'}});
   const artifactId='ART-'+randomUUID();await send({type:'artifact.register',artifact:{id:artifactId,complexId,phaseId,kind:'document',source:'Synthetic other phase',text:'Материал только другой очереди'}});
   const denied=await client.rpc('apply_command',{command:{type:'case.attach',caseId,artifactId},expected_version:current.version,command_id:randomUUID()});expect(denied.error).not.toBeNull();
   await send({type:'case.decide',caseId,status:'returned',comment:'Повторная проверка источника'});
   expect(current.data.caseSnapshots.find((s:any)=>s.id===v1.id)).toEqual(v1);
   expect(new Uint8Array(await (await fetch(pdfUrl,{headers})).arrayBuffer())).toEqual(pdf);
   proof.push({complexId,caseId,snapshotId:v1.id,score,zone,actor:v1.actor,at:v1.at});
  }
  // A shared account is contextual evidence, not attribution of common ownership.
  const account='synthetic-shared-'+randomUUID(),adIds:string[]=[];
  for(const complexId of ['SQ-001','SQ-002']) {
   const id='AD-'+randomUUID();adIds.push(id);
   await send({type:'ad',ad:{id,zkId:complexId,platform:'Telegram',account,date:null,url:'https://example.test/'+id,captureAt:new Date().toISOString(),text:'Synthetic publication for shared account '+account},decision:'saved',comment:'Synthetic account match; ownership is unverified'});
  }
  const candidate=dossierRelations(current.data,'SQ-001').find(r=>r.type==='same_ad_account'&&adIds.every(id=>r.sourceEvidenceIds.includes(id)));
  expect(candidate?.verificationStatus).toBe('candidate');
  expect(dossierTimeline(current.data,'SQ-001').find(e=>e.id===adIds[0])?.occurredAt).toBeNull();
  const material='ART-'+randomUUID(),relationId='LINK-'+randomUUID(),caseId='CASE-'+randomUUID();
  await send({type:'artifact.register',artifact:{id:material,complexId:'SQ-001',kind:'relationship',source:'Synthetic review of two originals',text:`Account ${account}; original publications ${adIds.join(', ')}. Account match does not establish common ownership.`}});
  await send({type:'relation.register',relation:{id:relationId,complexId:'SQ-001',fromId:'complex:SQ-001',toId:'complex:SQ-002',relationType:'same_ad_account',sourceArtifactIds:[material],matchMethod:'manual'}});
  await send({type:'relation.review',relationId,status:'verified',comment:'Only the account match is verified against the two originals'});
  await send({type:'case.create',id:caseId,complexId:'SQ-001'});await send({type:'case.attach',caseId,artifactId:material});
  expect(previewCaseSignal(current.data,caseId).score).toBe(0);
  await send({type:'case.decide',caseId,status:'returned',comment:'Context only; risk facts require review'});
  const relationSnapshot=structuredClone(current.data.caseSnapshots.at(-1));
  expect(relationSnapshot.relations.find((r:any)=>r.id===relationId)).toMatchObject({verificationStatus:'verified',reviewedBy:email});
  await send({type:'relation.review',relationId,status:'rejected',comment:'Context applicability withdrawn'});
  expect(current.data.caseSnapshots.find((s:any)=>s.id===relationSnapshot.id)).toEqual(relationSnapshot);
  const {manifest}=await buildBackup(current.data,new Map());
  const restoredUser=await admin.auth.admin.createUser({email:`restore-${randomUUID()}@example.test`,password,email_confirm:true});expect(restoredUser.error).toBeNull();
  try {
   const target=createClient(url,key,options);expect((await target.auth.signInWithPassword({email:restoredUser.data.user!.email!,password})).error).toBeNull();
   const restored=await target.rpc('restore_workspace',{backup:{manifest,workspace:current.data,staged:[]}});expect(restored.error).toBeNull();
   const data=restored.data.data;
   expect(data.cases.every((c:any)=>c.status==='draft')).toBe(true);
   expect(data.assertions.every((a:any)=>a.status!=='verified')).toBe(true);
   expect(data.caseSnapshots).toHaveLength(current.data.caseSnapshots.length);
   expect(data.caseSnapshots.every((s:any)=>s.imported===true)).toBe(true);
   expect(data.caseSnapshots.map((s:any)=>s.id)).toEqual(current.data.caseSnapshots.map((s:any)=>s.id));
   expect((await target.rpc('restore_workspace',{backup:{manifest,workspace:current.data,staged:[]}})).error).not.toBeNull();
   await target.auth.signOut();
  } finally {expect((await admin.auth.admin.deleteUser(restoredUser.data.user!.id)).error).toBeNull();}
  await writeFile(info.outputPath('live-scenarios.json'),JSON.stringify({scenarios:proof,relationId,relationSnapshotId:relationSnapshot.id,sourcePublicationIds:adIds,unknownEventDate:true,restoreCaseCount:current.data.cases.length},null,2));
  await info.attach('live-scenarios',{body:JSON.stringify(proof),contentType:'application/json'});
 } finally {await client.auth.signOut();expect((await admin.auth.admin.deleteUser(created.data.user!.id)).error).toBeNull();}
});
