/**
 * S1.4. Генератор SQL seed-миграции из src/lib/seed.json.
 *
 * seed.json — ЕДИНСТВЕННЫЙ источник данных: app_seed обновляется только
 * сгенерированной миграцией, руками SQL-пейлоад не правится.
 *
 * Использование:
 *   node tools/generate-seed.mjs --out supabase/migrations/<имя-через-supabase-CLI>.sql
 *   node tools/generate-seed.mjs --out <файл> --seed <путь-к-seed.json>
 *
 * Нормализация повторяет src/lib/validation.ts (normalizeSeedComplex), но
 * уважает ЯВНЫЕ kind/id/zkId/date/text доказательства из seed: S1.4
 * дополняет DEMO-материалы именно в seed.json, ничего не додумывая здесь.
 * Дефолты — только derivation (дата из captureAt публикации, kind из
 * наличия adId, readinessClaimedSource из readinessSources), не выдумка.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);

const KINDS = ['publication', 'legal-review', 'observation', 'document'];

function adById(ads, adId) {
  return ads.find((a) => a.id === adId);
}

function normalizeEvidence(raw, zkId, code, ads, legalCheckedAt) {
  const ev = raw && typeof raw === 'object' ? raw : {};
  const adId = typeof ev.adId === 'string' ? ev.adId : undefined;
  const ad = adId ? adById(ads, adId) : undefined;
  const kind =
    typeof ev.kind === 'string' && KINDS.includes(ev.kind)
      ? ev.kind
      : adId
        ? 'publication'
        : 'document';
  const out = {
    id: typeof ev.id === 'string' && ev.id ? ev.id : `seed-${zkId}-${code}`,
    zkId: typeof ev.zkId === 'string' && ev.zkId ? ev.zkId : zkId,
    kind,
    source: typeof ev.source === 'string' ? ev.source : '',
    date:
      typeof ev.date === 'string' && ev.date
        ? ev.date
        : (ad && ad.captureAt) || legalCheckedAt || '',
  };
  if (adId) out.adId = adId;
  if (typeof ev.quote === 'string') out.quote = ev.quote;
  if (typeof ev.text === 'string') out.text = ev.text;
  if (Array.isArray(ev.mediaIds)) out.mediaIds = ev.mediaIds;
  return out;
}

function normalizeComplex(raw, ads) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const zkId = s.id;
  if (typeof zkId !== 'string' || !zkId) throw new Error('seed: complex без id');
  const lb = s.legalBasis && typeof s.legalBasis === 'object' ? s.legalBasis : {};
  const readinessClaimed = s.readinessClaimed ?? null;
  const sources = Array.isArray(s.readinessSources) ? s.readinessSources : [];
  const claimedMatch =
    readinessClaimed != null ? sources.find((r) => r && r.value === readinessClaimed) : undefined;
  const out = {
    id: zkId,
    name: s.name ?? '',
    city: s.city ?? 'Өскемен',
    address: s.address ?? '',
    developer: s.developer ?? '',
    bin: s.bin ?? null,
  };
  if (s.lat !== undefined) out.lat = s.lat;
  if (s.lng !== undefined) out.lng = s.lng;
  if (s.demo !== undefined) out.demo = s.demo;
  out.origin = s.origin ?? 'seed';
  if (s.scenario !== undefined) out.scenario = s.scenario;
  if (s.registryId !== undefined) out.registryId = s.registryId;
  if (s.geoApprox !== undefined) out.geoApprox = s.geoApprox;
  if (s.authOrg !== undefined) out.authOrg = s.authOrg;
  out.stage = s.stage ?? '';
  out.readinessClaimed = readinessClaimed;
  out.readinessConfirmed = s.readinessConfirmed ?? null;
  out.readinessSources = sources;
  out.readinessClaimedSource =
    s.readinessClaimedSource ??
    (readinessClaimed != null && claimedMatch
      ? { value: claimedMatch.value, source: claimedMatch.source, date: claimedMatch.date }
      : null);
  out.legalBasis = {
    type: ['unknown', 'absent', 'guarantee', 'mio-permit'].includes(lb.type) ? lb.type : 'unknown',
    status: ['unknown', 'absent-verified', 'verified'].includes(lb.status) ? lb.status : 'unknown',
    source: lb.source ?? '',
    checkedAt: lb.checkedAt ?? '',
    reviewText: lb.reviewText ?? '',
  };
  out.note = s.note ?? '';
  out.factors = (Array.isArray(s.factors) ? s.factors : []).map((f) => ({
    code: f.code,
    status: f.status,
    evidence: normalizeEvidence(f.evidence, zkId, f.code, ads, out.legalBasis.checkedAt),
    ...(f.reviewer ? { reviewer: f.reviewer } : {}),
    ...(f.updatedAt ? { updatedAt: f.updatedAt } : {}),
  }));
  out.events = (Array.isArray(s.events) ? s.events : []).map((e) => ({
    date: e.date ?? '',
    text: e.text ?? '',
  }));
  out.sources = (Array.isArray(s.sources) ? s.sources : []).map((x) => ({
    title: x.title ?? '',
    date: x.date ?? '',
    ...(x.url ? { url: x.url } : {}),
  }));
  return out;
}

/** Конверт app_seed/workspaces из сырого seed.json (COMPLEXES/ADS).
 * Канон v3 (стык S1->S2): schemaVersion=3 + signalVersions={} — тот же
 * конверт, что кладёт миграция S2.1 поверх app_seed/initialize_workspace.
 * Без этих ключей JSON seed != initialize_workspace() после всех миграций. */
