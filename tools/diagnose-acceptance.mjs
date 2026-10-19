// Read-only diagnosis: never refreshes acceptance hashes or changes historical reports.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const hash = b => createHash('sha256').update(b).digest('hex');
const output = process.argv[2] || 'docs/acceptance/s5-entry/manifest-diagnosis.json';
const report = JSON.parse(readFileSync('docs/acceptance/sprint-4.json', 'utf8'));
const generated = p => /(^|\/)(\.pytest_cache|\.vitest|graphify-out|\.branches|\.temp|__pycache__)(\/|$)/.test(p);
const entries = Object.entries(report.source.manifest).map(([path, expected]) => {
  const excludedByContract = generated(path);
  if (!existsSync(path)) return {path, expected, classification: 'missing', excludedByContract};
  const bytes = readFileSync(path), actual = hash(bytes);
  const lfHash = hash(bytes.toString('utf8').replace(/\r\n/g, '\n'));
  const classification = actual === expected ? 'exact' : lfHash === expected ? 'CRLF-only' : 'content-changed';
  return {path, expected, actual, lfHash, classification, excludedByContract};
});
const summary = {};
for (const e of entries) summary[e.classification] = (summary[e.classification] || 0) + 1;
const result = {at:new Date().toISOString(), head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  method:'SHA256 raw bytes, then UTF-8 CRLF→LF only; no trimming, no Unicode normalization. Generated files flagged separately per EXECUTION.',
  summary, excludedByContract:entries.filter(e=>e.excludedByContract).length, entries};
mkdirSync('docs/acceptance/s5-entry',{recursive:true});
writeFileSync(output, JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({summary,excludedByContract:result.excludedByContract,output},null,2));
