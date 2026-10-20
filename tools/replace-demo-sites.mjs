/** Real building locations; all dossier content is fictional. No random coordinates.
 * Run: node tools/replace-demo-sites.mjs <new-migration-path>
 * Location provenance is kept outside the application dossiers to avoid treating
 * a map directory as evidence for fictional legal or financial assertions.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildSeedEnvelope } from './generate-seed.mjs';

const migrationPath = process.argv[2];
if (!migrationPath) throw new Error('Pass the migration path created by supabase migration new');
const locations = JSON.parse(readFileSync(new URL('./real-site-locations.json', import.meta.url), 'utf8'));
const names = ['Янтарный мыс', 'Кедровый горизонт', 'Лунный сад', 'Тихая гавань', 'Медный квартал', 'Облачный двор', 'Сосновый берег', 'Северный атлас'];
const developers = ['Маяк Девелопмент', 'Кедр Проект', 'Луна Строй', 'Гавань Групп', 'Медь Инвест', 'Облако Девелопмент', 'Сосна Проект', 'Атлас Строй'];
const readiness = [62, 55, 88, 93, 48, 74, 41, 5];
const date = '2026-10-20';
const notice = 'Реальны только координаты стройплощадки. Название, адрес, застройщик, документы, публикации, сроки, готовность и оценки вымышлены. Не характеризует реальный объект.';
const ADS = [];
const COMPLEXES = locations.map((location, i) => {
  const { id, lat, lng } = location;
  const adId = `AD-${String(i + 1).padStart(3, '0')}`;
  const sale = `Открыты продажи квартир в строящемся ЖК «${names[i]}», ввод по демосценарию — в 2027 году.`;
  const payment = 'Резервирование квартиры — 450 000 тенге с зачётом в стоимость.';
  ADS.push({ id: adId, zkId: id, platform: 'Демо-публикация', account: `demo_project_${i + 1}`, date,
    url: `https://example.invalid/projects/${id}/publication`, captureAt: date,
    text: `ВЫМЫШЛЕННЫЙ МАТЕРИАЛ. ${sale}${[0, 1, 4].includes(i) ? ` ${payment}` : ''} ${notice}` });
  const evidence = (code, kind, extra = {}) => ({ id: `seed-${id}-${code}`, zkId: id, kind,
    source: 'Вымышленный материал демосценария', date, ...extra });
  const factor = (code, kind, extra = {}, status = 'confirmed') => ({ code, status,
    evidence: evidence(code, kind, extra), reviewer: 'demo.analyst', updatedAt: `${date}T10:00:00+05:00` });
  const factors = i === 3 ? [] : [factor('R3', 'publication', { adId, quote: sale,
    text: `На ${date} по вымышленному акту объект не введён; демосрок ввода — 2027 год.` })];
  if ([0, 1, 4].includes(i)) factors.unshift(factor('R2', 'publication', { adId, quote: payment }));
  if (i === 1) factors.unshift(factor('R1', 'legal-review', { text: `Вымышленная сверка DEMO-${id} от ${date}: в учебном реестре основание отсутствует. ${notice}` }));
  if (i === 4) factors.push(factor('R6', 'document', { text: `Вымышленный акт от ${date}: демосрок 2026-08-01 пропущен на 80 дней; требуется проверка графика.` }));
  if (i === 5) factors.push(factor('R4', 'document', { text: `Вымышленное коллективное обращение от ${date}: 12 учебных заявителей сообщили о привлечении средств по демосценарию.` }));
  if ([1, 6].includes(i)) factors.push(factor('R5', 'observation', { text: 'Учебная гипотеза: требуется второе наблюдение готовности.' }, 'hypothesis'));
  if ([0, 5, 6].includes(i)) factors.push(factor('R1', 'legal-review', { text: 'В демосценарии основание ещё не проверено.' }, 'needs-verification'));
  const verified = [2, 3].includes(i);
  return { id, origin: 'scenario', demo: true, ...(i < 3 ? { scenario: ['A', 'B', 'C'][i] } : {}),
    name: names[i], city: 'Өскемен / Усть-Каменогорск', address: `Демо-участок ${String(i + 1).padStart(2, '0')} · адрес вымышленный`, lat, lng,
    developer: `ТОО «${developers[i]}» (вымышленное)`, bin: null,
    stage: ['Монтаж каркаса · DEMO', 'Возведение этажей · DEMO', 'Отделочные работы · DEMO', 'Благоустройство · DEMO'][i % 4],
    readinessClaimed: readiness[i], readinessConfirmed: null,
    readinessSources: [{ value: readiness[i], source: 'Вымышленный отчёт о готовности', date }],
    legalBasis: { type: i === 1 ? 'absent' : verified ? 'guarantee' : 'unknown',
      status: i === 1 ? 'absent-verified' : verified ? 'verified' : 'unknown',
      source: `Вымышленная сверка DEMO-${id}`, checkedAt: date,
      reviewText: `Учебный юридический сценарий. ${notice}` },
    note: notice, factors, events: [{ date, text: 'Создан новый вымышленный сценарий на реальной географической точке.' }],
    sources: [{ title: 'Демонстрационные сведения · полностью вымышлены', date }] };
});
// Additional fictional publications exercise the dossier timeline.
for (let i = 0; i < 5; i++) ADS.push({ id: `AD-${String(i + 9).padStart(3, '0')}`, zkId: COMPLEXES[i].id,
  platform: 'Демо-обновление', account: `demo_project_${i + 1}`, date,
  url: `https://example.invalid/projects/${COMPLEXES[i].id}/progress`, captureAt: date,
  text: `ВЫМЫШЛЕННЫЙ МАТЕРИАЛ. ЖК «${names[i]}»: обновлён учебный график строительства. ${notice}` });
const REGISTRIES = JSON.parse(readFileSync(new URL('./registry-links.json', import.meta.url), 'utf8'));
const seed = { COMPLEXES, ADS, REGISTRIES };
writeFileSync(new URL('../src/lib/seed.json', import.meta.url), JSON.stringify(seed, null, 2) + '\n');
const payload = JSON.stringify(buildSeedEnvelope(seed));
writeFileSync(migrationPath, `-- Generated by tools/replace-demo-sites.mjs. Seed refresh for newly initialized workspaces.
-- Existing workspaces, decisions and receipts remain unchanged.
begin;
update public.app_seed set data = $seed$${payload}$seed$::jsonb where id = true;
commit;
`);
console.log(`Replaced seed and migration: ${COMPLEXES.length} real locations, ${ADS.length} fictional publications.`);
