// Reports paths/types only. Never prints matched secret bytes.
import {readFileSync,writeFileSync,existsSync,readdirSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const config=JSON.parse(readFileSync('supabase/.temp/status.json','utf8').replace(/^\uFEFF/,''));
const secrets=[config.SERVICE_ROLE_KEY];
for(const p of ['.env.edge','.temp/s4-repair/edge.env']) if(existsSync(p)) {
 const t=readFileSync(p,'utf8'); const m=t.match(/^LLM_API_KEY=(.+)$/m); if(m)secrets.push(m[1].trim().replace(/^['"]|['"]$/g,''));
}
const needles=[...new Set(secrets.filter(s=>s?.length>15))].map(s=>Buffer.from(s));
const git=(args)=>execFileSync('git',args,{maxBuffer:100*1024*1024});
const files=git(['ls-files','--cached','--others','--exclude-standard','-z']).toString().split('\0').filter(p=>p&&existsSync(p));
const walk=p=>existsSync(p)?readdirSync(p).flatMap(n=>{const f=p+'/'+n;return statSync(f).isDirectory()?walk(f):[f];}):[];
const findings=[];const scan=(bytes,path,type)=>{
 if(needles.some(n=>bytes.includes(n))) findings.push({path,type,present:true});
 const text=bytes.toString('utf8');
 if(/\b(?:sk-[A-Za-z0-9_-]{24,}|sb_secret_[A-Za-z0-9_-]{24,})\b/.test(text))findings.push({path,type:type+'/provider or secret key pattern',present:true});
 for(const token of text.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
  try {if(JSON.parse(Buffer.from(token[0].split('.')[1],'base64url').toString()).role==='service_role')findings.push({path,type:type+'/JWT service_role',present:true});}catch{}
 }
};
for(const p of [...new Set([...files,...walk('dist')])])scan(readFileSync(p),p,'working file/server secret');
const objects=git(['rev-list','--objects','--all']).toString().trim().split('\n'); let blobs=0;
for(const line of objects){const [id,...name]=line.split(' '); if(git(['cat-file','-t',id]).toString().trim()!=='blob')continue; blobs++;scan(git(['cat-file','blob',id]),name.join(' ')||id,'Git history/server secret');}
const report={status:findings.length?'FAIL':'PASS',secretTypes:['local service_role','configured LLM API key'],files:files.length,distFiles:walk('dist').length,historyBlobs:blobs,findings};
writeFileSync('docs/acceptance/s6/secrets.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report)); if(findings.length)process.exitCode=1;
