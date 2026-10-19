import {spawn,execFileSync} from 'node:child_process';
import {createWriteStream,writeFileSync} from 'node:fs';
import {sourceManifest} from './source-manifest.mjs';
const npm=process.env.npm_execpath || execFileSync('where.exe',['npm.cmd'],{encoding:'utf8'}).trim().split(/\r?\n/)[0].replace(/npm.cmd$/,'node_modules/npm/bin/npm-cli.js');
const profiles=[['T',process.execPath,[npm,'run','check']],['U',process.execPath,[npm,'test']],['B',process.execPath,[npm,'run','build']],['E',process.execPath,[npm,'run','test:e2e','--','--workers=1']],['C',process.execPath,['node_modules/@playwright/test/cli.js','test','--config','tools/acceptance.cloud.config.ts']],['A','backend/.venv/Scripts/python.exe',['-m','pytest','backend/tests','-q']],['F',process.execPath,[npm,'run','test:edge']],['F-types',process.execPath,[npm,'exec','--yes','--','deno','check','supabase/functions/analyze/index.ts']],['L',process.execPath,[npm,'run','test:local']]];
const results=[];
for(const [profile,exe,args] of profiles){
 const manifest=sourceManifest(),started=new Date().toISOString(),path=`docs/acceptance/s6/final-${profile}.log`,out=createWriteStream(path);
 console.log('START '+profile);
 const code=await new Promise((resolve,reject)=>{const child=spawn(exe,args,{windowsHide:true,env:{...process.env,NODE_OPTIONS:'--max-old-space-size=512'},stdio:['ignore','pipe','pipe']});child.stdout.pipe(out,{end:false});child.stderr.pipe(out,{end:false});child.on('error',reject);child.on('exit',resolve);});out.end();
 results.push({profile,command:[exe,...args].join(' '),exit:code,result:code===0?'PASS':'FAIL',started,finished:new Date().toISOString(),evidence:[path],manifest});
 writeFileSync('docs/acceptance/s6/profiles.json',JSON.stringify(results,null,2)+'\n'); console.log('END '+profile+' exit '+code);
}
if(results.some(r=>r.exit!==0))process.exitCode=1;
