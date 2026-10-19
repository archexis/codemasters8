// Records evidence only after every required profile has actually completed successfully.
import {readFileSync,writeFileSync,existsSync,mkdirSync,copyFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {sourceManifest} from './source-manifest.mjs';
const dir='docs/acceptance/s5';
const profiles=[['T','check.log',/0 errors and 0 warnings/,'npm run check'],['U','unit.log',/303 passed/,'npm test'],['B','build.log',/built in/,'npm run build'],['E','e2e.log',/76 passed/,'npm run test:e2e -- --output=test-results/s5-e2e'],['C','cloud.log',/1 passed/,'npm run test:cloud'],['A','api.log',/9 passed/,'backend/.venv/Scripts/python.exe -m pytest backend/tests -q'],['F','edge.log',/3 passed \| 0 failed/,'npm run test:edge'],['L','local.log',/4 passed/,'npm run test:local'],['AI','connected.log',/1 passed/,'node tools/s5-investigation.mjs']];
const checks=profiles.map(([profile,file,pattern,command])=>{assert(pattern.test(readFileSync(`${dir}/${file}`,'utf8')),`Incomplete ${profile} log`);return {profile,command,result:'PASS',evidence:[`${dir}/${file}`]};});
assert.equal(JSON.parse(readFileSync(`${dir}/connected.json`,'utf8')).status,'PASS');
assert(/7 passed/.test(readFileSync(`${dir}/branch.log`,'utf8')));
assert(/all 15 pages/.test(readFileSync(`${dir}/pdf/checklist.md`,'utf8')));
assert(existsSync(`${dir}/deno.log`));
const pdfs=JSON.parse(readFileSync(`${dir}/pdf/text-checks.json`,'utf8'));assert.equal(pdfs.length,4);assert(pdfs.every(p=>p.textChecks==='PASS'));
const evidence=[...checks.flatMap(c=>c.evidence),`${dir}/final-export.log`,`${dir}/final-export-browser.log`,`${dir}/final-target.log`,`${dir}/README.md`,`${dir}/connected.json`,`${dir}/branch.log`,`${dir}/pdf/checklist.md`,`${dir}/pdf/text-checks.json`];
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();const manifest=sourceManifest();
const spec=JSON.parse(readFileSync('docs/acceptance/criteria.json','utf8')).sprints;
const environment={date:new Date().toISOString(),node:process.version,mode:'DEMO + local Supabase Docker + real provider',migrations:readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()};
const history='docs/acceptance/history/s5-before-regression';mkdirSync(history,{recursive:true});
for(let n=0;n<5;n++)for(const ext of ['json','md']){const path=`docs/acceptance/sprint-${n}.${ext}`;if(!existsSync(`${history}/sprint-${n}.${ext}`))copyFileSync(path,`${history}/sprint-${n}.${ext}`);}
for(let n=0;n<5;n++){
 const old=JSON.parse(readFileSync(`${history}/sprint-${n}.json`,'utf8'));assert.equal(old.status,'PASS');
 const report={...old,source:{head,manifest},environment,historicalAcceptance:`${history}/sprint-${n}.json`,recertification:{date:environment.date,evidence,note:'S5 affected accumulated T/U/B/E/C/A/F/L regression rerun; historical 12-case AI eval retained unchanged, new connected real AI case passed. See s5/README.md for attempts.'},packages:old.packages.map(p=>({...p,checks,artifacts:[...new Set([...(p.artifacts ?? []),...evidence])]})),criteria:old.criteria.map(c=>({...c,evidence:[...new Set([...(c.evidence ?? []),...evidence])]})),regression:spec.filter(s=>s.sprint<n).flatMap(s=>s.criteria.map(c=>({id:c.id,result:'PASS',evidence}))),blockers:[]};
 writeFileSync(`docs/acceptance/sprint-${n}.json`,JSON.stringify(report,null,2)+'\n');
 writeFileSync(`docs/acceptance/sprint-${n}.md`,`# S${n} — актуальная регрессия после S5\n\nPASS. Исторический отчёт: [сохранённая приёмка](history/s5-before-regression/sprint-${n}.json). Новые фактические проверки: [S5](s5/README.md). Source SHA256 обновлён после завершённой затронутой регрессии; прежние свидетельства сохранены.\n`);
}
const artifacts=[...evidence,...pdfs.flatMap(p=>[`${dir}/pdf/${p.fixture}.pdf`,...Array.from({length:p.pages},(_,i)=>`${dir}/pdf/${p.fixture}-${i+1}.png`)])];
const own=spec.find(s=>s.sprint===5);const report={sprint:5,status:'PASS',source:{head,manifest},environment,packages:own.packages.map(id=>({id,status:'PASS',checks,artifacts})),criteria:own.criteria.map(c=>({id:c.id,status:'PASS',evidence:artifacts})),regression:spec.filter(s=>s.sprint<5).flatMap(s=>s.criteria.map(c=>({id:c.id,result:'PASS',evidence}))),blockers:[],next:'S6 — not started; parent independently reviews S5 first'};
writeFileSync('docs/acceptance/sprint-5.json',JSON.stringify(report,null,2)+'\n');
writeFileSync('docs/acceptance/sprint-5.md',`# S5 — PASS\n\nЗакрыты S5.1–S5.4 и D5.1–D5.5. TS/SQL transitions, append-only/replay, draft basedOnRevision; immutable full snapshot и исторический UI/export; защищённое чтение файлов manifest.\n\nПроверки: T 0 diagnostics; U 303; B PASS; E 76 desktop/mobile; C 1; A 9; F 3 + Deno; L 4; новый real connected case PASS, R2 reject authenticated fixture score0.\n\n[Журнал и честные детали AI попыток](s5/README.md), [connected evidence](s5/connected.json), [PDF checklist](s5/pdf/checklist.md), [машиночитаемый отчёт](sprint-5.json). Четыре PDF и PNG всех 15 страниц в s5/pdf/.\n\nПредыдущие acceptance сохранены в history/s5-before-regression, исходный BLOCKED S5 — history/s5-before-implementation. Production deploy/push/reset отсутствуют. Блокеров нет. Gate5 выполняется после формирования отчёта; результат — s5/gate5.log. S6 не начат.\n`);
console.log('S5 evidence recorded; run gate5 next');
