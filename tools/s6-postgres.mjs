// Disposable databases only; never resets the working Supabase database.
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
const container='supabase_db_saq-qurylys';
const run=(db,sql)=>execFileSync('docker',['exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],{input:sql,encoding:'utf8',maxBuffer:15*1024*1024});
let bootstrap=readFileSync('tests/helpers/database.ts','utf8').split('const BOOTSTRAP_SQL = `')[1].split('`;')[0].replace('create role anon; create role authenticated;','').replaceAll('${userA}','11111111-1111-4111-8111-111111111111').replaceAll('${userB}','22222222-2222-4222-8222-222222222222');
const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort(),report=[];
for(const mode of ['fresh','upgrade']) {
 const name=`s6_${mode}_${Date.now()}`; if(!/^s6_(fresh|upgrade)_\d+$/.test(name))throw Error('Unsafe DB name');
 run('postgres',`create database ${name};`);
 try {
  run(name,bootstrap);
  for(const [n,file] of files.entries()) {
   run(name,readFileSync('supabase/migrations/'+file,'utf8'));
   if(mode==='upgrade' && n===1)run(name,`set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111'; set role authenticated; select initialize_workspace();`);
  }
  const result=run(name,`set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111'; set role authenticated; select jsonb_array_length((initialize_workspace())->'data'->'complexes'); select data->>'schemaVersion' from workspaces; select count(*) from pg_proc where proname='apply_command' and pronamespace='public'::regnamespace;`);
  if(!result.includes('16')||!result.includes('3'))throw Error('Missing canonical seed/schema');
  report.push({mode,status:'PASS',database:name,migrations:files.length,result:result.trim(),scope:'actual PostgreSQL with isolated test auth/storage schemas; separate database, not production Supabase clone'});
 }finally{run('postgres',`drop database ${name} with (force);`);}
}
writeFileSync('docs/acceptance/s6/postgres.json',JSON.stringify(report,null,2)+'\n');console.log('PASS actual PostgreSQL fresh + legacy upgrade; disposable databases removed');
