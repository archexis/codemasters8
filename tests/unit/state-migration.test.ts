/**
 * S2.1 (C2). schemaVersion и загрузка: валидный v2, битый JSON,
 * отсутствующий adId/mediaId, future version, неизвестный status,
 * идемпотентность повтора, v1 metadata без bytes, снятие неподкреплённых
 * confirmed с provenance. Плюс серверный отказ записи при schemaVersion>3.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  FutureVersionError,
  RAW_BACKUP_KEY,
  V1_IMPORT_BACKUP_KEY,
  V1_STORAGE_KEY,
  V2_STORAGE_KEY,
  loadStateFromText,
  migrateLegacyV1,
  migrateV2ToV3,
  previewLegacyV1,
} from '../../src/lib/state-migrations';
import { validateLoadedState } from '../../src/lib/validation';
import { adDedupeKey, canonicalAdText, parseCommand } from '../../src/lib/validation';
import { createTestDatabase, login, userA } from '../helpers/database';

function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
    },
    configurable: true,
    writable: true,
  });
  return store;
}

const store = installMemoryStorage();

// Repository тянет supabase-клиент на импорте (import.meta.env из .env),
// поэтому грузим его динамически с пустыми env — тесты идут в DEMO-ветку
// localStorage, а не в server-ветку.
let repo: typeof import('../../src/lib/repository');
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
  repo = await import('../../src/lib/repository');
});

const AD_TEXT = 'Старт продаж в строящемся доме. Бронь квартиры — всего 500 000 тенге, сумма идёт в зачёт стоимости.';
const QUOTE = 'Бронь квартиры — всего 500 000 тенге, сумма идёт в зачёт стоимости';

interface V2Fixture {
  complexes: Array<Record<string, unknown> & { id: string; factors: Array<Record<string, unknown>>; readinessConfirmed: number | null; readinessSources: Array<Record<string, unknown>> }>;
  ads: Array<Record<string, unknown> & { id: string; zkId: string }>;
  media: Array<Record<string, unknown>>;
  signals: Record<string, unknown>;
  audit: Array<Record<string, unknown>>;
}

function v2Base(): V2Fixture {
  return {
    complexes: [
      {
        id: 'SQ-001',
        name: 'Тестовый квартал (DEMO)',
        city: 'Өскемен',
        address: 'ул. Вымышленная, 1 (DEMO)',
        developer: 'ТОО «Демо» (DEMO)',
        bin: null,
        origin: 'test',
        stage: 'Коробка',
        readinessClaimed: 60,
        readinessConfirmed: null,
        readinessSources: [{ value: 60, source: 'Реклама (DEMO-снимок)', date: '2026-10-02' }],
        readinessClaimedSource: { value: 60, source: 'Реклама (DEMO-снимок)', date: '2026-10-02' },
        legalBasis: { type: 'unknown', status: 'unknown', source: '', checkedAt: '2026-10-10', reviewText: '' },
        note: '',
        factors: [],
        events: [],
        sources: [],
      },
    ],
    ads: [
      {
        id: 'AD-001',
        zkId: 'SQ-001',
        platform: 'Krisha (демо)',
        account: '@demo',
        date: '2026-09-18',
        url: 'https://example.invalid/ad-001',
        captureAt: '2026-10-02',
        text: AD_TEXT,
      },
    ],
    media: [],
    signals: {},
    audit: [],
  };
}

function groundedR2() {
  return {
    code: 'R2',
    status: 'confirmed',
    evidence: { id: 'EV-1', zkId: 'SQ-001', kind: 'publication', source: 'Скриншот (DEMO)', date: '2026-10-02', adId: 'AD-001', quote: QUOTE },
    reviewer: 'demo.analyst',
    updatedAt: '2026-10-11T10:20:00+05:00',
  };
}

beforeEach(() => {
  store.clear();
});

describe('S2.1 state migration v2 → v3', () => {
  it('валидный v2 мигрирует в канон v3 без снятий', () => {
    const v2 = v2Base();
    v2.complexes[0].factors = [groundedR2()];
    const before = structuredClone(v2);
    const { state, migrated, notes, downgraded } = migrateV2ToV3(v2);
    expect(migrated).toBe(true);
    expect(downgraded).toEqual([]);
    expect(state.schemaVersion).toBe(3);
    expect(state.signalVersions).toEqual({});
    expect(state.complexes[0].factors[0].status).toBe('confirmed');
    expect(v2).toEqual(before); // вход не мутирует
    expect(notes.length).toBeGreaterThan(0);
    expect(() => validateLoadedState(state)).not.toThrow();
  });

  it('повтор миграции идемпотентен (deepEqual, без новых записей)', () => {
    const v2 = v2Base();
    v2.complexes[0].factors = [groundedR2()];
    const first = migrateV2ToV3(v2);
    const second = migrateV2ToV3(first.state);
    expect(second.migrated).toBe(false);
    expect(second.downgraded).toEqual([]);
    expect(second.state).toEqual(first.state);
    // И повтор от того же сырого v2 даёт тот же результат (вход не мутировал).
    expect(migrateV2ToV3(v2).state).toEqual(first.state);
  });

  it('отсутствующий adId: confirmed снимается с provenance, загрузка не падает', () => {
    const v2 = v2Base();
    v2.complexes[0].factors = [
      { ...groundedR2(), evidence: { ...(groundedR2().evidence as object), adId: 'AD-NOPE' } },
    ];
    const { state, migrated, downgraded } = migrateV2ToV3(v2);
    expect(migrated).toBe(true);
    expect(downgraded).toEqual(['SQ-001:R2']);
    const f = state.complexes[0].factors[0];
    expect(f.status).toBe('needs-verification');
    expect((f as { before?: unknown }).before).toMatchObject({ status: 'confirmed' });
    expect(state.audit[0]).toMatchObject({ action: 's2_1_migration', zkId: 'SQ-001' });
    expect(String(state.audit[0].comment)).toMatch(/AD-NOPE/);
    expect(() => validateLoadedState(state)).not.toThrow();
  });

  it('отсутствующий mediaId: R4 без текста и файла снимается, с файлом остаётся', () => {
    const v2 = v2Base();
    v2.complexes[0].factors = [
      {
        code: 'R4',
        status: 'confirmed',
        evidence: { id: 'EV-4', zkId: 'SQ-001', kind: 'document', source: 'Обращение (DEMO)', date: '2026-10-03', mediaIds: ['M-NOPE'] },
      },
      {
        code: 'R4',
        status: 'confirmed',
        evidence: { id: 'EV-4b', zkId: 'SQ-001', kind: 'document', source: 'Обращение (DEMO)', date: '2026-10-03', text: 'Коллективное обращение 14 дольщиков о привлечении средств, вх. № 1', mediaIds: ['M-1'] },
      },
    ];
    v2.media = [{ id: 'M-1', zkId: 'SQ-001', name: 'obr.pdf', kind: 'application/pdf', date: '2026-10-03', note: '', ready: null, path: 'demo/SQ-001/m1.pdf' }];
    const { state, downgraded } = migrateV2ToV3(v2);
    expect(downgraded).toEqual(['SQ-001:R4']);
    const byId = new Map(state.complexes[0].factors.map((f) => [f.evidence?.id, f]));
    expect(byId.get('EV-4')?.status).toBe('needs-verification');
    expect(byId.get('EV-4b')?.status).toBe('confirmed');
    expect(() => validateLoadedState(state)).not.toThrow();
  });

  it('future version: понятный отказ с исходником, без записи', () => {
    const text = JSON.stringify({ ...v2Base(), schemaVersion: 99 });
    let caught: unknown;
    try {
      loadStateFromText(text);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FutureVersionError);
    expect((caught as FutureVersionError).foundVersion).toBe(99);
    expect((caught as FutureVersionError).rawSource).toBe(text);
    expect(String((caught as Error).message)).toMatch(/schemaVersion=99/);
  });

  it('неизвестный status: отказ миграции с исходником', () => {
    const v2 = v2Base();
    v2.complexes[0].factors = [{ ...groundedR2(), status: 'approved' }];
    expect(() => migrateV2ToV3(v2)).toThrow(/неизвестный статус/);
  });

  it('orphan zkId сущности: отказ (некуда привязать)', () => {
    const v2 = v2Base();
    v2.ads[0].zkId = 'SQ-NOPE';
    expect(() => migrateV2ToV3(v2)).toThrow(/неизвестный объект/);
  });

  it('v1 metadata без bytes: валидна, байты не выдумываются', () => {
    const v2 = v2Base();
    v2.media = [{ id: 'M-1', zkId: 'SQ-001', name: 'scan.jpg', kind: 'image/jpeg', date: '2026-10-03', note: '', ready: null, path: 'demo/SQ-001/m1.jpg' }];
    const { state, notes } = migrateV2ToV3(v2);
    expect(state.media[0].bytes).toBeUndefined();
    expect(notes.join(' ')).toMatch(/без bytes\/sha256/);
    expect(() => validateLoadedState(state)).not.toThrow();
  });

  it('неподкреплённые confirmed (R2 без цитаты, R5 без разрыва) сняты с provenance', () => {
    const v2 = v2Base();
    v2.complexes[0].factors = [
      {
        code: 'R2',
        status: 'confirmed',
        evidence: { id: 'EV-2', zkId: 'SQ-001', kind: 'publication', source: 'Скриншот (DEMO)', date: '2026-10-02', adId: 'AD-001' },
      },
      {
        code: 'R5',
        status: 'confirmed',
        evidence: { id: 'EV-5', zkId: 'SQ-001', kind: 'observation', source: 'Осмотр (DEMO)', date: '2026-10-06' },
      },
    ];
    // Разрыва нет: заявлено 60, подтверждено 58.
    v2.complexes[0].readinessConfirmed = 58;
    v2.complexes[0].readinessSources.push({ value: 58, source: 'Осмотр (DEMO)', date: '2026-10-06' });
    const { state, downgraded } = migrateV2ToV3(v2);
    expect(downgraded.sort()).toEqual(['SQ-001:R2', 'SQ-001:R5']);
    for (const f of state.complexes[0].factors) {
      expect(f.status).toBe('needs-verification');
      expect((f as { before?: unknown }).before).toMatchObject({ status: 'confirmed' });
    }
    const entry = state.audit.find((e) => e.action === 's2_1_migration' && String(e.comment).includes('R5'));
    expect(entry?.evidence).toMatchObject({ id: 'EV-5' });
    expect(() => validateLoadedState(state)).not.toThrow();
  });
});

describe('S2.1 repository loadState', () => {
  it('битый JSON: отказ, исходник сохранён, ключ НЕ заменяется initialState', async () => {
    store.set(V2_STORAGE_KEY, '{oops-не-json');
    await expect(repo.loadState()).rejects.toThrow(/повреждён.*не JSON/);
    expect(store.get(V2_STORAGE_KEY)).toBe('{oops-не-json');
    expect(store.get(RAW_BACKUP_KEY)).toBe('{oops-не-json');
  });

  it('future version: отказ FutureVersionError, ключ и backup целы', async () => {
    const text = JSON.stringify({ ...v2Base(), schemaVersion: 99 });
    store.set(V2_STORAGE_KEY, text);
    await expect(repo.loadState()).rejects.toBeInstanceOf(FutureVersionError);
    expect(store.get(V2_STORAGE_KEY)).toBe(text);
    expect(store.get(RAW_BACKUP_KEY)).toBe(text);
    expect(repo.readRawBackup()).toBe(text);
  });

  it('v2 мигрирует и сохраняется, исходник — в backup', async () => {
    const v2 = v2Base();
    v2.complexes[0].factors = [groundedR2()];
    const text = JSON.stringify(v2);
    store.set(V2_STORAGE_KEY, text);
    const state = await repo.loadState();
    expect(state.schemaVersion).toBe(3);
    expect(store.get(RAW_BACKUP_KEY)).toBe(text);
    const stored = JSON.parse(store.get(V2_STORAGE_KEY)!);
    expect(stored.schemaVersion).toBe(3);
    // Второй load — без повторной миграции, состояние то же.
    expect(await repo.loadState()).toEqual(state);
  });

  it('legacy v1: только импорт из файла с preview, ключ v1 нетронут', async () => {
    store.set(V1_STORAGE_KEY, 'v1-raw-marker-не-трогать');
    const v1 = {
      complexes: [
        {
          id: 'SQ-V1',
          name: 'Старый объект',
          factors: [{ code: 'R2', status: 'confirmed', evidence: { id: 'EV-V1', zkId: 'SQ-V1', kind: 'publication', source: 'Скрин', date: '2026-10-02', adId: 'AD-MISS', quote: 'цитата' } }],
        },
      ],
      ads: [],
    };
    const fileText = JSON.stringify(v1);
    const preview = repo.previewLegacyV1File(fileText);
    expect(preview.detected).toBe(true);
    expect(preview.complexes).toBe(1);
    expect(preview.wouldDowngrade).toEqual(['SQ-V1:R2']);
    // loadState ключ v1 игнорирует: пустой ключ → свежий seed, не v1.
    expect(repo.hasLegacyV1Backup()).toBe(true);
    const fresh = await repo.loadState();
    expect(fresh.complexes.some((c) => c.id === 'SQ-V1')).toBe(false);
    // Импорт: downgrade + audit, ключ v1 нетронут.
    const imported = repo.importLegacyV1File(fileText);
    expect(imported.schemaVersion).toBe(3);
    expect(imported.complexes[0].factors[0].status).toBe('needs-verification');
    expect(store.get(V1_STORAGE_KEY)).toBe('v1-raw-marker-не-трогать');
    expect(store.get(V1_IMPORT_BACKUP_KEY)).toBe(fileText);
    expect(() => validateLoadedState(imported)).not.toThrow();
  });

  it('previewLegacyV1 не мутирует вход и честно говорит о мусоре', () => {
    const v1 = { complexes: [], ads: [] };
    const before = structuredClone(v1);
    expect(previewLegacyV1(v1).detected).toBe(true);
    expect(v1).toEqual(before);
    expect(previewLegacyV1({ nope: 1 }).detected).toBe(false);
    expect(() => migrateLegacyV1({ nope: 1 })).toThrow(/v1/);
  });
});

describe('S2.1 стыки аудита: null date, runId/hypothesisId, sightings, undated+dated', () => {
  it('v2 без даты публикации мигрирует в null, загрузка строгой схемы проходит', () => {
    const v2 = v2Base();
    delete (v2.ads[0] as Record<string, unknown>).date;
    v2.complexes[0].factors = [groundedR2()];
    const { state, migrated, notes } = migrateV2ToV3(v2);
    expect(migrated).toBe(true);
    expect(state.ads[0].date).toBeNull();
    expect(notes.join(' ')).toMatch(/null/);
    expect(() => validateLoadedState(state)).not.toThrow();
    // Повтор от мигрированного — no-op.
    expect(migrateV2ToV3(state).migrated).toBe(false);
  });

  it('runId/hypothesisId переживают миграцию v2→v3 и строгую загрузку', () => {
    const v2 = v2Base();
    const ev = { ...(groundedR2().evidence as object), runId: 'RUN-1', hypothesisId: 'H-2' };
    v2.complexes[0].factors = [{ ...groundedR2(), evidence: ev }];
    const { state } = migrateV2ToV3(v2);
    expect(state.complexes[0].factors[0].evidence).toMatchObject({ runId: 'RUN-1', hypothesisId: 'H-2' });
    expect(() => validateLoadedState(state)).not.toThrow();
  });

  it('sightings нескольких фиксаций переносятся и валидируются', () => {
    const v2 = v2Base();
    (v2.ads[0] as Record<string, unknown>).sightings = [
      { source: 'Krisha (DEMO)', date: '2026-09-18', url: 'https://example.invalid/a', captureAt: '2026-10-02' },
      { source: 'Перепост (DEMO)', date: null, captureAt: '2026-10-05' },
    ];
    const { state } = migrateV2ToV3(v2);
    expect(state.ads[0].sightings).toHaveLength(2);
    expect(state.ads[0].sightings?.[1].date).toBeNull();
    expect(() => validateLoadedState(state)).not.toThrow();
  });

  it('undated+dated: R3 по публикации с date=null без явной даты снимается; с датой в материале остаётся', () => {
    const mk = (text?: string) => {
      const v2 = v2Base();
      (v2.ads[0] as Record<string, unknown>).date = null;
      v2.complexes[0].factors = [{
        code: 'R3', status: 'confirmed',
        evidence: { id: 'EV-3', zkId: 'SQ-001', kind: 'publication', source: 'Скриншот (DEMO)', date: '2026-10-02', adId: 'AD-001', quote: QUOTE, ...(text ? { text } : {}) },
      }];
      return v2;
    };
    const noDated = migrateV2ToV3(mk());
    expect(noDated.downgraded).toEqual(['SQ-001:R3']);
    expect(noDated.state.complexes[0].factors[0].status).toBe('needs-verification');
    const dated = migrateV2ToV3(mk('На 2026-09-20 объект не введён в эксплуатацию (DEMO)'));
    expect(dated.downgraded).toEqual([]);
    expect(dated.state.complexes[0].factors[0].status).toBe('confirmed');
  });

  it('legacy v1: публикация без даты импортируется как null, runId переживает импорт', () => {
    const v1 = {
      complexes: [{
        id: 'SQ-V1', name: 'Старый объект',
        factors: [{ code: 'R2', status: 'confirmed', evidence: { id: 'EV-V1', zkId: 'SQ-V1', kind: 'publication', source: 'Скрин', date: '2026-10-02', adId: 'AD-V1', quote: 'текст объявления про бронь', runId: 'RUN-V1', hypothesisId: 'H-V1' } }],
      }],
      ads: [{ id: 'AD-V1', zkId: 'SQ-V1', platform: 'P', account: '@v1', text: 'текст объявления про бронь', url: '', captureAt: '2026-10-02' }],
    };
    const { state } = migrateLegacyV1(v1);
    expect(state.ads[0].date).toBeNull();
    // Цитата точна и ad привязан — confirmed сохраняется вместе с runId.
    expect(state.complexes[0].factors[0].status).toBe('confirmed');
    expect(state.complexes[0].factors[0].evidence).toMatchObject({ runId: 'RUN-V1', hypothesisId: 'H-V1' });
    expect(() => validateLoadedState(state)).not.toThrow();
  });
});

describe('S2.1 supabase: отказ записи при schemaVersion>3', () => {
  let db: PGlite;
  beforeEach(async () => {
    const tdb = await createTestDatabase();
    db = tdb.db;
    await login(db, userA);
    await db.query('select initialize_workspace()');
  });

  it('seed и новые workspace — v3; прямая запись future version отклоняется', async () => {
    const seed = await db.query<{ v: number; has_sv: boolean }>(
      "select (data->>'schemaVersion')::int as v, (data ? 'signalVersions') as has_sv from workspaces",
    );
    expect(seed.rows[0].v).toBe(3);
    expect(seed.rows[0].has_sv).toBe(true);
    // Прямая запись future-версии (роль с bypass RLS — эмуляция нового клиента):
    await expect(
      db.exec(`reset role; update public.workspaces set data = data || '{"schemaVersion": 99}' where owner_id='${userA}';`),
    ).rejects.toThrow(/FUTURE_SCHEMA_VERSION/);
    const after = await db.query<{ v: number }>("select (data->>'schemaVersion')::int as v from workspaces");
    expect(after.rows[0].v).toBe(3);
  });
});

describe('S2.1-стык#2 (C4): канонический ключ дедупа zkId+canonicalText', () => {
  it('телефоны 8→+7: одинаковый текст с разным написанием номера — один ключ', () => {
    const a = 'Продам квартиру. Звоните 8 701 123 45 67, торг уместен.';
    const b = 'Продам квартиру. Звоните +77011234567, торг уместен.';
    expect(canonicalAdText(a)).toBe(canonicalAdText(b));
    expect(canonicalAdText(a)).toContain('+77011234567');
    expect(adDedupeKey('SQ-001', a)).toBe(adDedupeKey('SQ-001', b));
  });

  it('пробелы/регистр/переносы не различают дубли', () => {
    const a = '  Продам   КВАРТИРУ\nв строящемся доме. ';
    const b = 'продам квартиру в строящемся доме.';
    expect(adDedupeKey('SQ-001', a)).toBe(adDedupeKey('SQ-001', b));
  });

  it('область — часть ключа: тот же текст в другом ЖК допустим', () => {
    const text = 'Внесите депозит 456 000 тенге для фиксации квартиры.';
    expect(adDedupeKey('SQ-001', text)).not.toBe(adDedupeKey('SQ-002', text));
  });

  it('разный текст в том же ЖК — разные ключи', () => {
    expect(adDedupeKey('SQ-001', 'Депозит 100 000 тенге.')).not.toBe(
      adDedupeKey('SQ-001', 'Депозит 200 000 тенге.'),
    );
  });

  it('разные телефоны — разные ключи (не ложный повтор)', () => {
    const a = 'Звоните 8 701 111 11 11, продам квартиру.';
    const b = 'Звоните 8 701 222 22 22, продам квартиру.';
    expect(adDedupeKey('SQ-001', a)).not.toBe(adDedupeKey('SQ-001', b));
  });
});

describe('S2.1-стык#2 (C5): структурные ссылки на будущий analysis_runs', () => {
  it('v3 с null-датой публикации и AI-полями evidence загружается строго', () => {
    const v2 = v2Base();
    (v2.ads[0] as Record<string, unknown>).date = null;
    const ev = {
      ...(groundedR2().evidence as object),
      runId: 'RUN-AI-1',
      hypothesisId: 'H-AI-7',
    };
    v2.complexes[0].factors = [{ ...groundedR2(), evidence: ev }];
    const { state } = migrateV2ToV3(v2);
    expect(state.ads[0].date).toBeNull();
    expect(state.complexes[0].factors[0].evidence).toMatchObject({
      runId: 'RUN-AI-1',
      hypothesisId: 'H-AI-7',
    });
    // Прямая сборка v3 (как придёт с S4-раннером): строгая загрузка проходит.
    const v3 = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    (v3 as { schemaVersion?: number }).schemaVersion = 3;
    expect(() => validateLoadedState(v3)).not.toThrow();
    expect(validateLoadedState(v3).ads[0].date).toBeNull();
  });

  it('hypothesisId без runId: отказ команды и отказ загрузки v3', () => {
    const bad = {
      type: 'factor', zkId: 'SQ-001', code: 'R2', status: 'confirmed',
      evidence: {
        id: 'EV-BAD', zkId: 'SQ-001', kind: 'publication', source: 'Скрин',
        date: '2026-10-02', adId: 'AD-001', quote: QUOTE, hypothesisId: 'H-ORPHAN',
      },
      comment: 'анализ',
    };
    expect(() => parseCommand(bad)).toThrow(/hypothesisId.*runId|runId/);
    const badAd = {
      type: 'ad',
      ad: {
        id: 'AD-9', zkId: 'SQ-001', platform: 'P', account: '@a',
        date: null, url: '', captureAt: '2026-10-02', text: 'текст объявления',
      },
      hypothesis: { code: 'R2', quote: 'текст', hypothesisId: 'H-ORPHAN' },
      decision: 'saved', comment: 'черновик',
    };
    expect(() => parseCommand(badAd)).toThrow(/hypothesisId.*runId|runId/);
    const v2 = v2Base();
    v2.complexes[0].factors = [{
      code: 'R2', status: 'hypothesis',
      evidence: {
        id: 'EV-H', zkId: 'SQ-001', kind: 'publication', source: 'Скрин',
        date: '2026-10-02', adId: 'AD-001', quote: QUOTE, hypothesisId: 'H-ORPHAN',
      },
    }];
    const { state, notes } = migrateV2ToV3(v2);
    // Миграция не выдумывает runId: сиротская ссылка срезана с пометкой, фактор цел.
    expect(state.complexes[0].factors[0].status).toBe('hypothesis');
    expect(state.complexes[0].factors[0].evidence).not.toHaveProperty('hypothesisId');
    expect(notes.join(' ')).toMatch(/сиротский hypothesisId/);
    // А строгая загрузка сиротскую ссылку ловит отказом.
    const broken = structuredClone(state);
    (broken.complexes[0].factors[0].evidence as unknown as Record<string, unknown>).hypothesisId = 'H-ORPHAN';
    expect(() => validateLoadedState(broken)).toThrow(/hypothesisId/);
  });
});

describe('S2.4 (C6): legacy-сигналы эпохи до снимков при миграции v2→v3', () => {
  function v2WithLegacySignal(status: string) {
    const v2 = v2Base();
    v2.complexes[0].factors = [groundedR2()];
    const snapshot = structuredClone(v2.complexes[0]);
    (v2 as unknown as Record<string, unknown>).signals = {
      'SQ-001': {
        status, snapshot, at: '2026-10-01T00:00:00.000Z',
        reviewer: 'old.analyst', comment: 'решение эпохи S1',
      },
    };
    return v2;
  }

  it('confirmed-указатель без версий → legacyIncomplete rev 1 без snapshot', () => {
    const { state, migrated, notes } = migrateV2ToV3(v2WithLegacySignal('confirmed'));
    expect(migrated).toBe(true);
    const versions = state.signalVersions?.['SQ-001'] ?? [];
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      id: 'legacy-SQ-001-r1', zkId: 'SQ-001', revision: 1,
      status: 'confirmed', legacyIncomplete: true, basedOnRevision: null,
    });
    expect(versions[0].snapshot).toBeUndefined();
    // Прошлое не восстановлено: указатель не тронут, snapshot не скопирован.
    expect(state.signals['SQ-001'].status).toBe('confirmed');
    expect(notes.join(' ')).toMatch(/legacyIncomplete/);
    expect(() => validateLoadedState(state)).not.toThrow();
    // Повтор от мигрированного — no-op, дублей нет.
    const second = migrateV2ToV3(state);
    expect(second.migrated).toBe(false);
    expect(second.state.signalVersions?.['SQ-001']).toHaveLength(1);
  });

  it('draft-указатель без решений не помечается (терять нечего)', () => {
    const { state } = migrateV2ToV3(v2WithLegacySignal('draft'));
    expect(state.signalVersions?.['SQ-001'] ?? []).toHaveLength(0);
    expect(() => validateLoadedState(state)).not.toThrow();
  });

  it('поддельная legacy-метка со snapshot — отказ загрузки', () => {
    const { state } = migrateV2ToV3(v2WithLegacySignal('confirmed'));
    const broken = structuredClone(state);
    const v = broken.signalVersions!['SQ-001'][0];
    (v as unknown as Record<string, unknown>).snapshot = structuredClone(broken.complexes[0]);
    expect(() => validateLoadedState(broken)).toThrow(/legacyIncomplete/);
  });
});
