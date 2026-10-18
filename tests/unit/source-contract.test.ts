/**
 * S3.2 (C4). Единый source contract дедупа: один fixture-корпус для
 * TS (parser/validation/domain) и SQL (public.ad_canonical_text /
 * public.ad_dedupe_key — серверный пересчёт из S2.4, клиентскому ключу
 * никто не доверяет). Материалы — synthetic fixtures (DEMO).
 *
 * Границы: регистр/пробелы → duplicate; 8(701)/+7701 → duplicate;
 * совпавшие первые 60 символов с разным концом → разные; тот же текст
 * в другом ЖК допустим; повтор ID — отказ независимо от текста;
 * undated-первый + датированный-второй — фиксация сохранена в sightings.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { applyCommand, initialState } from '../../src/lib/domain';
import {
  adDedupeKey as parserKey,
  canonicalAdText as parserCanon,
  detectPlatform,
} from '../../src/lib/parser';
import {
  adDedupeKey as validationKey,
  canonicalAdText as validationCanon,
} from '../../src/lib/validation';
import { createTestDatabase } from '../helpers/database';
import type { AppState } from '../../src/lib/types';

const REVIEWER = 'test-analyst';
const COMMENT = 'Решение аналитика (synthetic fixture S3.2)';
const D = '2026-10-10';

/** Единый корпус: пары «один и тот же текст разным написанием» + одиночки. */
const DUPE_PAIRS = [
  {
    name: 'регистр/пробелы/переносы',
    a: 'Продам квартиру в строящемся доме. Звоните!',
    b: '  ПРОДАМ   квартиру\nв строящемся доме.   Звоните! ',
  },
  {
    name: 'телефон 8(701)…/+7701…',
    a: 'Бронь 500 000 тенге. Звоните 8(701)123-45-67!',
    b: 'Бронь 500 000 тенге. Звоните +7 701 123 45 67!',
  },
];

const stem60 = (
  'Продам квартиру в новом доме у парка, торг уместен, звоните ' + '·'.repeat(60)
).slice(0, 60);
const HEAD60_A = `${stem60}первый вариант конца объявления.`;
const HEAD60_B = `${stem60}второй вариант конца объявления.`;

function baseComplex(id: string) {
  return {
    id, name: `Synthetic ${id} (DEMO)`, city: 'Өскемен', address: `synthetic address ${id}`,
    developer: 'Synthetic Developer (DEMO)', bin: null, origin: 'test', stage: 'строится',
    readinessClaimed: null, readinessConfirmed: null, readinessSources: [],
    readinessClaimedSource: null,
    legalBasis: { type: 'unknown', status: 'unknown', source: '', checkedAt: D, reviewText: '' },
    note: 'synthetic fixture S3.2', factors: [], events: [], sources: [],
  };
}

const adInput = (over: {
  id: string; zkId: string; text: string; date?: string | null;
  platform?: string; url?: string; captureAt?: string;
}) => ({
  id: over.id, zkId: over.zkId, platform: over.platform ?? 'Krisha (DEMO)', account: 'demo',
  date: over.date === undefined ? '2026-10-05' : over.date,
  url: over.url ?? 'https://example.test/a', captureAt: over.captureAt ?? '2026-10-06',
  text: over.text,
});

const adCmd = (ad: ReturnType<typeof adInput>) => ({ type: 'ad', ad, decision: 'saved', comment: COMMENT });

function setup(...zkIds: string[]): AppState {
  let s = initialState();
  for (const id of zkIds) s = applyCommand(s, { type: 'complex', complex: baseComplex(id) }, REVIEWER);
  return s;
}