export function buildSeedEnvelope(seed) {
  if (!seed || !Array.isArray(seed.COMPLEXES)) throw new Error('seed: COMPLEXES должен быть массивом');
  if (!Array.isArray(seed.ADS)) throw new Error('seed: ADS должен быть массивом');
  const ads = seed.ADS.map((a) => ({ ...a }));
  return {
    schemaVersion: 3,
    complexes: seed.COMPLEXES.map((c) => normalizeComplex(c, ads)),
    ads,
    artifacts: Array.isArray(seed.ARTIFACTS) ? seed.ARTIFACTS.map((a) => ({ ...a })) : [],
    relations: Array.isArray(seed.RELATIONS) ? seed.RELATIONS.map((r) => ({ ...r })) : [],
    media: [],
    signals: {},
    signalVersions: {},
    audit: [],
  };
}

/**
 * Шаблон data migration S1.4. Логика фиксирована здесь, данные (пейлоад)
 * подставляет генератор из seed.json. Миграция:
 *  1. обновляет public.app_seed сгенерированным конвертом;
 *  2. прогоняет СУЩЕСТВУЮЩИЕ workspaces через migrate_s1_4_seed:
 *     пользовательские объекты НЕ заменяются новым seed — только
 *     confirmed без достаточных данных → needs-verification с сохранением
 *     исходного payload в factor.before + migration event в audit.
 *     Доказательства НЕ придумываются. Public snapshot (без confirmed)
 *     проходит нетронутым: provenance/дата сохраняются, live-проверкой
 *     снимок не становится.
 * Преобразование работает на disposable-копии (локальная переменная) и
 * применяется одним UPDATE на workspace — атомарно в транзакции миграции.
 * Идемпотентность: повторный прогон видит marker в audit и возвращает
 * данные без изменений (второго migration event нет).
 */
