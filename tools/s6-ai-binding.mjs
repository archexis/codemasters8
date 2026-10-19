import {readFileSync,writeFileSync} from 'node:fs';
import {sourceManifest} from './source-manifest.mjs';
import assert from 'node:assert/strict';
const current=sourceManifest(),prior=JSON.parse(readFileSync('docs/acceptance/sprint-5.json','utf8')).source.manifest;
const paths=Object.keys(current).filter(p=>p.startsWith('supabase/functions/')||p.startsWith('supabase/migrations/')||['src/lib/analysis.ts','src/components/Analyze.svelte','src/lib/types.ts','src/lib/validation.ts','src/lib/domain.ts','tests/fixtures/contracts/ai-eval.json','tests/fixtures/contracts/ai-transport.json'].includes(p));
const changes=paths.filter(p=>prior[p]!==current[p]);assert.deepEqual(changes,[],'AI code/prompt/schema/request inputs changed: fresh inference required');
const evidence='docs/acceptance/s4-repair/ai-1792343710446.json',evalReport=JSON.parse(readFileSync(evidence,'utf8'));
assert.equal(evalReport.status,'PASS');assert.equal(evalReport.cases.length,12);assert(evalReport.cases.every(c=>c.status==='PASS'));
writeFileSync('docs/acceptance/s6/ai-input-binding.json',JSON.stringify({status:'PASS',mode:'retained real inference evidence; no new provider calls for docs/session-only fixes',evidence,connectedCase:'docs/acceptance/s5/connected.json',reference:'pre-S6 sprint-5 source manifest',inputs:Object.fromEntries(paths.map(p=>[p,current[p]])),changes,scopeNote:'S6 repository/App changes reject superseded sessions and block unsafe DEMO writes; provider handler, prompt, model schema, canonical input builder and review contracts unchanged.'},null,2)+'\n');console.log('PASS AI inputs unchanged; retained 12-case real eval + connected synthetic investigation');
