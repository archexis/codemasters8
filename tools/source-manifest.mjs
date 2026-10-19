import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Byte hashes, including CRLF. git supplies both tracked and untracked source paths.
// Explicit scope excludes acceptance itself, secrets, dependencies and generated output.
export function sourceManifest(root=process.cwd()) {
  const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  const inScope=p=> /^(src\/|supabase\/(functions|migrations)\/|backend\/(app|tests)\/|tests\/|tools\/|\.github\/)/.test(p) || /^backend\/(requirements.*\.txt|pyproject\.toml|[^/]*lock[^/]*|pytest\.ini)$/.test(p) || p==='supabase/config.toml' || /^(package(-lock)?\.json|[^/]*config\.(ts|js|json)|[^/]*\.config\.(ts|js)|index\.html|skills-lock\.json|\.gitignore|\.env\.example)$/.test(p);
  const excluded=p=> p==='skills-lock.json' || /(^|\/)(node_modules|\.venv|__pycache__|\.pytest_cache|\.temp|\.vitest|dist|test-results|cache)(\/|$)/.test(p) || /\.(pyc|log)$/.test(p) || /(^|\/)\.env($|\.)/.test(p) && p!=='.env.example';
  return Object.fromEntries([...new Set(paths)].filter(p=>inScope(p) && !excluded(p)).sort().map(p=>[p,createHash('sha256').update(readFileSync(resolve(root,p))).digest('hex')]));
}
