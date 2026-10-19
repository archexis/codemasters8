import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const env=Object.fromEntries(readFileSync('.env.edge','utf8').split(/\r?\n/).filter(s=>s && !s.startsWith('#')).map(s=>{const n=s.indexOf('=');return [s.slice(0,n),s.slice(n+1).replace(/^['"]|['"]$/g,'')];}));
const local=JSON.parse(readFileSync('supabase/.temp/status.json','utf8').replace(/^\uFEFF/,''));
const secrets=[env.LLM_API_KEY,local.SERVICE_ROLE_KEY].filter(Boolean);
assert.equal(secrets.length,2,'Real configured provider and server writer must be checked');
const walk=p=>readdirSync(p).flatMap(n=>{const f=join(p,n);return statSync(f).isDirectory() ? walk(f) : [f];});
const tracked=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(p=>p && existsSync(p));
const paths=[...new Set([...tracked,...walk('dist'),...walk('docs/acceptance/s4-repair')])];
const leaked=[];
for(const p of paths){const bytes=readFileSync(p);if(secrets.some(s=>bytes.includes(Buffer.from(s))))leaked.push(p);}
assert.deepEqual(leaked,[],'Server secret bytes found (only affected filenames are reported)');
writeFileSync('docs/acceptance/s4-repair/secrets.json',JSON.stringify({status:'PASS',checkedFiles:paths.length,scope:'tracked files + production bundle + repair reports',serverSecretsChecked:2,leaks:[]},null,2)+'\n');
console.log(`PASS server secret byte scan: ${paths.length} files`);
