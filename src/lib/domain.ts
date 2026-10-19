import seed from './seed.json' with { type: 'json' };
import type { Ad, AppState, Code, Complex, Evidence, FactorStatus, Media, Signal, SignalVersion } from './types';
import { codes } from './scoring';
import { adDedupeKey } from './parser';
import { isDateLike, parseCommand, seedState } from './validation';
import { buildSignalSnapshot, nextRevisionFor } from './signal-snapshot';
import type { SignalDecisionOpts } from './signal-snapshot';

export type { Command } from './types';
import type { ParsedCommand } from './types';

export function initialState(): AppState {
  const { complexes, ads } = seedState(seed);
  // Канон v3 (стык S1->S2): DEMO-состояние совпадает с SQL initialize_workspace()
  // после миграции S2.1 — schemaVersion/signalVersions здесь, а не только в SQL.
  return { schemaVersion: 3, complexes, ads, media: [], signals: {}, signalVersions: {}, audit: [] };
}

/**
 * S1.2 (C1). Проверка решения с доступом ко всему workspace и целевому
 * объекту: иначе adId/quote нельзя сверить с публикацией того же ЖК.
 * Правила C1 (confirmed; гипотезы/отказы на проверку — ранний возврат):
 *  R1 — legalBasis type=absent/status=absent-verified + source/checkedAt/
 *    reviewText + evidence legal-review того же ЖК с текстом сверки;
 *  R2 — evidence publication; ad того же ЖК; непустая точная quote из ad.text;
 *  R3 — как R2 + evidence.text (датированный материал, что объект не введён:
 *    source/date/text beforeCommissioning лежат в source/date/text);
 *  R4 — evidence document с текстом коллективного обращения о привлечении
 *    средств (collectiveAppeal) или файлом;
 *  R5 — два наблюдения claimed+confirmed со source/date каждого, |gap|>=20,
 *    подтверждается отдельным решением (readiness-команда даёт лишь гипотезу);
 *  R6 — evidence document: датированный факт (цифры срока/периода в text),
 *    минимум plannedDate или idleSince + объяснение значимости.
 * Порядок проверок сохраняет коды ошибок S1.1: цитата — до adId,
 * comment аналитика — последним (проверяет setFactor).
 */
export function validateFactor(workspace: AppState, z: Complex, code: Code, status: FactorStatus, evidence: Evidence) {
  if (!codes.includes(code)) throw new Error('Неизвестный фактор');
  if (status !== 'confirmed') return;
  if (!evidence.source.trim()) throw new Error('Укажите источник доказательства');
  if (evidence.date && !isDateLike(evidence.date)) throw new Error('evidence.date: неверная календарная дата (нужна реальная YYYY-MM-DD)');
  if (evidence.zkId !== z.id) throw new Error('Доказательство относится к другому объекту');
  switch (code) {
    case 'R1': {
      if (z.legalBasis.type !== 'absent' || z.legalBasis.status !== 'absent-verified') throw new Error('R1 требует проверенного отсутствия законного основания');
      if (!z.legalBasis.source.trim() || !z.legalBasis.checkedAt.trim() || !z.legalBasis.reviewText.trim()) throw new Error('R1 требует source, checkedAt и описание сверки в legalBasis');
      if (evidence.kind !== 'legal-review') throw new Error('R1 требует материал legal-review того же ЖК');
      if (!evidence.text?.trim()) throw new Error('R1 требует сохранённое содержание сверки (evidence.text)');
      break;
    }
    case 'R2':
    case 'R3': {
      if (!evidence.quote?.trim()) throw new Error(`Для ${code} нужна дословная цитата`);
      if (evidence.kind !== 'publication') throw new Error(`Для ${code} нужен материал публикации`);
      if (!evidence.adId) throw new Error(`Для ${code} выберите конкретную публикацию: свободная цитата без adId не сохраняется`);
      const ad = workspace.ads.find(a => a.id === evidence.adId);
      if (!ad) throw new Error('Публикация не найдена');
      if (ad.zkId !== z.id) throw new Error('Публикация относится к другому ЖК');
      if (!ad.text.includes(evidence.quote)) throw new Error('Цитата отсутствует в исходном тексте');
      if(code==='R3' && evidence.runId && (!evidence.beforeCommissioning?.source.trim() || !evidence.beforeCommissioning?.text.trim() || !evidence.beforeCommissioning?.date)) throw new Error('Для R3 нужен beforeCommissioning: источник, дата и содержание материала о вводе');
      if (code === 'R3' && !evidence.text?.trim()) throw new Error('Для R3 нужен датированный материал, что объект не введён (source/date/text)');
      // S2.1 (C4): дата публикации неизвестна — confirmation блокируется,
      // пока материал не несёт явной календарной даты до ввода объекта.
      if (code === 'R3' && ad.date == null && !/\b\d{4}-\d{2}-\d{2}\b/.test(evidence.text ?? '')) {
        throw new Error('Для R3 с неизвестной датой публикации нужен датированный материал: явная дата до ввода объекта в тексте (captureAt датой не считается)');
      }
      break;
    }
    case 'R4': {
      if (evidence.kind !== 'document') throw new Error('Для R4 нужен документ обращения');
      if (!evidence.text?.trim() && !(evidence.mediaIds?.length)) throw new Error('Для R4 нужен сохранённый текст коллективного обращения о привлечении средств или файл');
      break;
    }
    case 'R5': {
      // S1.1-порядок сохранён: сначала разрыв (legacy без наблюдений тоже
      // отклоняется здесь), затем происхождение каждого наблюдения (S1.2).
      if (z.readinessClaimed == null || z.readinessConfirmed == null || Math.abs(z.readinessClaimed - z.readinessConfirmed) < 20) {
        throw new Error('Для R5 нужен подтверждённый разрыв ≥20 п.п.');
      }
      const claimedSrc = z.readinessClaimedSource;
      const confirmedRec = z.readinessSources.find(r => r.value === z.readinessConfirmed);
      if (!claimedSrc || !claimedSrc.source.trim() || !claimedSrc.date || !confirmedRec || !confirmedRec.source.trim() || !confirmedRec.date) {
        throw new Error('Для R5 нужны два наблюдения (claimed/confirmed) с источником и датой каждого');
      }
      break;
    }
    case 'R6': {
      if (evidence.kind !== 'document') throw new Error('Для R6 нужен документ/текст наблюдения');
      const text = evidence.text?.trim() ?? '';
      if (text.length < 10 || !/\d/.test(text)) throw new Error('Для R6 нужен датированный факт: заявленный срок или период простоя и объяснение значимости');
      break;
    }
  }
}

