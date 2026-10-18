/**
 * S2.5 (C3) + S2.6. Backup/restore ZIP, import provenance, двухпользовательская
 * изоляция. Red→green для S2.5/S2.6.
 *
 * Документированная таблица преобразований (C3), проверяемая здесь и в SQL:
 *  confirmed → needs-verification; signals → draft; origin → imported;
 *  история помечается imported + import event; receipts/квоты/авторизация
 *  не импортируются. Roundtrip сравнивает тексты/источники/IDs/связи/байты
 *  с учётом таблицы — побитовая идентичность workspace НЕ заявляется.
 */
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_MAX_FILES,
  archivePathFor,
  applyImportTransform,
  buildBackup,
  createZipStore,
  isRestoreTargetEmpty,
  parseZipStore,
  previewRestore,
  sha256Hex,
  validateBackupPackage,
} from '../../src/lib/backup';
import type { AppState } from '../../src/lib/types';
import { computeScore } from '../../src/lib/scoring';
import { login, logoutAnon, userA, userB } from '../helpers/database';

/**
 * Изолированный bootstrap для зоны S2.5/S2.6: та же PGlite-схема, что в
 * tests/helpers/database (auth/storage/users), затем ВСЕ миграции по порядку.
 * Файл, сломанный чужим in-progress WIP, не роняет всю зону: пропуск разрешён
 * только для явно перечисленных WIP-файлов (сейчас — S2.2 receipts, чинит
 * владелец зоны; restore от receipts не зависит — C3 их не импортирует).
 * Любой другой падающий файл — ошибка. Когда S2.2 позеленеет, его файл
 * подхватится автоматически (пропуск — только при падении).
 */
const KNOWN_WIP_SKIP = new Set([
  // S2.2 receipts: синтаксис чанка 2 (окрестность apply_command.command_id). Чинит владелец зоны.
  '20261018130000_s2_2_receipts.sql',
  // S2.4 signals: revoke on function mark_legacy_signals ДО её create (~строка 312).
  // Семантического конфликта с restore нет: target пуст (audit []), append-only
  // триггер на пустой истории проходит; перепроверить при зелёном S2.4.
  '20261018180000_s2_4_signals.sql',
]);