describe('S3.2 source contract: единый ключ zkId+canonicalText (TS)', () => {
  it('parser ≡ validation на всём корпусе', () => {
    const texts = [...DUPE_PAIRS.flatMap((p) => [p.a, p.b]), HEAD60_A, HEAD60_B];
    for (const t of texts) {
      expect(parserCanon(t)).toBe(validationCanon(t));
      expect(parserKey('ZK-S3', t)).toBe(validationKey('ZK-S3', t));
      expect(parserKey({ zkId: 'ZK-S3', text: t })).toBe(validationKey('ZK-S3', t));
    }
  });

  it('канон абсолютен: регистр/пробелы/телефон', () => {
    expect(parserCanon('  Продам КВАРТИРУ ')).toBe('продам квартиру');
    expect(parserCanon('Звоните 8(701)123-45-67')).toBe('звоните +77011234567');
    expect(parserCanon('Звоните +7 701 123 45 67')).toBe('звоните +77011234567');
  });

  it.each(DUPE_PAIRS)('$name → duplicate (один ключ)', ({ a, b }) => {
    expect(parserKey('ZK-S3', a)).toBe(parserKey('ZK-S3', b));
    expect(validationKey('ZK-S3', a)).toBe(validationKey('ZK-S3', b));
  });

  it('первые 60 совпадают, конец разный → разные ключи', () => {
    expect(HEAD60_A.slice(0, 60)).toBe(HEAD60_B.slice(0, 60));
    expect(parserKey('ZK-S3', HEAD60_A)).not.toBe(parserKey('ZK-S3', HEAD60_B));
  });

  it('тот же текст в другом ЖК допустим (ключи разные, оба сохраняются)', () => {
    const text = 'Внесите депозит 456 000 тенге для фиксации квартиры.';
    expect(parserKey('ZK-S3A', text)).not.toBe(parserKey('ZK-S3B', text));
    let s = setup('ZK-S3A', 'ZK-S3B');
    const n = s.ads.length;
    s = applyCommand(s, adCmd(adInput({ id: 'AD-S3A1', zkId: 'ZK-S3A', text })), REVIEWER);
    s = applyCommand(s, adCmd(adInput({ id: 'AD-S3B1', zkId: 'ZK-S3B', text })), REVIEWER);
    expect(s.ads).toHaveLength(n + 2);
  });

  it('повтор ID — отказ независимо от текста, state неподвижен', () => {
    let s = setup('ZK-S3I');
    s = applyCommand(s, adCmd(adInput({ id: 'AD-S3I1', zkId: 'ZK-S3I', text: 'Первый текст про депозит 100 000 тенге.' })), REVIEWER);
    const before = structuredClone(s);
    expect(() => applyCommand(s, adCmd(adInput({ id: 'AD-S3I1', zkId: 'ZK-S3I', text: 'Совсем другой текст про рассрочку.' })), REVIEWER))
      .toThrow(/повтор ID/);
    expect(s).toEqual(before);
  });

  it('точный повтор фиксации — отказ с ID существующей (граница S2.1)', () => {
    let s = setup('ZK-S3E');
    const text = 'Бронь квартиры — всего 500 000 тенге, сумма идёт в зачёт стоимости (DEMO).';
    s = applyCommand(s, adCmd(adInput({ id: 'AD-S3E1', zkId: 'ZK-S3E', text, date: null })), REVIEWER);
    const n = s.ads.length;
    const before = structuredClone(s);
    expect(() => applyCommand(s, adCmd(adInput({ id: 'AD-S3E2', zkId: 'ZK-S3E', text, date: null })), REVIEWER))
      .toThrow(/уже сохранена \(AD-S3E1\).*sightings/);
    expect(s).toEqual(before);
    expect(s.ads).toHaveLength(n);
  });

  it('undated-первый + датированный-второй: второго ad нет, фиксация сохранена', () => {
    let s = setup('ZK-S3U');
    const text = 'Старт продаж в строящемся доме, бронь 500 000 тенге (DEMO).';
    s = applyCommand(s, adCmd(adInput({ id: 'AD-S3U1', zkId: 'ZK-S3U', text, date: null })), REVIEWER);
    const n = s.ads.length;
    s = applyCommand(s, adCmd(adInput({
      id: 'AD-S3U2', zkId: 'ZK-S3U', text: '  СТАРТ продаж\nв строящемся доме, бронь 500 000 тенге (DEMO). ',
      date: '2026-10-07', platform: 'OLX (DEMO)', url: 'https://olx.kz/u2', captureAt: '2026-10-08',
    })), REVIEWER);
    // Второго ad нет…
    expect(s.ads).toHaveLength(n);
    expect(s.ads.some((a) => a.id === 'AD-S3U2')).toBe(false);
    // …а фиксация с датой/источником — есть; дата публикации осталась неизвестной.
    const kept = s.ads.find((a) => a.id === 'AD-S3U1')!;
    expect(kept.date).toBeNull();
    expect(kept.sightings).toHaveLength(1);
    expect(kept.sightings![0]).toMatchObject({ source: 'OLX (DEMO)', date: '2026-10-07', url: 'https://olx.kz/u2' });
    expect(kept.sightings![0].captureAt).toBe('2026-10-08');
  });
});