function migrationSql(envelopeJson) {
  return `-- S1.4. Seed integrity: старые факторы под новыми C1-правилами.
-- СГЕНЕРИРОВАНО tools/generate-seed.mjs из src/lib/seed.json — руками не править.
-- Неверная цитата R3 SQ-001 чинена данными (verbatim-фрагмент AD-001), правило
-- grounding не менялось. DEMO-материалы A/B/C дополнены в seed.json.
-- Миграции 001/002/C1/S1.2/S1.3 не тронуты.

create or replace function public.migrate_s1_4_seed(old_data jsonb) returns jsonb
language plpgsql set search_path = '' as $s14fn$
declare
  d jsonb := coalesce(old_data, '{"complexes":[],"ads":[],"media":[],"signals":{},"audit":[]}'::jsonb);
  ads jsonb := coalesce(d->'ads', '[]'::jsonb);
  z jsonb; fx jsonb; ev jsonb; code text; status text;
  ci integer; fi integer; n_c integer; n_f integer;
  downgraded text[]; reason text;
  stamp text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  f_out jsonb; entry jsonb;
begin
  -- Идемпотентность: marker прошлой миграции — вернуть как есть, без событий.
  if exists(
    select 1 from jsonb_array_elements(coalesce(d->'audit', '[]'::jsonb)) a
    where a->'details'->>'migration' = 's1.4-seed-integrity'
  ) then
    return d;
  end if;
  n_c := coalesce(jsonb_array_length(d->'complexes'), 0);
  for ci in 0..n_c - 1 loop
    z := d->'complexes'->ci;
    f_out := '[]'::jsonb;
    downgraded := '{}';
    n_f := coalesce(jsonb_array_length(z->'factors'), 0);
    for fi in 0..n_f - 1 loop
      fx := z->'factors'->fi;
      code := fx->>'code';
      status := fx->>'status';
      ev := fx->'evidence';
      if status = 'confirmed' and code in ('R1', 'R2', 'R3', 'R4', 'R5', 'R6') and ev is not null then
        begin
          -- Новый C1-валидатор (S1.2) с публикациями workspace: adId/quote
          -- сверяются как transactional copy. Ошибка = данных недостаточно.
          perform public.validate_factor(z, code, status, ev, ads);
        exception when others then
          get stacked diagnostics reason = MESSAGE_TEXT;
          -- Недостаточно данных: в needs-verification, исходный payload —
          -- в factor.before (status/evidence/reason). Ничего не выдумываем.
          fx := fx || jsonb_build_object(
            'status', 'needs-verification',
            'reviewer', 's1.4-migration',
            'updatedAt', stamp,
            'before', jsonb_build_object('status', 'confirmed', 'evidence', ev, 'reason', reason)
          );
          downgraded := downgraded || code;
        end;
      end if;
      f_out := f_out || jsonb_build_array(fx);
    end loop;
    -- Disposable-копия применяется одним присваиванием.
    d := jsonb_set(d, array['complexes', ci::text], jsonb_set(z, '{factors}', f_out));
    if array_length(downgraded, 1) > 0 then
      entry := jsonb_build_object(
        'id', gen_random_uuid(),
        'zkId', z->>'id',
        'at', stamp,
        'reviewer', 's1.4-migration',
        'action', 's1_4_migration',
        'comment', 'S1.4: confirmed без достаточных данных → needs-verification ('
          || array_to_string(downgraded, ', ')
          || '). Исходный payload сохранён в factor.before; доказательства не придуманы.',
        'details', jsonb_build_object(
          'migration', 's1.4-seed-integrity',
          'zkId', z->>'id',
          'downgraded', to_jsonb(downgraded)
        )
      );
      d := jsonb_set(d, '{audit}', jsonb_build_array(entry) || coalesce(d->'audit', '[]'::jsonb));
    end if;
  end loop;
  return d;
end;
$s14fn$;

-- Единственный источник app_seed — seed.json: полный конверт ниже сгенерирован.
update public.app_seed
set data = $seed$${envelopeJson}$seed$::jsonb
where id = true;

-- Существующие пользовательские workspaces: объекты НЕ заменяются новым seed,
-- только недостаточные confirmed переводятся в needs-verification (см. функцию).
-- Один UPDATE на workspace; вся миграция — одна транзакция.
do $s14apply$
declare
  r record;
begin
  for r in select owner_id, data from public.workspaces for update loop
    update public.workspaces
    set data = public.migrate_s1_4_seed(r.data), updated_at = now()
    where owner_id = r.owner_id;
  end loop;
end;
$s14apply$;
`;
}

function parseArgs(argv) {
  const args = { seed: join(REPO, 'src', 'lib', 'seed.json'), out: null, seedOnly: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) args.out = resolve(argv[++i]);
    else if (argv[i] === '--seed' && argv[i + 1]) args.seed = resolve(argv[++i]);
    else if (argv[i] === '--seed-only') args.seedOnly = true;
  }
  return args;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out) {
    console.error('Usage: node tools/generate-seed.mjs --out <migration.sql> [--seed src/lib/seed.json]');
    process.exit(1);
  }
  const seed = JSON.parse(readFileSync(args.seed, 'utf8'));
  const envelope = buildSeedEnvelope(seed);
  writeFileSync(args.out, args.seedOnly
    ? `-- Generated from src/lib/seed.json; existing workspaces and history are preserved.\nbegin;\nupdate public.app_seed set data = $seed$${JSON.stringify(envelope)}$seed$::jsonb where id = true;\ncommit;\n`
    : migrationSql(JSON.stringify(envelope)));
  console.log(`wrote ${args.out} (${envelope.complexes.length} complexes, ${envelope.ads.length} ads)`);
}
