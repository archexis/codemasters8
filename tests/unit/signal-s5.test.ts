import {describe,it,expect} from 'vitest';
import {initialState,applyCommand} from '../../src/lib/domain';
import {buildSignalSnapshot} from '../../src/lib/signal-snapshot';
import {buildExport} from '../../src/lib/export';
import {createTestDatabase,login,userA,command} from '../helpers/database';
const sig=(status:string)=>({type:'signal',zkId:'SQ-002',status,comment:'Проверка материалов'});
it('S5 captures full publications',()=>{const b=buildSignalSnapshot(initialState(),'SQ-002');expect(b.ads[0].text).toBeTruthy();});
it('S5 requires reopening decided signal',()=>{const s=applyCommand(initialState(),sig('confirmed'),'test');expect(()=>applyCommand(s,sig('returned'),'test')).toThrow(/пересмотр/);});
it('history export never resolves live object, ads or audit',()=>{
 let s=applyCommand(initialState(),sig('confirmed'),'test');const v1=JSON.stringify(s.signalVersions?.['SQ-002'][0]);const exp=buildExport(s,'SQ-002',1);expect(exp.version?.ads?.[0].text).toBeTruthy();expect(exp.version?.revision).toBe(1);
 s.ads=[];s.audit=[];s.complexes.find(z=>z.id==='SQ-002')!.name='NEW NAME';
 const after=buildExport(s,'SQ-002',1);expect({...after,exportedAt:''}).toEqual({...exp,exportedAt:''});expect(JSON.stringify(s.signalVersions?.['SQ-002'][0])).toBe(v1);
});
it('new facts create basedOn draft; returned keeps 45; v1 stays70',()=>{
 let s=applyCommand(initialState(),sig('confirmed'),'test');const v1=JSON.stringify(s.signalVersions?.['SQ-002'][0]);
 const f=s.complexes.find(z=>z.id==='SQ-002')!.factors.find(f=>f.code==='R2')!;
 s=applyCommand(s,{type:'factor',zkId:'SQ-002',code:'R2',status:'rejected',evidence:f.evidence,comment:'Предложение оплаты отозвано'},'test');
 expect(s.signals['SQ-002'].basedOnRevision).toBe(1);expect(buildSignalSnapshot(s,'SQ-002').score).toBe(45);
 s=applyCommand(s,sig('returned'),'test');expect(s.signalVersions?.['SQ-002'][1].score).toBe(45);expect(JSON.stringify(s.signalVersions?.['SQ-002'][0])).toBe(v1);
});
it('SQL transitions, replay, full snapshot and byte-equivalent v1',async()=>{
 const {db}=await createTestDatabase();try{await login(db,userA);await db.query('select initialize_workspace()');let version=1;
 const send=async(c:unknown,id:string)=>{const r=await db.query<{r:any}>('select apply_command($1::jsonb,$2,$3) r',[JSON.stringify(c),version,id]);version=r.rows[0].r.version;return r.rows[0].r;};
 const first=await send(sig('confirmed'),'s5-one');const v1=first.data.signalVersions['SQ-002'][0];expect(v1.ads[0].text).toBeTruthy();
 await expect(send(sig('returned'),'s5-denied')).rejects.toThrow(/REOPEN/);
 await send(sig('draft'),'s5-open');const second=await send(sig('returned'),'s5-return');expect(second.data.signalVersions['SQ-002'][0]).toEqual(v1);expect(second.data.signals['SQ-002'].basedOnRevision).toBe(1);
 const replay=await send(sig('confirmed'),'s5-one');expect(replay.replayed).toBe(true);expect(replay.data.signalVersions['SQ-002']).toHaveLength(2);
 }finally{await db.close();}
},120000);

it('authenticated fixture branch: immediate R2 rejection adds no points',async()=>{
 const {db}=await createTestDatabase();try{await login(db,userA);await db.query('select initialize_workspace()');
 const z={...initialState().complexes[0],id:'S5-REJECT',name:'Synthetic rejection branch',factors:[]};
 let r=await command(db,{type:'complex',complex:z},1);
 const input={zkId:z.id,text:'Депозит обязателен.',url:'https://example.test/branch',account:'fixture',date:'2026-10-18',platform:'fixture'};
 const hypotheses=[{id:'fixture-h2',code:'R2',quote:'Депозит',reason:'Synthetic authenticated fixture, no provider call'}];
 await db.exec('reset role');await db.query("insert into analysis_runs(id,owner_id,zk_id,input_snapshot,input_hash,status,hypotheses) values('s5-fixture-run',$1,$2,$3,'fixture','succeeded',$4)",[userA,z.id,JSON.stringify(input),JSON.stringify(hypotheses)]);await login(db,userA);
 r=await command(db,{type:'ad',ad:{...input,id:'s5-fixture-ad',captureAt:'2026-10-18T10:00:00Z',analysis:{engine:'authenticated fixture',realAI:true,runId:'s5-fixture-run',hypotheses}},decision:'rejected',hypothesis:{code:'R2',quote:'Депозит',runId:'s5-fixture-run',hypothesisId:'fixture-h2'},comment:'Отклонено аналитиком: платёжное предложение не принято'},r.version);
 expect(buildSignalSnapshot(r.data,z.id).score).toBe(0);expect(r.data.complexes.find(c=>c.id===z.id)?.factors[0].status).toBe('rejected');
 await expect(command(db,{type:'signal',zkId:z.id,status:'confirmed',comment:'Нет подтверждений'},r.version)).rejects.toThrow('NO_CONFIRMED_FACTORS');
 const returned=await command(db,{type:'signal',zkId:z.id,status:'returned',comment:'Возврат без подтверждённых факторов'},r.version);expect(returned.data.signalVersions?.[z.id][0].score).toBe(0);
 }finally{await db.close();}
},120000);