describe('S3.2 source contract: площадки по hostname (TS)', () => {
  it('krisha.kz и корректный subdomain — Krisha по ссылке', () => {
    expect(detectPlatform({ url: 'https://krisha.kz/a/123' })).toMatchObject({ key: 'krisha', via: 'url' });
    expect(detectPlatform({ url: 'https://sub.krisha.kz/a/123' })).toMatchObject({ key: 'krisha', via: 'url' });
  });

  it('похожие/вложенные/путевые/userinfo — не Krisha', () => {
    expect(detectPlatform({ url: 'https://evilkrisha.kz/a' }).key).not.toBe('krisha');
    expect(detectPlatform({ url: 'https://krisha.kz.evil.test/' }).key).not.toBe('krisha');
    expect(detectPlatform({ url: 'https://attacker.test/krisha.kz' }).key).not.toBe('krisha');
    expect(detectPlatform({ url: 'https://krisha.kz@evil.test/x' }).key).not.toBe('krisha');
  });

  it('ручная подсказка против URL — hint/manual, не проверенный домен', () => {
    const r = detectPlatform({ url: 'https://evilkrisha.kz/a', platform: 'krisha' });
    expect(r.key).toBe('krisha');
    expect(r.via).toBe('hint');
    expect(r.via).not.toBe('url');
  });
});

describe('S3.2 source contract: паритет TS/SQL на едином корпусе', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = (await createTestDatabase()).db;
  });
  afterAll(async () => { await db?.close(); });

  it('ad_dedupe_key совпадает с TS на всём корпусе × оба ЖК', async () => {
    const texts = [...DUPE_PAIRS.flatMap((p) => [p.a, p.b]), HEAD60_A, HEAD60_B];
    for (const zkId of ['ZK-S3', 'ZK-S3B']) {
      for (const t of texts) {
        const r = await db.query<{ k: string }>('select public.ad_dedupe_key($1,$2) as k', [zkId, t]);
        expect(r.rows[0].k).toBe(validationKey(zkId, t));
        expect(r.rows[0].k).toBe(parserKey(zkId, t));
      }
    }
  });

  it('SQL: пары-дубликаты схлопываются, чужие концы и чужие ЖК — нет', async () => {
    const key = async (zk: string, t: string) =>
      (await db.query<{ k: string }>('select public.ad_dedupe_key($1,$2) as k', [zk, t])).rows[0].k;
    for (const { a, b } of DUPE_PAIRS) expect(await key('ZK-S3', a)).toBe(await key('ZK-S3', b));
    expect(await key('ZK-S3', HEAD60_A)).not.toBe(await key('ZK-S3', HEAD60_B));
    const text = 'Внесите депозит 456 000 тенге для фиксации квартиры.';
    expect(await key('ZK-S3A', text)).not.toBe(await key('ZK-S3B', text));
  });
});