function requireAnalystComment(status: FactorStatus, comment: string) {
  if ((status === 'confirmed' || status === 'rejected' || status === 'needs-verification') && !comment.trim()) {
    throw new Error('Добавьте осмысленный комментарий аналитика к решению');
  }
}

/**
 * Применяет команду. Сырая команда сначала проходит runtime-парсинг
 * (validation.parseCommand); невалидная команда отбрасывается до любых
 * изменений — state/version/audit остаются нетронутыми. Автор решения —
 * серверный reviewer; присланный reviewer отвергается парсером.
 *
 * S2.4 (C6). `opts.commandId` — ID намерения для signal-решений: повтор с тем
 * же commandId не создаёт новую revision и не дописывает audit (полный конверт
 * receipt/expected_version — S2.2). `opts.sourceVersion` — версия workspace,
 * из которой взят snapshot (иначе Complex.version ?? 0).
 */
export function applyCommand(state: AppState, command: unknown, reviewer: string, opts?: SignalDecisionOpts): AppState {
  const cmd: ParsedCommand = parseCommand(command);
  const next = structuredClone(state);
  const at = new Date().toISOString();
  const zkId = cmd.type === 'factor' || cmd.type === 'readiness' || cmd.type === 'signal' ? cmd.zkId
    : cmd.type === 'ad' ? cmd.ad.zkId : cmd.type === 'media' ? cmd.media.zkId : cmd.complex.id;
  const z = next.complexes.find(z => z.id === zkId);
  if (!z && cmd.type !== 'complex') throw new Error('Объект не найден');
  // S1.3. Авто-отзыв устаревших решений: текст причин копим сюда и дописываем
  // в audit-комментарий (изменение — в details/cmd, затронутые факторы — в
  // комментарии). Баллы начисляются только после нового confirm: score
  // считает лишь confirmed, отозванные needs-verification/hypothesis дают 0.
  const invalidated: string[] = [];
  const setFactor = (workspace: AppState, target: Complex, code: Code, status: FactorStatus, evidence: Evidence, manualComment?: string) => {
    validateFactor(workspace, target, code, status, evidence);
    if (manualComment !== undefined) requireAnalystComment(status, manualComment);
    const factor = { code, status, evidence, reviewer, updatedAt: at };
    target.factors = [...target.factors.filter(f => f.code !== code), factor];
  };
  switch (cmd.type) {
    case 'complex': {
      if (!cmd.complex.name.trim() || !cmd.complex.address.trim()) throw new Error('Укажите название и адрес');
      if (cmd.complex.bin && !/^\d{12}$/.test(cmd.complex.bin)) throw new Error('БИН должен содержать 12 цифр');
      if (cmd.complex.legalBasis.status !== 'unknown' && !cmd.complex.legalBasis.source.trim()) throw new Error('Укажите источник проверки основания');
      if (cmd.complex.legalBasis.status !== 'unknown' && !cmd.complex.legalBasis.reviewText.trim()) throw new Error('complex.legalBasis.reviewText: сохраните описание области сверки и её результата');
      if (cmd.complex.readinessClaimed != null && (cmd.complex.readinessClaimed < 0 || cmd.complex.readinessClaimed > 100)) throw new Error('Готовность должна быть от 0 до 100');
      if (cmd.complex.lat != null && (!Number.isFinite(cmd.complex.lat) || Math.abs(cmd.complex.lat) > 90)) throw new Error('Некорректная широта');
      if (cmd.complex.lng != null && (!Number.isFinite(cmd.complex.lng) || Math.abs(cmd.complex.lng) > 180)) throw new Error('Некорректная долгота');
      if (z) {
        // C1. Смена любого из материалов legalBasis отзывает старый confirmed R1;
        // смена заявленной готовности или её источника/даты — старое решение R5.
        // S1.3. Замена source/checkedAt/reviewText при прежнем status тоже
        // отзывает; смена type/status — тем более; новый legal verified
        // (guarantee/mio-permit) не оставляет confirmed R1.
        const prevLegal = z.legalBasis;
        const oldClaim = z.readinessClaimed;
        const oldClaimedSource = z.readinessClaimedSource;
        const hadConfirmedR1 = z.factors.some(f => f.code === 'R1' && f.status === 'confirmed');
        const hadConfirmedR5 = z.factors.some(f => f.code === 'R5' && f.status === 'confirmed');
        const updated = { ...cmd.complex, factors: z.factors, events: z.events, sources: z.sources, readinessSources: z.readinessSources, readinessConfirmed: z.readinessConfirmed };
        Object.assign(z, updated);
        const legalKeys = (['type', 'status', 'source', 'checkedAt', 'reviewText'] as const)
          .filter(k => prevLegal[k] !== z.legalBasis[k]);
        if (legalKeys.length > 0) {
          z.factors = z.factors.map(f => f.code === 'R1' && f.status === 'confirmed' ? { ...f, status: 'needs-verification', updatedAt: at, reviewer } : f);
          if (hadConfirmedR1) invalidated.push(`R1 confirmed→needs-verification (legalBasis изменился: ${legalKeys.join(', ')}; новый ${z.legalBasis.type}/${z.legalBasis.status})`);
        }
        if (oldClaim !== z.readinessClaimed || JSON.stringify(oldClaimedSource) !== JSON.stringify(z.readinessClaimedSource)) {
          z.factors = z.factors.map(f => f.code === 'R5' ? { ...f, status: 'needs-verification', updatedAt: at, reviewer } : f);
          if (hadConfirmedR5) invalidated.push(`R5 confirmed→needs-verification (заявленная готовность/источник изменились: было ${oldClaim ?? '—'}, стало ${z.readinessClaimed ?? '—'})`);
        }
      } else next.complexes.push({ ...cmd.complex, factors: [], events: [], sources: [], readinessSources: [], readinessConfirmed: null });
      break;
    }
    case 'factor': setFactor(next, z!, cmd.code, cmd.status, cmd.evidence, cmd.comment); break;
    case 'ad': {
      // S1.2. Ad и confirm гипотезы — одна транзакция на копии next:
      // публикация добавляется в копию, проверка цитаты идёт уже по ней,
      // любая ошибка отбрасывает next целиком (нет ad/factor/audit/version).
      if (!cmd.ad.text.trim()) throw new Error('Введите текст');
      // S3.2 (C4). Повтор ID — отказ независимо от текста: ID публикации
      // стабилен на всё время жизни намерения, retry идёт тем же ID.
      if (next.ads.some(a => a.id === cmd.ad.id)) throw new Error(`Публикация ${cmd.ad.id} уже существует (повтор ID запрещён независимо от текста)`);
      // S3.2 (C4). Единый ключ zkId+canonicalText (телефоны 8→+7,
      // пробелы/регистр — паритет parser/validation/SQL): тот же текст в
      // другом ЖК допустим и повтором не считается. В том же ЖК второго ad
      // нет: новая фиксация копится в sightings существующего (undated и
      // датированная сосуществуют — дата/источник второй не теряются).
      // Точный повтор уже записанной фиксации — отказ с ID существующей
      // публикации, чтобы UI открыл её (S2.1-контракт сохранён).
      const incomingKey = adDedupeKey(cmd.ad.zkId, cmd.ad.text);
      const dupe = next.ads.find(ad => adDedupeKey(ad.zkId, ad.text) === incomingKey);
      if (dupe) {
        if (cmd.ad.url && !safeUrl(cmd.ad.url)) throw new Error('Ссылка должна начинаться с https:// или http://');
        const recorded = [{ source: dupe.platform, date: dupe.date, url: dupe.url }, ...(dupe.sightings ?? [])];
        const fresh = !recorded.some(r =>
          (r.source ?? '') === (cmd.ad.platform ?? '') &&
          (r.date ?? null) === (cmd.ad.date ?? null) &&
          (r.url ?? '') === (cmd.ad.url ?? ''));
        if (!fresh) throw new Error(`Такая публикация уже сохранена (${dupe.id}); откройте её и добавьте источник в sightings`);
        dupe.sightings = [...(dupe.sightings ?? []), {
          source: cmd.ad.platform, date: cmd.ad.date,
          ...(cmd.ad.url ? { url: cmd.ad.url } : {}),
          captureAt: cmd.ad.captureAt,
        }];
        if (cmd.hypothesis && cmd.decision !== 'saved') {
          if (!cmd.hypothesis.quote.trim() || !dupe.text.includes(cmd.hypothesis.quote)) throw new Error('Цитата отсутствует в исходном тексте');
          setFactor(next, z!, cmd.hypothesis.code, cmd.decision === 'confirmed' ? 'confirmed' : 'rejected', { id: crypto.randomUUID(), zkId, kind: 'publication', source: cmd.ad.platform || 'Ручной ввод', quote: cmd.hypothesis.quote, adId: dupe.id, date: cmd.ad.captureAt, ...(cmd.hypothesis.beforeCommissioning ? {beforeCommissioning:cmd.hypothesis.beforeCommissioning} : {}), ...(cmd.hypothesis.runId ? {runId:cmd.hypothesis.runId,hypothesisId:cmd.hypothesis.hypothesisId} : {}), ...(cmd.hypothesis.evidenceText !== undefined ? { text: cmd.hypothesis.evidenceText } : {}) });
        }
        break;
      }
      if (cmd.ad.url && !safeUrl(cmd.ad.url)) throw new Error('Ссылка должна начинаться с https:// или http://');
      next.ads.unshift({ ...cmd.ad, decision: cmd.decision });
      if (cmd.hypothesis && cmd.decision !== 'saved') {
        if (!cmd.hypothesis.quote.trim() || !cmd.ad.text.includes(cmd.hypothesis.quote)) throw new Error('Цитата отсутствует в исходном тексте');
        // Comment аналитика лежит в cmd.comment ad-команды и пишется в audit;
        // обязательность comment действует на factor-решения (setFactor ниже).
        setFactor(next, z!, cmd.hypothesis.code, cmd.decision === 'confirmed' ? 'confirmed' : 'rejected', { id: crypto.randomUUID(), zkId, kind: 'publication', source: cmd.ad.platform || 'Ручной ввод', quote: cmd.hypothesis.quote, adId: cmd.ad.id, date: cmd.ad.captureAt, ...(cmd.hypothesis.beforeCommissioning ? {beforeCommissioning:cmd.hypothesis.beforeCommissioning} : {}), ...(cmd.hypothesis.runId ? {runId:cmd.hypothesis.runId,hypothesisId:cmd.hypothesis.hypothesisId} : {}), ...(cmd.hypothesis.evidenceText !== undefined ? { text: cmd.hypothesis.evidenceText } : {}) });
      }
      break;
    }
    case 'media': next.media.push(cmd.media); break;
    case 'readiness': {
      if (!Number.isFinite(cmd.value) || cmd.value < 0 || cmd.value > 100 || !cmd.source.trim() || !cmd.date) throw new Error('Нужны готовность 0–100, источник и дата');
      const prevR5 = z!.factors.find(f => f.code === 'R5')?.status;
      z!.readinessConfirmed = cmd.value;
      z!.readinessSources.push({ value: cmd.value, source: cmd.source, date: cmd.date });
      const gap = z!.readinessClaimed == null ? 0 : Math.abs(z!.readinessClaimed - cmd.value);
      // S1.2. Отдельное решение обязательно: readiness даёт только
      // hypothesis/needs-verification, confirm R5 — factor-командой.
      // S1.3. Новое наблюдение при confirmed R5: gap<20 → needs-verification
      // (−10), gap>=20 → hypothesis (0 баллов до нового решения).
      const nextR5 = gap >= 20 ? 'hypothesis' : 'needs-verification';
      setFactor(next, z!, 'R5', nextR5, { id: crypto.randomUUID(), zkId, kind: 'observation', source: cmd.source, date: cmd.date });
      if (prevR5 === 'confirmed') invalidated.push(`R5 confirmed→${nextR5} (новое наблюдение: заявлено ${z!.readinessClaimed ?? '—'}, подтверждено ${cmd.value}, разрыв ${gap} п.п.)`);
      break;
    }
    case 'signal': {
      if (!cmd.comment.trim()) throw new Error('Укажите обоснование решения');
      const prior = next.signalVersions?.[zkId] ?? [];
      if (opts?.commandId && prior.some(v => v.commandId === opts.commandId || v.id === opts.commandId)) return next;
      if (cmd.status !== 'draft' && next.signals[zkId]?.status && next.signals[zkId].status !== 'draft') throw new Error('Откройте пересмотр с причиной перед новым решением');
      if (cmd.status === 'confirmed' && !z!.factors.some(f => f.status === 'confirmed')) throw new Error('Нет подтверждённых факторов');
      if (cmd.status === 'confirmed') for (const f of z!.factors.filter(f=>f.status==='confirmed')) validateFactor(next,z!,f.code,'confirmed',f.evidence!);
      // S2.4 (C6). Append-only версии: подтверждение/возврат добавляют запись
      // с revision = max+1 и basedOnRevision = предыдущий max (null у первой).
      // Draft-команда версий не добавляет — только двигает указатель.
      // Повтор с тем же commandId — no-op: ни новой revision, ни нового audit.
      if (cmd.status === 'confirmed' || cmd.status === 'returned') {
        const prevVersions = next.signalVersions?.[zkId] ?? [];
        const cmdId = opts?.commandId;
        if (cmdId && prevVersions.some((v) => v.id === cmdId || v.commandId === cmdId)) return next;
        const built = buildSignalSnapshot(next, zkId);
        const version: SignalVersion = {
          id: cmdId ?? crypto.randomUUID(),
          ...(cmdId ? { commandId: cmdId } : {}),
          zkId, revision: nextRevisionFor(next, zkId), status: cmd.status, at, reviewer, comment: cmd.comment,
          sourceVersion: opts?.sourceVersion ?? z!.version ?? 0,
          snapshot: built.snapshot, ads: built.ads, decisionAudit: built.decisionAudit,
          score: built.score, zone: built.zone, weightsVersion: built.weightsVersion,
          mediaManifest: built.mediaManifest, aiProvenance: built.aiProvenance,
          basedOnRevision: prevVersions.length > 0
            ? prevVersions.reduce((m, v) => Math.max(m, v.revision), 0)
            : null,
        };
        next.signalVersions ??= {};
        next.signalVersions[zkId] = [...prevVersions, version];
      }
      next.signals[zkId] = { status: cmd.status, snapshot: structuredClone(z!), at, reviewer, comment: cmd.comment, basedOnRevision: prior.reduce((max,v)=>Math.max(max,v.revision),0) || null, ...(cmd.status === 'draft' ? {reason: cmd.comment} : {}) };
      break;
    }
  }
  if (cmd.type !== 'signal' && next.signals[zkId]) next.signals[zkId] = {...next.signals[zkId], status:'draft', at, reviewer, comment:'Новые факты: ' + cmd.type, reason:'Новые факты: ' + cmd.type, basedOnRevision: nextRevisionFor(next, zkId) - 1 || null};
  // S1.3. Audit хранит изменение (details=команда) и автоматически затронутые
  // факторы (комментарий). Повторное подтверждение явно требуется: баллы
  // начисляются только после нового confirm.
  const baseComment = 'comment' in cmd ? cmd.comment : cmd.type === 'readiness' ? cmd.source : '';
  const autoNote = invalidated.length > 0
    ? `Авто-отзыв: ${invalidated.join('; ')}. Повторное подтверждение требуется (баллы только после нового confirm).`
    : '';
  next.audit.unshift({ id: crypto.randomUUID(), zkId, at, reviewer, action: cmd.type, comment: [baseComment, autoNote].filter(Boolean).join(' · '), details: structuredClone(cmd) });
  return next;
}
export function safeUrl(value?: string): string | undefined {
  try { const u = new URL(value || ''); return ['https:', 'http:'].includes(u.protocol) ? u.href : undefined; } catch { return undefined; }
}
