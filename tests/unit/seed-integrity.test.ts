/**
 * S1.4. Seed integrity: каждый confirmed фактор проходит новые C1-правила;
 * A/B/C дают 35/70/10; JSON seed == initialize_workspace() после всех
 * миграций; старые пользовательские confirmed без достаточных данных
 * переводятся в needs-verification с сохранением payload + migration event;
 * повторное применение не добавляет второй migration event.
 *
 * Доказательства в seed — только DEMO-материалы из seed.json (единственный
 * источник; SQL app_seed обновляется сгенерированной миграцией).
 */
// @ts-ignore — tools/generate-seed.mjs без типов; runtime-импорт под vitest.
import { buildSeedEnvelope } from '../../tools/generate-seed.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createTestDatabase, login } from '../helpers/database';
import { validateFactor } from '../../src/lib/domain';
import { computeScore } from '../../src/lib/scoring';
import seed from '../../src/lib/seed.json' with { type: 'json' };

const userA = '11111111-1111-4111-8111-111111111111';

let db: PGlite;
afterEach(async () => {
  await db?.close();
});

function envelope(): {
  complexes: Record<string, any>[];
  ads: Record<string, any>[];
  media: unknown[];
  signals: Record<string, unknown>;
  audit: unknown[];
} {
  return buildSeedEnvelope(seed);
}

function workspaceOf(env: ReturnType<typeof envelope>) {
  return {
    complexes: env.complexes,
    ads: env.ads,
    media: [],
    signals: {},
    audit: [],
  };
}

describe('S1.4 seed integrity (TS)', () => {
  it('каждый confirmed фактор проходит новые C1-правила (verbatim-цитаты, материалы)', () => {
    const env = envelope();
    const ws = workspaceOf(env);
    const confirmed = env.complexes.flatMap((z) =>
      (z.factors as Record<string, any>[]).map((f) => ({ z, f })),
    ).filter(({ f }) => f.status === 'confirmed');
    expect(confirmed.length).toBeGreaterThan(0);
    const adsById = new Map(env.ads.map((a) => [a.id, a]));
    for (const { z, f } of confirmed) {
      expect(() => validateFactor(ws as never, z as never, f.code, 'confirmed', f.evidence)).not.toThrow();
      // Grounding чинен данными: цитата — точный фрагмент исходного ad того же ЖК.
      const ev = f.evidence as Record<string, any>;
      if (ev.adId) {
        const ad = adsById.get(ev.adId);
        expect(ad, `${z.id}/${f.code}: ad ${ev.adId} существует`).toBeDefined();
        expect(ad!.zkId).toBe(z.id);
        expect(ad!.text.includes(ev.quote), `${z.id}/${f.code}: quote verbatim из ${ev.adId}`).toBe(true);
      }
    }
  });

  it('R3 SQ-001 цитирует реальный фрагмент AD-001 (правило grounding не менялось)', () => {
    const env = envelope();
    const sq001 = env.complexes.find((z) => z.id === 'SQ-001')!;
    const r3 = (sq001.factors as Record<string, any>[]).find((f) => f.code === 'R3')!;
    const ad001 = env.ads.find((a) => a.id === 'AD-001')!;
    expect(r3.status).toBe('confirmed');
    expect(r3.evidence.quote).not.toBe('Старт продаж в строящемся доме, сдача в 2027 году');
    expect(ad001.text.includes(r3.evidence.quote)).toBe(true);
  });

  it('A/B/C дают 35/yellow, 70/red, 10/green', () => {
    const env = envelope();
    const byId = new Map(env.complexes.map((z) => [z.id, z]));
    const check = (id: string, score: number, zone: string) => {
      const r = computeScore((byId.get(id)!.factors as never[]));
      expect(r.score).toBe(score);
      expect(r.zone).toBe(zone);
    };
    check('SQ-001', 35, 'yellow');
    check('SQ-002', 70, 'red');
    check('SQ-003', 10, 'green');
  });

  it('новый набор содержит только вымышленные досье на восьми реальных точках', () => {
    const env = envelope();
    expect(env.complexes).toHaveLength(8);
    expect(env.ads).toHaveLength(13);
    const snaps = env.complexes.filter((z) => z.origin === 'public-snapshot');
    expect(snaps).toHaveLength(0);
    for (const s of env.complexes) {
      expect(s.demo).toBe(true);
      expect(s.note).toContain('Реальны только координаты');
      expect(s.bin).toBeNull();
      expect(s.sources.every((source: { url?: string }) => !source.url)).toBe(true);
    }
  });
});