async function createBackupTestDatabase() {
  const db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated; grant select,insert,delete on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
insert into auth.users values('${userA}','a@example.test'),('${userB}','b@example.test');`,
  );
  const dir = 'supabase/migrations';
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const file of listMigrationFiles(dir)) {
    try {
      await db.exec(readFileSync(join(dir, file), 'utf8'));
      applied.push(file);
    } catch (e) {
      if (!KNOWN_WIP_SKIP.has(file)) throw e;
      skipped.push(file);
    }
  }
  return { db, applied, skipped };
}

function listMigrationFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f: string) => f.endsWith('.sql'))
    .sort();
}

const te = () => new TextEncoder();
const td = () => new TextDecoder();

const QUOTE = 'Бронь квартиры — всего 500 000 тенге, сумма идёт в зачёт стоимости';
const AD_TEXT = `Старт продаж в строящемся доме. ${QUOTE}.`;
const FILE_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

/** Поддельный confirmed-пакет: R1+R2 confirmed без настоящих материалов. */
function fakeConfirmedState(): AppState {
  return {
    schemaVersion: 3,
    complexes: [{
      id: 'SQ-001', name: 'Тестовый', city: 'Тест', address: 'ул. Тестовая, 1',
      developer: 'Тест', bin: null, origin: 'scenario', stage: 'строится',
      readinessClaimed: null, readinessConfirmed: null, readinessSources: [],
      readinessClaimedSource: null,
      legalBasis: { type: 'unknown', status: 'unknown', source: '', checkedAt: '2026-01-01', reviewText: '' },
      note: '', events: [], sources: [],
      factors: [
        {
          code: 'R1', status: 'confirmed',
          evidence: { id: 'ev-r1', zkId: 'SQ-001', kind: 'legal-review', source: 'фальшивка', date: '2026-01-02', text: 'выдуманная сверка' },
          reviewer: 'attacker@example.test', updatedAt: '2026-01-02T00:00:00.000Z',
        },
        {
          code: 'R2', status: 'confirmed',
          evidence: { id: 'ev-r2', zkId: 'SQ-001', kind: 'publication', source: 'фальшивка', date: '2026-01-02', adId: 'ad-1', quote: QUOTE },
          reviewer: 'attacker@example.test', updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    }],
    ads: [{
      id: 'ad-1', zkId: 'SQ-001', platform: 'test', account: 'test', date: null,
      url: 'https://example.test/ad', captureAt: '2026-01-02T00:00:00.000Z', text: AD_TEXT, decision: 'confirmed',
    }],
    media: [{
      id: 'm-1', zkId: 'SQ-001', name: 'photo.png', kind: 'image/png', date: '2026-01-02',
      note: '', ready: null, path: `old-owner/SQ-001/m-1.png`, bytes: FILE_BYTES.length, capturedAt: '2026-01-02',
    }],
    signals: { 'SQ-001': { status: 'confirmed', at: '2026-01-03T00:00:00.000Z', reviewer: 'attacker@example.test', comment: 'фальшивый сигнал' } },
    signalVersions: {},
    audit: [{
      id: 'a1', zkId: 'SQ-001', at: '2026-01-02T00:00:00.000Z', reviewer: 'attacker@example.test',
      action: 'factor', comment: 'фальшивка', details: { type: 'factor' },
    }],
  };
}

const EMPTY_WORKSPACE = {
  schemaVersion: 3, complexes: [], ads: [], media: [], signals: {}, signalVersions: {}, audit: [],
};

describe('S2.5 backup: сборка и проверка пакета', () => {
  it('roundtrip: manifest/IDs/связи/байты совпадают, хеши верны', async () => {
    const state = fakeConfirmedState();
    const { zip, manifest } = await buildBackup(state, new Map([['m-1', FILE_BYTES]]));
    expect(manifest.version).toBe(BACKUP_FORMAT_VERSION);
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0]).toMatchObject({
      mediaId: 'm-1', archivePath: archivePathFor('m-1', 'photo.png'), bytes: FILE_BYTES.length,
    });
    expect(manifest.files[0].sha256).toBe(await sha256Hex(FILE_BYTES));
    const names = parseZipStore(zip).map((e) => e.name).sort();
    expect(names).toEqual(['files/m-1.png', 'manifest.json', 'workspace.json']);
    const validated = await validateBackupPackage(zip);
    expect(validated.workspace.ads[0].text).toBe(AD_TEXT);
    expect(validated.workspace.complexes[0].factors.map((f) => f.code).sort()).toEqual(['R1', 'R2']);
    expect(validated.files.get('m-1')).toEqual(FILE_BYTES);
  });

  it('таблица преобразований: preview заранее показывает confirmed→verify и signals→draft', () => {
    const preview = previewRestore(fakeConfirmedState());
    expect(preview.confirmedToVerify).toEqual([
      { zkId: 'SQ-001', code: 'R1' },
      { zkId: 'SQ-001', code: 'R2' },
    ]);
    expect(preview.signalsToDraft).toEqual(['SQ-001']);
    expect(preview.mediaCount).toBe(1);
    expect(preview.auditNote).toMatch(/needs-verification/);
  });

  it('import: статусы сняты, origin=imported, import event, receipts/квоты отброшены', async () => {
    const state = fakeConfirmedState();
    (state as unknown as Record<string, unknown>).command_receipts = [{ command_id: 'x' }];
    (state as unknown as Record<string, unknown>).ai_usage = { count: 99 };
    const imported = applyImportTransform(state, 'importer@example.test');
    // Вход не мутируется.
    expect(state.complexes[0].origin).toBe('scenario');
    expect(imported.complexes[0].origin).toBe('imported');
    // IDs/связи/тексты/источники сохранены.
    expect(imported.complexes[0].factors.map((f) => f.code).sort()).toEqual(['R1', 'R2']);
    expect(imported.complexes[0].factors.every((f) => f.status === 'needs-verification')).toBe(true);
    expect(imported.complexes[0].factors[1].evidence?.quote).toBe(QUOTE);
    expect(imported.ads[0].text).toBe(AD_TEXT);
    expect(imported.media[0].id).toBe('m-1');
    expect(imported.signals['SQ-001'].status).toBe('draft');
    // История помечена imported + import event первым.
    expect(imported.audit[0].action).toBe('import');
    expect(imported.audit[0].reviewer).toBe('importer@example.test');
    expect((imported.audit[1].details as { origin: string }).origin).toBe('imported');
    // Receipts/квоты/авторизация не импортируются.
    expect((imported as unknown as Record<string, unknown>).command_receipts).toBeUndefined();
    expect((imported as unknown as Record<string, unknown>).ai_usage).toBeUndefined();
    expect(imported.schemaVersion).toBe(3);
  });

  it('поддельный confirmed не начисляет баллы после импорта', () => {
    const state = fakeConfirmedState();
    // До импорта фальшивка выглядит «красной» — именно поэтому restore её снимает.
    expect(computeScore(state.complexes[0].factors).score).toBeGreaterThan(0);
    const imported = applyImportTransform(state, 'importer@example.test');
    const { score, confirmed } = computeScore(imported.complexes[0].factors);
    expect(score).toBe(0);
    expect(confirmed).toEqual([]);
  });

  it('цель restore: пустое vs непустое', () => {
    expect(isRestoreTargetEmpty(EMPTY_WORKSPACE as AppState)).toBe(true);
    expect(isRestoreTargetEmpty(fakeConfirmedState())).toBe(false);
    // Seed-комплексы без решений пустоту не нарушают — заменяются целиком.
    const seedLike = { ...EMPTY_WORKSPACE, complexes: [{ ...fakeConfirmedState().complexes[0], factors: [] }] };
    expect(isRestoreTargetEmpty(seedLike as unknown as AppState)).toBe(true);
  });

  it('DEMO-разделение: модуль чистый, байты и состояние — явные аргументы', async () => {
    expect((globalThis as unknown as Record<string, unknown>).localStorage).toBeUndefined();
    const state = fakeConfirmedState();
    const first = await buildBackup(state, { 'm-1': FILE_BYTES });
    const second = await buildBackup(state, new Map([['m-1', FILE_BYTES]]));
    expect(first.manifest.files).toEqual(second.manifest.files);
  });
});

describe('S2.5 backup: negative tests (path/size/missing)', () => {
  async function fullZip(): Promise<Uint8Array> {
    return (await buildBackup(fakeConfirmedState(), new Map([['m-1', FILE_BYTES]]))).zip;
  }

  it('отказ при ../ и абсолютных путях', async () => {
    const zip = createZipStore([
      { name: 'manifest.json', data: te().encode('{}') },
      { name: 'workspace.json', data: te().encode('{}') },
      { name: '../evil.txt', data: te().encode('x') },
    ]);
    await expect(validateBackupPackage(zip)).rejects.toThrow(/BACKUP_BAD_PATH/);
    const abs = createZipStore([
      { name: 'manifest.json', data: te().encode('{}') },
      { name: 'workspace.json', data: te().encode('{}') },
      { name: '/tmp/evil.txt', data: te().encode('x') },
    ]);
    await expect(validateBackupPackage(abs)).rejects.toThrow(/BACKUP_BAD_PATH/);
  });

  it('отказ при >100 файлов (до выделения буферов)', async () => {
    const entries = [
      { name: 'manifest.json', data: te().encode(JSON.stringify({ version: 1, files: [] })) },
      { name: 'workspace.json', data: te().encode('{}') },
      ...Array.from({ length: BACKUP_MAX_FILES + 1 }, (_, i) => ({ name: `files/m-${i}.bin`, data: new Uint8Array([i % 256]) })),
    ];
    const zip = createZipStore(entries);
    await expect(validateBackupPackage(zip)).rejects.toThrow(/BACKUP_TOO_MANY_FILES/);
  });

  it('отказ при суммарном размере >200 МБ (по declared size, до распаковки)', async () => {
    const zip = createZipStore([
      { name: 'manifest.json', data: te().encode('{}') },
      { name: 'workspace.json', data: te().encode('{}') },
      { name: 'files/m-1.bin', data: new Uint8Array([9]) },
    ]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let eocd = -1;
    for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    const centralStart = view.getUint32(eocd + 16, true);
    const patched = zip.slice();
    const pview = new DataView(patched.buffer, patched.byteOffset, patched.byteLength);
    // Подменяем declared sizes на 300 МБ: отказ обязан случиться до чтения данных.
    for (let i = 0; i < 3; i++) {
      const nameLen = pview.getUint16(centralStart + 28 + i * 0, true);
      void nameLen;
      break;
    }
    pview.setUint32(centralStart + 20, 300_000_000, true);
    pview.setUint32(centralStart + 24, 300_000_000, true);
    await expect(validateBackupPackage(patched)).rejects.toThrow(/BACKUP_TOO_LARGE/);
  });

  it('отказ при отсутствующем файле из manifest — с перечнем', async () => {
    const zip = await fullZip();
    const kept = parseZipStore(zip).filter((e) => e.name !== 'files/m-1.png');
    const repacked = createZipStore(kept.map((e) => ({ name: e.name, data: e.data })));
    await expect(validateBackupPackage(repacked)).rejects.toThrow(/m-1/);
  });

  it('отказ при неверном sha256 — с перечнем', async () => {
    const zip = await fullZip();
    const entries = parseZipStore(zip).map((e) =>
      e.name === 'files/m-1.png' ? { name: e.name, data: new Uint8Array([9, 9, 9]) } : { name: e.name, data: e.data },
    );
    await expect(validateBackupPackage(createZipStore(entries))).rejects.toThrow(/sha256/);
  });

  it('отказ при битой ссылке evidence.adId', async () => {
    const zip = await fullZip();
    const entries = parseZipStore(zip).map((e) => {
      if (e.name !== 'workspace.json') return { name: e.name, data: e.data };
      const ws = JSON.parse(td().decode(e.data)) as AppState;
      ws.complexes[0].factors[1].evidence!.adId = 'ad-ghost';
      return { name: e.name, data: te().encode(JSON.stringify(ws)) };
    });
    await expect(validateBackupPackage(createZipStore(entries))).rejects.toThrow(/BACKUP_BAD_LINKS.*ad-ghost/);
  });

  it('отказ при future schemaVersion', async () => {
    const zip = await fullZip();
    const entries = parseZipStore(zip).map((e) => {
      if (e.name !== 'workspace.json') return { name: e.name, data: e.data };
      const ws = { ...(JSON.parse(td().decode(e.data)) as object), schemaVersion: 99 };
      return { name: e.name, data: te().encode(JSON.stringify(ws)) };
    });
    await expect(validateBackupPackage(createZipStore(entries))).rejects.toThrow(/BACKUP_FUTURE_SCHEMA/);
  });

  it('подписанные URL в manifest запрещены', async () => {
    const zip = await fullZip();
    const entries = parseZipStore(zip).map((e) => {
      if (e.name !== 'manifest.json') return { name: e.name, data: e.data };
      const m = JSON.parse(td().decode(e.data)) as Record<string, unknown>;
      m['signedUrl'] = 'https://example.test/signed';
      return { name: e.name, data: te().encode(JSON.stringify(m)) };
    });
    await expect(validateBackupPackage(createZipStore(entries))).rejects.toThrow(/BACKUP_BAD_MANIFEST/);
  });
});

describe('S2.6 изоляция: RLS workspace/Storage, ссылки, restore RPC', () => {
  let db: PGlite;
  const emptyData = JSON.stringify(EMPTY_WORKSPACE);

  async function freshDb(): Promise<PGlite> {
    const created = await createBackupTestDatabase();
    db = created.db;
    expect(created.applied.some((f) => f.includes('s2_5_restore'))).toBe(true);
    return db;
  }

  async function restoreAs(user: string, pkg: unknown): Promise<{ data: AppState; version: number }> {
    await login(db, user);
    const result = await db.query<{ r: { data: AppState; version: number } }>(
      'select public.restore_workspace($1::jsonb) as r', [JSON.stringify(pkg)],
    );
    return result.rows[0].r;
  }

  async function backupPackageFor(stagedPath: string) {
    const state = fakeConfirmedState();
    const { manifest } = await buildBackup(state, new Map([['m-1', FILE_BYTES]]));
    return { manifest, workspace: state, staged: [{ mediaId: 'm-1', path: stagedPath }] };
  }

  it('B не читает workspace/media A; anonymous denied', async () => {
    await freshDb();
    await db.exec(
      `insert into public.workspaces(owner_id,data,version) values('${userA}','${emptyData}'::jsonb,1),('${userB}','${emptyData}'::jsonb,1);` +
      `insert into storage.objects(bucket_id,name) values('evidence','${userA}/SQ-001/m-1.png'),('evidence','${userB}/SQ-001/m-9.png');`,
    );
    await login(db, userB);
    const ws = await db.query<{ owner_id: string }>('select owner_id from public.workspaces');
    expect(ws.rows.map((r) => r.owner_id)).toEqual([userB]);
    const objs = await db.query<{ name: string }>('select name from storage.objects');
    expect(objs.rows.map((r) => r.name)).toEqual([`${userB}/SQ-001/m-9.png`]);
    await logoutAnon(db);
    // Сервер анонимов отклоняет: нет грантов/политик для anon — отказ, а не пустые строки.
    await expect(db.query('select * from public.workspaces')).rejects.toThrow();
    await expect(db.query('select * from storage.objects')).rejects.toThrow();
  }, 120000);

  it('A не удаляет файл, используемый принятым evidence; unused staged удалить может', async () => {
    await freshDb();
    const state = fakeConfirmedState();
    state.media[0].path = `${userA}/SQ-001/m-1.png`;
    state.complexes[0].factors[1].evidence!.mediaIds = ['m-1'];
    await db.exec(
      `insert into public.workspaces(owner_id,data,version) values('${userA}','${JSON.stringify(state).replace(/'/g, "''")}'::jsonb,1);` +
      `insert into storage.objects(bucket_id,name) values('evidence','${userA}/SQ-001/m-1.png'),('evidence','${userA}/SQ-001/staged-tmp.bin');`,
    );
    await login(db, userA);
    // Связанный файл: delete молча не удаляет (policy), строка на месте.
    await db.query('delete from storage.objects where bucket_id=$1 and name=$2', ['evidence', `${userA}/SQ-001/m-1.png`]);
    const kept = await db.query<{ name: string }>('select name from storage.objects order by name');
    expect(kept.rows.map((r) => r.name)).toContain(`${userA}/SQ-001/m-1.png`);
    // Несвязанный staged: удаление разрешено.
    await db.query('delete from storage.objects where bucket_id=$1 and name=$2', ['evidence', `${userA}/SQ-001/staged-tmp.bin`]);
    const after = await db.query<{ name: string }>('select name from storage.objects order by name');
    expect(after.rows.map((r) => r.name)).toEqual([`${userA}/SQ-001/m-1.png`]);
  }, 120000);

  it('B не удаляет файл A (чужой prefix запрещён)', async () => {
    await freshDb();
    await db.exec(
      `insert into storage.objects(bucket_id,name) values('evidence','${userA}/SQ-001/m-1.png');`,
    );
    await login(db, userB);
    await db.query('delete from storage.objects where bucket_id=$1 and name=$2', ['evidence', `${userA}/SQ-001/m-1.png`]);
    await logoutAnon(db);
    await db.exec('reset role;');
    const kept = await db.query<{ name: string }>("select name from storage.objects where name='x' or true");
    expect(kept.rows.map((r) => r.name)).toContain(`${userA}/SQ-001/m-1.png`);
  });

  it('restore в пустое workspace: сверка данных/связей/байтов с учётом преобразований', async () => {
    await freshDb();
    const stagedPath = `${userA}/SQ-001/m-1.png`;
    await db.exec(`insert into storage.objects(bucket_id,name) values('evidence','${stagedPath}');`);
    const pkg = await backupPackageFor(stagedPath);
    const result = await restoreAs(userA, pkg);
    const data = result.data;
    // IDs/связи/тексты/источники сохранены.
    expect(data.complexes[0].factors.map((f) => f.code).sort()).toEqual(['R1', 'R2']);
    expect(data.complexes[0].factors[1].evidence?.quote).toBe(QUOTE);
    expect(data.ads[0].text).toBe(AD_TEXT);
    expect(data.ads[0].id).toBe('ad-1');
    // Преобразования C3 применены серверно.
    expect(data.complexes.every((z) => z.origin === 'imported')).toBe(true);
    expect(data.complexes[0].factors.every((f) => f.status === 'needs-verification')).toBe(true);
    expect(data.signals['SQ-001'].status).toBe('draft');
    expect(data.audit[0].action).toBe('import');
    expect((data.audit[1].details as { origin: string }).origin).toBe('imported');
    // Owner-prefix переназначен, bytes/sha из manifest.
    expect(data.media[0].path).toBe(stagedPath);
    expect(data.media[0].bytes).toBe(FILE_BYTES.length);
    expect(data.media[0].sha256).toBe(await sha256Hex(FILE_BYTES));
    // Поддельный confirmed баллов не даёт.
    expect(computeScore(data.complexes[0].factors).score).toBe(0);
  });

  it('restore в непустое workspace — отказ без изменений', async () => {
    await freshDb();
    const stagedPath = `${userA}/SQ-001/m-1.png`;
    await db.exec(`insert into storage.objects(bucket_id,name) values('evidence','${stagedPath}');`);
    const pkg = await backupPackageFor(stagedPath);
    await restoreAs(userA, pkg);
    await expect(restoreAs(userA, pkg)).rejects.toThrow(/RESTORE_TARGET_NOT_EMPTY/);
    await login(db, userA);
    const current = await db.query<{ version: number }>('select version from public.workspaces where owner_id=current_setting(\'request.jwt.claim.sub\')::uuid');
    // Первая (и единственная) запись: insert дал version 0 → restore поднял до 1.
    expect(current.rows[0].version).toBe(1);
  });

  it('restore без staged-файла блокируется с перечнем', async () => {
    await freshDb();
    const pkg = await backupPackageFor(`${userB}/SQ-001/m-1.png`);
    await expect(restoreAs(userB, pkg)).rejects.toThrow(/RESTORE_MISSING_FILES.*m-1/);
  });

  it('restore с чужим staged-путем блокируется (не раскрывает чужое)', async () => {
    await freshDb();
    await db.exec(`insert into storage.objects(bucket_id,name) values('evidence','${userA}/SQ-001/m-1.png');`);
    const pkg = await backupPackageFor(`${userA}/SQ-001/m-1.png`);
    await expect(restoreAs(userB, pkg)).rejects.toThrow(/RESTORE_MISSING_FILES/);
  });

  it('restore битого пакета: future schema и плохие ссылки — отказ SQL', async () => {
    await freshDb();
    const stagedPath = `${userA}/SQ-001/m-1.png`;
    await db.exec(`insert into storage.objects(bucket_id,name) values('evidence','${stagedPath}');`);
    const pkg = await backupPackageFor(stagedPath);
    (pkg.workspace as AppState).schemaVersion = 99;
    await expect(restoreAs(userA, pkg)).rejects.toThrow(/RESTORE_FUTURE_SCHEMA/);
    const pkg2 = await backupPackageFor(stagedPath);
    (pkg2.workspace as AppState).complexes[0].factors[1].evidence!.adId = 'ad-ghost';
    await expect(restoreAs(userA, pkg2)).rejects.toThrow(/RESTORE_BAD_LINKS/);
  });
});
