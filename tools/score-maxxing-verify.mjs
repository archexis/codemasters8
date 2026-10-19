import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sourceManifest} from './source-manifest.mjs';
const runId=new Date().toISOString().replace(/[:.]/g,'-');
const dir=`test-results/score-maxxing/${runId}`;
await mkdir(dir,{recursive:true});
const report={startedAt:new Date().toISOString(),sourceByteManifest:sourceManifest(),checks:[]};
const npm=process.env.npm_execpath;
if(!npm)throw new Error('Run via npm run verify:score');
await writeFile('test-results/score-maxxing/latest-run.json',JSON.stringify({dir}));
for(const [id,args] of [
 ['check',['run','check']],['unit',['test','--','--reporter=json',`--outputFile=${dir}/unit.json`]],
 ['build',['run','build']],['e2e',['run','test:e2e','--','--reporter=line,json']],
 ['cloud',['run','test:cloud','--','--reporter=line,json']],['api',['run','test:api']],
 ['edge',['run','test:edge']],['edge-check',['exec','--yes','--','deno','check','supabase/functions/analyze/index.ts']],
]) {
 console.log(`START ${id}`);
 const env={...process.env,VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',PLAYWRIGHT_JSON_OUTPUT_FILE:`${dir}/${id}.json`};
 let output='';const startedAt=new Date().toISOString();
 const exitCode=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[npm,...args],{env,windowsHide:true});
  child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  child.on('error',reject);child.on('close',resolve);
 });
 await writeFile(`${dir}/${id}.log`,output);
 report.checks.push({id,command:`npm ${args.join(' ')}`,startedAt,finishedAt:new Date().toISOString(),exitCode,log:`${id}.log`});
 await writeFile(`${dir}/verification.json`,JSON.stringify(report,null,2));
 console.log(`${exitCode===0?'PASS':'FAIL'} ${id} (exit ${exitCode})`);
}
report.finishedAt=new Date().toISOString();
report.sourceUnchanged=JSON.stringify(sourceManifest())===JSON.stringify(report.sourceByteManifest);
report.sourceManifestSha256=createHash('sha256').update(JSON.stringify(report.sourceByteManifest)).digest('hex');
report.status=report.sourceUnchanged&&report.checks.every(c=>c.exitCode===0)?'OFFLINE_PASS':'FAIL';
await writeFile(`${dir}/verification.json`,JSON.stringify(report,null,2)+'\n');
console.log(`${report.status}: ${dir}`);
process.exitCode=report.status==='OFFLINE_PASS'?0:1;
