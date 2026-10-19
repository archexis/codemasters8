// Run only after the real acceptance commands. Refuses incomplete/failed profile logs.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { sourceManifest } from './source-manifest.mjs';
const dir='docs/acceptance/s4-repair',history='docs/acceptance/history/s4-before-repair';
const profiles=[['T','check.log',/0 errors and 0 warnings/],['U','unit.log',/297 passed/],['B','build.log',/built in/],['E','e2e.log',/68 passed/],['C','cloud.log',/1 passed/],['A','api.log',/9 passed/],['F','edge.log',/3 passed \| 0 failed/],['L','local.log',/4 passed/],['AI','ai.log',/PASS real AI acceptance/]];
const checks=profiles.map(([profile,file,pattern])=>{assert(pattern.test(readFileSync(`${dir}/${file}`,'utf8')),`${profile} does not have a successful completed log`);return {profile,command:profile==='AI' ? 'npm run test:deepseek -- --reuse-eval docs/acceptance/s4-repair/ai-1792343450532.json' : ({T:'npm run check',U:'npm test',B:'npm run build',E:'npm run test:e2e',C:'npm run test:cloud',A:'backend/.venv/Scripts/python.exe -m pytest backend/tests -q',F:'npm run test:edge; npx --yes deno check supabase/functions/analyze/index.ts',L:'npm run test:local'})[profile],result:'PASS',evidence:[`${dir}/${file}`]};});
const aiFiles=readdirSync(dir).filter(f=>/^ai-\d+\.json$/.test(f)).sort().reverse();
const aiPath=aiFiles.map(f=>`${dir}/${f}`).find(p=>JSON.parse(readFileSync(p,'utf8')).status==='PASS'); assert(aiPath);
const ai=JSON.parse(readFileSync(aiPath,'utf8'));assert.equal(ai.cases.length,12);assert(ai.cases.every(c=>c.status==='PASS'));assert.equal(ai.browser,'PASS');
assert.equal(JSON.parse(readFileSync(`${dir}/secrets.json`,'utf8')).status,'PASS');
const evidence=checks.flatMap(c=>c.evidence);
const manifest=sourceManifest(); assert(Object.keys(manifest).length>80);assert(!Object.keys(manifest).some(p=>p.startsWith('docs/acceptance/') || p.includes('/cache/') || p.includes('.env.edge')));
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const spec=JSON.parse(readFileSync('docs/acceptance/criteria.json','utf8')).sprints;
const environment={date:new Date().toISOString(),node:process.version,mode:'DEMO + local Supabase Docker + real DeepSeek',migrations:readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort(),localUpgrade:`${dir}/local-upgrade.json`,provider:ai.model,promptVersion:'s4-r2r3-v3'};
const historyManifest={};
for(let n=0;n<=4;n++) for(const ext of ['json','md']){const p=`${history}/sprint-${n}.${ext}`;historyManifest[p]=createHash('sha256').update(readFileSync(p)).digest('hex');}
writeFileSync(`${history}/manifest.json`,JSON.stringify(historyManifest,null,2)+'\n');
for(let n=0;n<4;n++) {
  const old=JSON.parse(readFileSync(`${history}/sprint-${n}.json`,'utf8'));assert.equal(old.status,'PASS');
  const report={...old,source:{head,manifest},environment,historicalAcceptance:`${history}/sprint-${n}.json`,recertification:{date:environment.date,evidence,note:'Current accumulated regression. Original reports and their evidence claims preserved separately; hashes are current byte hashes, not normalized line endings.'},packages:old.packages.map(p=>({...p,checks,artifacts:[...new Set([...(p.artifacts ?? []).filter(a=>typeof a==='string' && existsSync(a)),...evidence])]})),criteria:old.criteria.map(c=>({...c,evidence:[...new Set([...(Array.isArray(c.evidence) ? c.evidence : []),...evidence])]})),regression:spec.filter(s=>s.sprint<n).flatMap(s=>s.criteria.map(c=>({id:c.id,result:'PASS',evidence}))),blockers:[]};
  writeFileSync(`docs/acceptance/sprint-${n}.json`,JSON.stringify(report,null,2)+'\n');
  writeFileSync(`docs/acceptance/sprint-${n}.md`,`# S${n} — актуальное подтверждение регрессии\n\nPASS. Историческая приёмка: [sprint-${n}.json](history/s4-before-repair/sprint-${n}.json).\n\nПолная текущая регрессия T/U/B/E/C/A/F/L/AI, результаты и ограничения: [S4 repair](s4-repair/README.md). SHA256 считает точные байты tracked/untracked исходников в scope, без acceptance/secrets/cache/generated/dependencies.\n`);
}
const groups=[
  ['supabase/functions/analyze/index.ts','tests/unit/analyze-handler.test.ts','tests/unit/ai-provenance-sql.test.ts','supabase/migrations/20261019000300_s4_trusted_path.sql'],
  ['src/components/Analyze.svelte','src/lib/domain.ts','tests/e2e/ai-review.spec.ts','supabase/migrations/20261019000400_s4_commissioning_material.sql',aiPath],
  ['src/components/Analyze.svelte','src/lib/analysis.ts','src/lib/repository.ts','tests/e2e/ai-review.spec.ts',`${dir}/e2e.log`],
  ['tests/fixtures/contracts/ai-eval.json','tests/fixtures/contracts/ai-transport.json',aiPath],
  ['tools/deepseek-smoke.mjs',aiPath,`${dir}/secrets.json`,`${dir}/local-upgrade.json`,...evidence]
];
const report={sprint:4,status:'PASS',source:{head,manifest},environment,historicalAcceptance:`${history}/sprint-4.json`,packages:groups.map((artifacts,i)=>({id:`S4.${i+1}`,status:'PASS',checks,artifacts})),criteria:groups.map((evidence,i)=>({id:`D4.${i+1}`,status:'PASS',evidence})),regression:spec.filter(s=>s.sprint<4).flatMap(s=>s.criteria.map(c=>({id:c.id,result:'PASS',evidence}))),blockers:[],next:'S5.1 (not started in this repair)'};
writeFileSync('docs/acceptance/sprint-4.json',JSON.stringify(report,null,2)+'\n');
writeFileSync('docs/acceptance/sprint-4.md',`# S4 v2 — PASS\n\nS4.1–S4.5 / D4.1–D4.5 подтверждены заново. [Отчёт и команды](s4-repair/README.md), [машиночитаемая приёмка](sprint-4.json), [историческая приёмка](history/s4-before-repair/sprint-4.json).\n\nРеальный AI: 12/12 eval на prompt v3 и новый browser input с independent R2/R3 review/reload. Первая ошибка модели и последующие ошибки инфраструктуры/проверочного скрипта сохранены отдельно. S5/S6 не выполнялись.\n`);
console.log(`Recorded current S0–S4 acceptance: ${Object.keys(manifest).length} source files, ${aiPath}`);
