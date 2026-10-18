#!/usr/bin/env node
/**
 * Sprint gate — проверка отчёта приёмки по протоколу docs/sprints/EXECUTION.md.
 *
 * Использование: node tools/check-sprint-gate.mjs N [--dir DIR] [--root DIR] [--criteria PATH]
 *   N          номер спринта (0..6)
 *   --dir      каталог отчётов sprint-N.json (по умолчанию docs/acceptance)
 *   --root     корень репозитория для проверки файлов/хешей (по умолчанию корень репо)
 *   --criteria путь к criteria.json (по умолчанию docs/acceptance/criteria.json)
 *
 * Проверяет:
 *  1. Отчёт sprint-N.json существует, status === PASS.
 *  2. Все обязательные package IDs и DoD IDs из criteria.json присутствуют со статусом PASS.
 *  3. У каждого PASS есть свидетельство: непустые artifacts/evidence, файлы существуют на диске.
 *  4. Нет блокеров: blockers пуст, ни один пакет/критерий не BLOCKED/FAIL.
 *  5. Актуальность по хешам: source.manifest совпадает с текущими SHA256 файлов.
 *  6. Для N>0: отчёт предшественника sprint-(N-1).json существует со статусом PASS
 *     и есть актуальное подтверждение регрессии (все записи regression — PASS с evidence).
 *  7. Нет skip в обязательных результатах (checks со skipped:true или результатом SKIP).
 *
 * Exit 0 — gate пройден. Ненулевой exit — gate не пройден, причины в stderr.
 * Один текст «PASS» без свидетельства не засчитывается.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PASS = 'PASS';
const FAIL_STATES = new Set(['FAIL', 'BLOCKED', 'NOT_RUN', 'IN_PROGRESS']);

function usage() {
  return 'Usage: node tools/check-sprint-gate.mjs N [--dir DIR] [--root DIR] [--criteria PATH]';
}

function parseArgs(argv) {
  const out = { sprint: null, dir: 'docs/acceptance', root: REPO_ROOT, criteria: 'docs/acceptance/criteria.json' };
  const rest = [...argv];
  if (rest.length === 0 || rest[0].startsWith('--')) throw new Error(usage());
  out.sprint = Number(rest.shift());
  if (!Number.isInteger(out.sprint) || out.sprint < 0) throw new Error(`Bad sprint number. ${usage()}`);
  while (rest.length > 0) {
    const flag = rest.shift();
    const val = rest.shift();
    if (val === undefined || val.startsWith('--')) throw new Error(`Missing value for ${flag}. ${usage()}`);
    if (flag === '--dir') out.dir = val;
    else if (flag === '--root') out.root = resolve(val);
    else if (flag === '--criteria') out.criteria = val;
    else throw new Error(`Unknown flag ${flag}. ${usage()}`);
  }
  return out;
}

function sha256File(absPath) {
  const data = readFileSync(absPath);
  return createHash('sha256').update(data).digest('hex');
}

/** Нормализует запись проверки к { name, result, skipped }. */
function normCheck(c, i) {
  if (typeof c === 'string') return { name: c || `#${i}`, result: 'PASS', skipped: false, raw: c };
  if (c && typeof c === 'object') {
    return {
      name: c.profile ?? c.name ?? c.command ?? `#${i}`,
      result: String(c.result ?? c.status ?? 'PASS').toUpperCase(),
      skipped: Boolean(c.skipped ?? c.skip),
      raw: c,
    };
  }
  return { name: `#${i}`, result: 'INVALID', skipped: false, raw: c };
}