describe('S1.4 seed integrity (SQL)', () => {
  it('замена удаляет старое досье и версии сигналов из существующего workspace', async () => {
    const tdb = await createTestDatabase();
    db = tdb.db;
    const retired = { ...envelope(), audit: [{ id: 'old-event' }], signals: { old: {} },
      signalVersions: { old: [{}] }, geometries: [{ complexId: 'SQ-R01' }] };
    await db.query('insert into public.workspaces(owner_id, data, version) values ($1, $2::jsonb, 7)',
      [userA, JSON.stringify(retired)]);
    await db.exec(readFileSync('supabase/migrations/20261019194027_real_site_demo_reset.sql', 'utf8'));
    const result = await db.query<{ data: unknown; version: number }>('select data, version from public.workspaces');
    expect(result.rows[0].data).toEqual(envelope());
    expect(result.rows[0].version).toBe(8);
    const guard = await db.query<{ tgenabled: string }>("select tgenabled from pg_trigger where tgname = 'workspaces_history_append_only'");
    expect(guard.rows[0].tgenabled).toBe('O');
    const counts = await db.query<{ receipts: number; runs: number; jobs: number }>(
      'select (select count(*)::int from public.command_receipts) as receipts, (select count(*)::int from public.analysis_runs) as runs, (select count(*)::int from public.document_jobs) as jobs');
    expect(counts.rows[0]).toEqual({ receipts: 0, runs: 0, jobs: 0 });
  });

  async function setupSql() {
    const tdb = await createTestDatabase();
    db = tdb.db;
    await login(db, userA);
    return tdb;
  }

  it('JSON seed == initialize_workspace() после всех миграций; app_seed из генератора', async () => {
    const tdb = await createTestDatabase();
    db = tdb.db;
    // Прямое чтение app_seed — привилегия тестового harness (superuser PGlite,
    // как в database.test.ts): продукту authenticated читать app_seed запрещён
    // revoke'ом by design, контракт — через initialize_workspace().
    const expected = envelope();
    const seedRow = await db.query<{ data: unknown }>('select data from public.app_seed');
    expect(seedRow.rows[0].data).toEqual(expected);
    await login(db, userA);
    const init = await db.query<{ w: { data: unknown; version: number } }>(
      'select public.initialize_workspace() as w',
    );
    expect(init.rows[0].w.version).toBe(1);
    expect(init.rows[0].w.data).toEqual(expected);
  }, 60000);

  it('миграция переводит недостаточные confirmed в needs-verification, хранит payload, идемпотентна', async () => {
    await setupSql();
    const legacy = {
      complexes: [
        {
          id: 'ZK-LEG',
          name: 'Legacy (synthetic)',
          city: 'Өскемен',
          address: 'legacy',
          developer: 'legacy',
          bin: null,
          origin: 'user',
          stage: 'строится',
          readinessClaimed: null,
          readinessConfirmed: null,
          readinessSources: [],
          readinessClaimedSource: null,
          legalBasis: { type: 'unknown', status: 'unknown', source: '', checkedAt: '', reviewText: '' },
          note: 'legacy',
          factors: [
            {
              code: 'R2', status: 'confirmed',
              evidence: {
                id: 'ev-r2', zkId: 'ZK-LEG', kind: 'publication', source: 'legacy',
                date: '2026-10-01', adId: 'AD-LEG', quote: 'выдуманная цитата не из текста',
              },
              reviewer: 'old.analyst', updatedAt: '2026-09-01T00:00:00+05:00',
            },
            {
              code: 'R1', status: 'confirmed',
              evidence: {
                id: 'ev-r1', zkId: 'ZK-LEG', kind: 'legal-review', source: 'generic source',
                date: '2026-10-01', text: 'generic сверка',
              },
              reviewer: 'old.analyst', updatedAt: '2026-09-01T00:00:00+05:00',
            },
            {
              code: 'R3', status: 'confirmed',
              evidence: {
                id: 'ev-r3', zkId: 'ZK-LEG', kind: 'publication', source: 'legacy',
                date: '2026-10-01', adId: 'AD-LEG2',
                quote: 'продажи в строящемся доме',
                text: 'На 2026-10-01 дом не введён (synthetic)',
              },
              reviewer: 'old.analyst', updatedAt: '2026-09-01T00:00:00+05:00',
            },
          ],
          events: [], sources: [],
        },
        {
          id: 'ZK-SNAP', name: 'Snapshot (synthetic)', city: 'Өскемен', address: 'snap',
          developer: 'snap', bin: null, origin: 'public-snapshot', stage: 'сроки по реестру',
          readinessClaimed: null, readinessConfirmed: null, readinessSources: [],
          readinessClaimedSource: null,
          legalBasis: { type: 'mio-permit', status: 'verified', source: 'Ashyq Data', checkedAt: '2026-10-15', reviewText: 'provenance' },
          note: 'provenance', factors: [], events: [], sources: [],
        },
      ],
      ads: [
        {
          id: 'AD-LEG', zkId: 'ZK-LEG', platform: 'x', account: 'x', date: '2026-10-01',
          url: 'https://example.invalid/leg', captureAt: '2026-10-01', text: 'обычный текст без цитат',
        },
        {
          id: 'AD-LEG2', zkId: 'ZK-LEG', platform: 'x', account: 'x', date: '2026-10-01',
          url: 'https://example.invalid/leg2', captureAt: '2026-10-01', text: 'продажи в строящемся доме, сдача позже',
        },
      ],
      media: [], signals: {}, audit: [],
    };
    const once = await db.query<{ m: typeof legacy }>(
      'select public.migrate_s1_4_seed($1::jsonb) as m', [JSON.stringify(legacy)],
    );
    const d1 = once.rows[0].m;
    const byCode = new Map(
      (d1.complexes[0] as { factors: { code: string }[] }).factors.map((f) => [f.code, f]),
    ) as Map<string, Record<string, any>>;
    // Недостаточные — в needs-verification с сохранённым payload; выдумок нет.
    expect(byCode.get('R2')!.status).toBe('needs-verification');
    expect(byCode.get('R2')!.before).toEqual({
      status: 'confirmed',
      evidence: legacy.complexes[0].factors[0].evidence,
      reason: expect.any(String),
    });
    expect(byCode.get('R1')!.status).toBe('needs-verification');
    expect(byCode.get('R1')!.before.status).toBe('confirmed');
    // Достаточный R3 — нетронут.
    expect(byCode.get('R3')).toMatchObject(legacy.complexes[0].factors[2]);
    // Снимок — нетронут (provenance, не live-проверка).
    expect(d1.complexes[1]).toEqual(legacy.complexes[1]);
    // Один migration event на затронутый объект.
    const events = (d1.audit as Record<string, any>[]).filter(
      (a) => a?.details?.migration === 's1.4-seed-integrity',
    );
    expect(events).toHaveLength(1);
    expect(events[0].zkId).toBe('ZK-LEG');
    // Повторное применение — без изменений и без второго события.
    const twice = await db.query<{ m: typeof legacy }>(
      'select public.migrate_s1_4_seed($1::jsonb) as m', [JSON.stringify(d1)],
    );
    expect(twice.rows[0].m).toEqual(d1);
  });
});
