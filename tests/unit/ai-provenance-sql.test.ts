import { expect, it } from 'vitest';
import { createTestDatabase, login, command, userA, userB } from '../helpers/database';

it('direct RPC checks all decisions, full metadata, code/quote and ownership atomically',async()=>{
  const {db}=await createTestDatabase();
  try {
    await login(db,userA); await db.query('select initialize_workspace()');
    const input={text:'Депозит обязателен. Строящийся дом.',zkId:'SQ-001',url:'https://example.test/post',account:'source',date:'2026-10-18',platform:'Ручной ввод'};
    const hypotheses=[{id:'h2',code:'R2',quote:'Депозит',reason:'оплата'},{id:'h3',code:'R3',quote:'Строящийся дом',reason:'стройка'}];
    await db.exec('reset role');
    await db.query(`insert into analysis_runs(id,owner_id,zk_id,input_snapshot,input_hash,status,hypotheses) values('run-a',$1,'SQ-001',$2,'hash','succeeded',$3),('run-b',$4,'SQ-001',$2,'hash','succeeded',$3)`,[userA,JSON.stringify(input),JSON.stringify(hypotheses),userB]);
    await login(db,userA);
    const ad={...input,id:'publication',captureAt:'2026-10-18T10:00:00Z',analysis:{realAI:true,engine:'model',runId:'run-a',hypotheses}};
    const base={type:'ad',ad,decision:'confirmed',comment:'Проверено предложение оплаты',hypothesis:{runId:'run-a',hypothesisId:'h2',code:'R2',quote:'Депозит'}};
    for(const decision of ['confirmed','rejected']) {
      for(const [key,value] of [['url','https://changed.test'],['account','changed'],['platform','changed'],['date','2026-10-17'],['text','changed']] ) {
        await expect(command(db,{...base,decision,ad:{...ad,[key]:value}},1)).rejects.toThrow('RUN_INPUT_MISMATCH');
      }
      await expect(command(db,{...base,decision,hypothesis:{...base.hypothesis,runId:'run-b'}},1)).rejects.toThrow('RUN_NOT_FOUND');
      await expect(command(db,{...base,decision,hypothesis:{...base.hypothesis,hypothesisId:'h3'}},1)).rejects.toThrow('RUN_QUOTE_MISMATCH');
    }
    await expect(command(db,{...base,ad:{...ad,analysis:{...ad.analysis,runId:undefined}}},1)).rejects.toThrow('TRUSTED_RUN_REQUIRED');
    const saved=await command(db,base,1); expect(saved.version).toBe(2);
    const factor={type:'factor',zkId:'SQ-001',code:'R3',status:'rejected',comment:'Не подтверждён ввод объекта',evidence:{source:'материал',date:'2026-10-18',kind:'publication',adId:ad.id,runId:'run-a',hypothesisId:'h3',quote:'Строящийся дом'}};
    for(const status of ['confirmed','rejected','needs-verification']) {
      await expect(command(db,{...factor,status,code:'R2'},2)).rejects.toThrow('RUN_QUOTE_MISMATCH');
      await expect(command(db,{...factor,status,evidence:{...factor.evidence,hypothesisId:undefined}},2)).rejects.toThrow('DANGLING_RUN_ID');
      await expect(command(db,{...factor,status,evidence:{...factor.evidence,quote:'выдумка'}},2)).rejects.toThrow('RUN_QUOTE_MISMATCH');
    }
    const done=await command(db,factor,2); expect(done.data.ads.filter(a=>a.id===ad.id)).toHaveLength(1);
    await expect(command(db,{...factor,status:'confirmed'},3)).rejects.toThrow('R3_REQUIRES_BEFORE_COMMISSIONING');
    const material={source:'Справка о вводе объекта',date:'2026-10-18',text:'На дату публикации объект не введён'};
    const verified=await command(db,{...factor,status:'confirmed',evidence:{...factor.evidence,text:material.text,beforeCommissioning:material}},3);
    expect(verified.data.complexes.find(z=>z.id==='SQ-001')?.factors.find(f=>f.code==='R3')?.evidence?.beforeCommissioning).toEqual(material);
    const signal=await command(db,{type:'signal',zkId:'SQ-001',status:'confirmed',comment:'Snapshot доверенных решений'},4);
    expect(signal.data.signalVersions?.['SQ-001'][0].aiProvenance?.find(p=>p.code==='R2')).toMatchObject({runId:'run-a',origin:'server',inputHash:'hash',reason:'оплата'});
    const z=done.data.complexes.find(z=>z.id==='SQ-001')!;
    expect(z.factors.find(f=>f.code==='R2')?.status).toBe('confirmed'); expect(z.factors.find(f=>f.code==='R3')?.status).toBe('rejected');
    const audits=done.data.audit.slice(0,2); expect(audits.map(a=>a.comment)).toEqual([factor.comment,base.comment]);
    await expect(db.query('insert into analysis_runs(id,owner_id,zk_id,input_snapshot,input_hash) values($1,$2,$3,$4,$5)',['forged',userA,'SQ-001','{}','x'])).rejects.toThrow(/permission denied/);
    await expect(db.query("update analysis_runs set status='succeeded' where id='run-a'")).rejects.toThrow(/permission denied/);
    await expect(db.query("delete from analysis_runs where id='run-a'")).rejects.toThrow(/permission denied/);
    const rows=await db.query('select id from analysis_runs'); expect(rows.rows).toEqual([{id:'run-a'}]);
  } finally {await db.close();}
},60000);
