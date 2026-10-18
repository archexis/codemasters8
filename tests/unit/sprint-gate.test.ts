import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const GATE = join(REPO, 'tools', 'check-sprint-gate.mjs');
const CRITERIA_SRC = join(REPO, 'docs', 'acceptance', 'criteria.json');

// Gate fixtures — synthetic данные только для проверки самого gate,
// не являются реальными отчётами приёмки.
const PKGS_0 = ['S0.1', 'S0.2', 'S0.3', 'S0.4', 'S0.5'];
const CRITS_0 = ['D0.1', 'D0.2', 'D0.3', 'D0.4', 'D0.5'];

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

type Fixture = { root: string; dir: string; criteria: string };

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'gate-'));
  const dir = join(root, 'acceptance');
  mkdirSync(dir, { recursive: true });
  const criteria = join(root, 'criteria.json');
  writeFileSync(criteria, readFileSync(CRITERIA_SRC, 'utf8'));
  // Один входной исходник + по одному файлу доказательства на пакет/критерий.
  writeFileSync(join(root, 'src-a.ts'), 'export const a = 1;\n');
  for (const id of [...PKGS_0, ...CRITS_0]) {
    writeFileSync(join(root, `proof-${id}.txt`), `evidence for ${id}\n`);
  }
  return { root, dir, criteria };
}

function manifestOf(f: Fixture): Record<string, string> {
  return { 'src-a.ts': sha256(readFileSync(join(f.root, 'src-a.ts'), 'utf8')) };
}

function pkg(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    status: 'PASS',
    checks: [{ profile: 'U', command: 'npm test', result: 'PASS' }],
    artifacts: [`proof-${id}.txt`],
    ...extra,
  };
}

function crit(id: string, extra: Record<string, unknown> = {}) {
  return { id, status: 'PASS', evidence: [`proof-${id}.txt`], ...extra };
}

function report0(f: Fixture, patch: Record<string, unknown> = {}) {
  return {
    sprint: 0,
    status: 'PASS',
    source: { head: 'synthetic', manifest: manifestOf(f) },
    environment: { note: 'synthetic fixture' },
    packages: PKGS_0.map((id) => pkg(id)),
    criteria: CRITS_0.map((id) => crit(id)),
    regression: [],
    blockers: [],
    next: 'S0.5+',
    ...patch,
  };
}

function writeReport(f: Fixture, n: number, obj: unknown) {
  writeFileSync(join(f.dir, `sprint-${n}.json`), JSON.stringify(obj));
}

function runGate(f: Fixture, n: number, extraArgs: string[] = []) {
  return spawnSync(process.execPath, [GATE, String(n), '--dir', f.dir, '--root', f.root, '--criteria', f.criteria, ...extraArgs], {
    encoding: 'utf8',
  });
}

describe('sprint gate', () => {
  it('passes a complete valid synthetic report', () => {
    const f = makeFixture();
    writeReport(f, 0, report0(f));
    const r = runGate(f, 0);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('GATE PASS');
  });

  it('fails when one package ID is missing', () => {
    const f = makeFixture();
    const rep = report0(f);
    rep.packages = rep.packages.filter((p: { id: string }) => p.id !== 'S0.3');
    writeReport(f, 0, rep);
    const r = runGate(f, 0);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('S0.3');
  });

  it('fails on BLOCKED status', () => {
    const f = makeFixture();
    const rep = report0(f);
    rep.packages[1] = pkg('S0.2', { status: 'BLOCKED', artifacts: ['proof-S0.2.txt'] });
    writeReport(f, 0, rep);
    const r = runGate(f, 0);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/BLOCKED/i);
  });

  it('fails when an evidence file does not exist', () => {
    const f = makeFixture();
    const rep = report0(f);
    rep.criteria[0] = crit('D0.1', { evidence: ['proof-D0.1-missing.txt'] });
    writeReport(f, 0, rep);
    const r = runGate(f, 0);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('proof-D0.1-missing.txt');
  });

  it('fails when a manifest hash no longer matches the source', () => {
    const f = makeFixture();
    writeReport(f, 0, report0(f));
    writeFileSync(join(f.root, 'src-a.ts'), 'export const a = 2; // changed after report\n');
    const r = runGate(f, 0);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('src-a.ts');
  });

  it('fails for N>0 when the predecessor sprint is not closed', () => {
    const f = makeFixture();
    // Нет sprint-0.json вообще.
    writeReport(f, 1, {
      sprint: 1,
      status: 'PASS',
      source: { head: 'synthetic', manifest: manifestOf(f) },
      environment: {},
      packages: ['S1.1', 'S1.2', 'S1.3', 'S1.4', 'S1.5'].map((id) => ({
        id,
        status: 'PASS',
        checks: [{ profile: 'U', result: 'PASS' }],
        artifacts: ['src-a.ts'],
      })),
      criteria: ['D1.1', 'D1.2', 'D1.3', 'D1.4', 'D1.5'].map((id) => ({ id, status: 'PASS', evidence: ['src-a.ts'] })),
      regression: [{ id: 'D0.1', result: 'PASS', evidence: ['src-a.ts'] }],
      blockers: [],
      next: 'S1.5+',
    });
    const r = runGate(f, 1);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/predecessor|sprint-0/i);
  });

  it('fails when a mandatory check is skipped', () => {
    const f = makeFixture();
    const rep = report0(f);
    rep.packages[0] = pkg('S0.1', { checks: [{ profile: 'L', result: 'SKIP', skipped: true }] });
    writeReport(f, 0, rep);
    const r = runGate(f, 0);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/skip/i);
  });

  it('fails when regression re-confirmation is missing for N>0', () => {
    const f = makeFixture();
    writeReport(f, 0, report0(f));
    writeReport(f, 1, {
      sprint: 1,
      status: 'PASS',
      source: { head: 'synthetic', manifest: manifestOf(f) },
      environment: {},
      packages: ['S1.1', 'S1.2', 'S1.3', 'S1.4', 'S1.5'].map((id) => ({
        id,
        status: 'PASS',
        checks: [{ profile: 'U', result: 'PASS' }],
        artifacts: ['src-a.ts'],
      })),
      criteria: ['D1.1', 'D1.2', 'D1.3', 'D1.4', 'D1.5'].map((id) => ({ id, status: 'PASS', evidence: ['src-a.ts'] })),
      regression: [],
      blockers: [],
      next: 'x',
    });
    const r = runGate(f, 1);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/regression/i);
  });

  it('gate script and real criteria.json exist in the repo', () => {
    expect(existsSync(GATE)).toBe(true);
    const c = JSON.parse(readFileSync(CRITERIA_SRC, 'utf8'));
    expect(c.sprints).toHaveLength(7);
  });
});