function main() {
  const errors = [];
  const fail = (msg) => errors.push(msg);
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(2);
  }
  const { sprint: N } = args;
  const accDir = resolve(args.root, args.dir);
  const criteriaPath = resolve(args.root, args.criteria);

  if (!existsSync(criteriaPath)) {
    console.error(`criteria.json not found: ${criteriaPath}`);
    process.exit(2);
  }
  let criteria;
  try {
    criteria = JSON.parse(readFileSync(criteriaPath, 'utf8'));
  } catch (e) {
    console.error(`criteria.json is not valid JSON: ${e.message}`);
    process.exit(2);
  }
  const spec = (criteria.sprints ?? []).find((s) => s.sprint === N);
  if (!spec) {
    console.error(`Sprint ${N} is not defined in criteria.json`);
    process.exit(2);
  }
  const requiredPackages = spec.packages ?? [];
  const requiredCriteria = (spec.criteria ?? []).map((c) => (typeof c === 'string' ? c : c.id));

  const reportPath = join(accDir, `sprint-${N}.json`);
  if (!existsSync(reportPath)) {
    console.error(`Missing acceptance report: ${reportPath}`);
    process.exit(1);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (e) {
    console.error(`Report is not valid JSON: ${reportPath}: ${e.message}`);
    process.exit(1);
  }

  if (report.sprint !== N) fail(`report.sprint is ${JSON.stringify(report.sprint)}, expected ${N}`);
  if (report.status !== PASS) fail(`report.status is ${JSON.stringify(report.status)}, expected "PASS"`);
  if (FAIL_STATES.has(String(report.status))) fail(`report is in terminal non-pass state: ${report.status}`);

  // --- 1. Пакеты: наличие всех обязательных ID, PASS каждого, артефакты существуют.
  const packages = Array.isArray(report.packages) ? report.packages : [];
  const pkgById = new Map(packages.map((p) => [p?.id, p]));
  for (const id of requiredPackages) {
    const p = pkgById.get(id);
    if (!p) { fail(`missing package ID: ${id}`); continue; }
    if (p.status !== PASS) { fail(`package ${id} status is ${JSON.stringify(p.status)}, expected "PASS"`); continue; }
    const artifacts = p.artifacts ?? [];
    if (!Array.isArray(artifacts) || artifacts.length === 0) {
      fail(`package ${id}: PASS without evidence (no artifacts)`);
    } else {
      for (const a of artifacts) {
        const abs = resolve(args.root, String(a));
        if (!existsSync(abs) || !statSync(abs).isFile()) fail(`package ${id}: missing artifact file: ${a}`);
      }
    }
    const checks = p.checks ?? [];
    if (!Array.isArray(checks) || checks.length === 0) {
      fail(`package ${id}: no checks recorded`);
    } else {
      checks.forEach((c, i) => {
        const n = normCheck(c, i);
        if (n.skipped || n.result === 'SKIP' || n.result === 'SKIPPED') {
          fail(`package ${id}: check "${n.name}" is skipped, skip is not allowed for mandatory results`);
        } else if (n.result !== PASS) {
          fail(`package ${id}: check "${n.name}" result is ${JSON.stringify(n.result)}, expected "PASS"`);
        }
      });
    }
  }
  for (const p of packages) {
    if (p && FAIL_STATES.has(String(p.status))) fail(`package ${p.id}: terminal state ${p.status}`);
  }

  // --- 2. Критерии DoD: наличие всех ID, PASS, непустое evidence с существующими файлами.
  const crits = Array.isArray(report.criteria) ? report.criteria : [];
  const critById = new Map(crits.map((c) => [c?.id, c]));
  for (const id of requiredCriteria) {
    const c = critById.get(id);
    if (!c) { fail(`missing criterion ID: ${id}`); continue; }
    if (c.status !== PASS) { fail(`criterion ${id} status is ${JSON.stringify(c.status)}, expected "PASS"`); continue; }
    const ev = c.evidence ?? [];
    const list = Array.isArray(ev) ? ev : [ev];
    if (list.length === 0 || list.every((e) => String(e ?? '').trim() === '')) {
      fail(`criterion ${id}: PASS without evidence`);
    } else {
      for (const e of list) {
        const s = String(e);
        // evidence может быть описанием; проверяем существование только для путей,
        // выглядящих как файлы (с расширением). Чистый текст-описание допускается,
        // но тогда у критерия должно быть ≥1 файловое свидетельство.
        if (/\.([A-Za-z0-9]{1,5})$/.test(s.trim())) {
          const abs = resolve(args.root, s.trim());
          if (!existsSync(abs) || !statSync(abs).isFile()) fail(`criterion ${id}: missing evidence file: ${s}`);
        }
      }
      const hasFile = list.some((e) => /\.([A-Za-z0-9]{1,5})$/.test(String(e ?? '').trim()) && existsSync(resolve(args.root, String(e).trim())));
      if (!hasFile) fail(`criterion ${id}: no file evidence, bare PASS text is not accepted`);
    }
  }
  for (const c of crits) {
    if (c && FAIL_STATES.has(String(c.status))) fail(`criterion ${c.id}: terminal state ${c.status}`);
  }

  // --- 3. Блокеры отсутствуют.
  const blockers = report.blockers ?? [];
  if (!Array.isArray(blockers) || blockers.length > 0) {
    fail(`open blockers: ${(Array.isArray(blockers) ? blockers : [blockers]).length} recorded, expected none`);
  }

  // --- 4. Актуальность по хешам исходников.
  const manifest = report.source?.manifest;
  if (!manifest || typeof manifest !== 'object' || Object.keys(manifest).length === 0) {
    fail('source.manifest is missing or empty, freshness cannot be verified');
  } else {
    for (const [rel, expected] of Object.entries(manifest)) {
      const abs = resolve(args.root, rel);
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        fail(`manifest file missing on disk: ${rel}`);
        continue;
      }
      const actual = sha256File(abs);
      if (actual !== String(expected).toLowerCase()) {
        fail(`stale hash: ${rel} changed since the report (manifest ${String(expected).slice(0, 12)}… != current ${actual.slice(0, 12)}…)`);
      }
    }
  }

  // --- 5. Для N>0: PASS предшественника + актуальная регрессия.
  if (N > 0) {
    const prevPath = join(accDir, `sprint-${N - 1}.json`);
    if (!existsSync(prevPath)) {
      fail(`predecessor report missing: ${prevPath}, sprint ${N - 1} is not closed`);
    } else {
      let prev;
      try {
        prev = JSON.parse(readFileSync(prevPath, 'utf8'));
      } catch (e) {
        fail(`predecessor report is not valid JSON: ${prevPath}`);
        prev = null;
      }
      if (prev && prev.status !== PASS) {
        fail(`predecessor sprint-${N - 1} status is ${JSON.stringify(prev.status)}, sprint ${N} is not allowed`);
      }
    }
    const reg = report.regression;
    const regList = Array.isArray(reg) ? reg : (reg && Array.isArray(reg.results) ? reg.results : []);
    if (!Array.isArray(regList) || regList.length === 0) {
      fail('regression confirmation is missing or empty, predecessor PASS alone is not enough');
    } else {
      regList.forEach((r, i) => {
        const id = r?.id ?? `#${i}`;
        const result = String(r?.result ?? r?.status ?? '').toUpperCase();
        if (result !== PASS) {
          fail(`regression ${id}: result is ${JSON.stringify(r?.result ?? r?.status)}, expected "PASS"`);
          return;
        }
        const ev = r?.evidence ?? [];
        const list = Array.isArray(ev) ? ev : [ev];
        const hasFile = list.some((e) => /\.([A-Za-z0-9]{1,5})$/.test(String(e ?? '').trim()) && existsSync(resolve(args.root, String(e).trim())));
        if (!hasFile) fail(`regression ${id}: no file evidence for current re-confirmation`);
      });
    }
  }

  if (errors.length > 0) {
    console.error(`GATE FAIL: sprint ${N} — ${errors.length} problem(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`GATE PASS: sprint ${N} — ${requiredPackages.length} packages, ${requiredCriteria.length} criteria, manifest fresh, no blockers.`);
}

main();
