import {sourceManifest} from './source-manifest.mjs';
import {mkdirSync,copyFileSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const selected=process.argv[2]; if(selected&&!/^\.temp\/s6-rc-\d+$/.test(selected))throw Error('Unsafe clean-room path');
const root=resolve(selected||'.temp/s6-rc-'+Date.now());mkdirSync(root,{recursive:true});
const manifest=sourceManifest();
const docs=['README.md','docs/RELEASE_RUNBOOK.md','docs/DEMO_SCRIPT.md','backend/__init__.py','backend/Dockerfile'];
for(const p of [...Object.keys(manifest),...docs]) {const target=resolve(root,p);mkdirSync(dirname(target),{recursive:true});copyFileSync(p,target);if(manifest[p]!==undefined&&createHash('sha256').update(readFileSync(target)).digest('hex')!==manifest[p])throw Error('Copy hash mismatch: '+p);}
const npm=process.env.npm_execpath || execFileSync('where.exe',['npm.cmd'],{encoding:'utf8'}).trim().split(/\r?\n/)[0].replace(/npm.cmd$/,'node_modules/npm/bin/npm-cli.js');
const log=[];
const run=(exe,args)=>{const r=spawnSync(exe,args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:10*1024*1024});log.push({command:[exe,...args].join(' '),exit:r.status,stdout:r.stdout,stderr:r.stderr});writeFileSync('docs/acceptance/s6/clean-room-log.json',JSON.stringify(log,null,2));if(r.status!==0)throw Error('Clean room failed: '+args.join(' '));};
writeFileSync('docs/acceptance/s6/clean-room.json',JSON.stringify({status:'IN_PROGRESS',root,manifest},null,2));
run(process.execPath,[npm,'ci']);run(process.execPath,[npm,'run','check']);run(process.execPath,[npm,'run','build']);
if(!selected)run(resolve('backend/.venv/Scripts/python.exe'),['-m','venv',resolve(root,'backend/.venv')]);
run(resolve(root,'backend/.venv/Scripts/python.exe'),['-m','pip','install','-r','backend/requirements.lock.txt']);
run(resolve(root,'backend/.venv/Scripts/python.exe'),['-m','pytest','backend/tests','-q']);
writeFileSync('docs/acceptance/s6/clean-room.json',JSON.stringify({status:'PASS',root,manifest,profiles:['npm ci','T','B','locked Python install','A'],note:'Browser DEMO and connected are run separately from this directory; no env/dependencies copied.'},null,2)+'\n');console.log(root);
