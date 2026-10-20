import {it,expect} from 'vitest';
import {createTestDatabase,login,logoutAnon,userA,userB} from '../helpers/database';
import {previewLocalImport,localImportCommands} from '../../src/lib/registry-import';
import {loadStateFromText} from '../../src/lib/state-migrations';

it('commits registry batches atomically, fences stale previews, replays and isolates owners',async()=>{
  const {db}=await createTestDatabase();
  try{
    await login(db,userA);const init=(await db.query<{result:any}>('select public.initialize_workspace() as result')).rows[0].result;
    const preview=await previewLocalImport([{name:'Тест транзакции',city:'Өскемен',address:'Тестовая, 79',source_url:'https://krisha.kz/import-test/',developer_bin:'001234567890'}],['krisha'],init.data);
    const commands=await localImportCommands(preview,[preview.candidates[0].id],init.data);
    const id='registry-12345678-1234-4234-8234-123456789abc';
    const send=async(batch:any[],version:number,key=id)=>(await db.query<{result:any}>('select public.apply_registry_import($1::jsonb,$2,$3) as result',[JSON.stringify(batch),version,key])).rows[0].result;
    await expect(send([...commands,{type:'artifact.register',artifact:{id:'invalid',complexId:'missing',kind:'document',text:'x',source:'x'}}],init.version)).rejects.toThrow();
    expect((await db.query<{data:any}>('select data from public.workspaces')).rows[0].data).toEqual(init.data);
    const result=await send(commands,init.version);expect(result.replayed).toBe(false);
    const data=(await db.query<{data:any}>('select data from public.workspaces')).rows[0].data;
    expect(data.complexes).toHaveLength(init.data.complexes.length+1);expect(data.artifacts.find((a:any)=>a.complexId===preview.candidates[0].id).origin).toBe('import');expect(()=>loadStateFromText(JSON.stringify(data))).not.toThrow();
    expect(await send(commands,init.version)).toEqual({...result,replayed:true});
    await expect(send([],init.version)).rejects.toThrow('COMMAND_ID_REUSED');
    await expect(send([],init.version,'registry-22345678-1234-4234-8234-123456789abc')).rejects.toThrow('STALE_VERSION');
    await expect(send(commands,result.version,'registry-32345678-1234-4234-8234-123456789abc')).rejects.toThrow('IMPORT_OBJECT_EXISTS');
    await login(db,userB);await db.query('select public.initialize_workspace()');
    // The other owner has neither this receipt nor this imported object.
    const other=(await db.query<{data:any;version:number}>('select data,version from public.workspaces')).rows[0];expect(other.data.complexes.some((z:any)=>z.id===preview.candidates[0].id)).toBe(false);
    expect((await send(commands,other.version)).replayed).toBe(false);
    await logoutAnon(db);await expect(send([],0)).rejects.toThrow(/permission denied/);
  }finally{await db.close();}
},60000);
