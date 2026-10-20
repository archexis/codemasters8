/**
 * Общие предикаты grounding (достаточности материала для confirmed R1–R6).
 *
 * Единственное место логики «что считается подкреплённым»: domain.validateFactor
 * (бросает Error с текстами C1) и state-migrations.groundingReason (возвращает
 * причину снятия с provenance) используют ЭТИ предикаты, а тексты ошибок
 * остаются локальными в каждом модуле. При смене правила менять предикат
 * здесь — оба потребителя подхватят одновременно, рассинхрон исключён.
 *
 * Предикаты чистые (без бросков): порядок проверок и тексты задаёт вызывающий.
 * Исключение — намеренные расхождения потребителей (domain строже: source/date
 * evidence, детали legalBasis, beforeCommissioning при runId) — они остаются
 * локальными проверками domain и здесь НЕ дублируются.
 */
import type { Ad, Complex, Evidence } from './types';

/** Материал относится к этому объекту. */
export function evidenceBelongsTo(evidence: Evidence, zkId: string): boolean {
  return evidence.zkId === zkId;
}

/** R1: проверенное отсутствие правового основания (type/absent-verified). */
export function hasVerifiedLegalAbsence(z: Complex): boolean {
  return z.legalBasis.type === 'absent' && z.legalBasis.status === 'absent-verified';
}

/** R1: описание сверки в legalBasis полно (только domain.validateFactor). */
export function hasLegalBasisDetails(z: Complex): boolean {
  return !!z.legalBasis.source.trim() && !!z.legalBasis.checkedAt.trim() && !!z.legalBasis.reviewText.trim();
}

/** R1: материал — legal-review. */
export function isLegalReview(evidence: Evidence): boolean {
  return evidence.kind === 'legal-review';
}

/** R1/R3/R4/R6: есть сохранённое содержание материала. */
export function hasMaterialText(evidence: Evidence): boolean {
  return !!evidence.text?.trim();
}

/** R2/R3: есть дословная цитата. */
export function hasQuote(evidence: Evidence): boolean {
  return !!evidence.quote?.trim();
}

/** R2/R3: материал — публикация. */
export function isPublication(evidence: Evidence): boolean {
  return evidence.kind === 'publication';
}

/**
 * R2/R3: цитата привязана к конкретной публикации.
 * Type-guard: после проверки evidence.adId сужается до string.
 */
export function hasAdRef(evidence: Evidence): evidence is Evidence & { adId: string } {
  return !!evidence.adId;
}

/** Публикация относится к тому же ЖК. */
export function adBelongsTo(ad: Ad, zkId: string): boolean {
  return ad.zkId === zkId;
}

/** Цитата дословно присутствует в тексте публикации. */
export function adContainsQuote(ad: Ad, quote: string): boolean {
  return ad.text.includes(quote);
}

/**
 * R3: явная календарная дата YYYY-MM-DD в тексте материала.
 * captureAt датой не считается (S2.1 C4).
 */
export function hasExplicitDate(text: string | undefined): boolean {
  return /\b\d{4}-\d{2}-\d{2}\b/.test(text ?? '');
}

/** R4/R6: материал — документ. */
export function isDocument(evidence: Evidence): boolean {
  return evidence.kind === 'document';
}

/**
 * R4: текст коллективного обращения о привлечении средств или файлы.
 * fileCount: у validateFactor — сырое evidence.mediaIds.length, у миграций —
 * отфильтрованное число известных storage файлов (различие намеренное).
 */
export function hasAppealMaterial(evidence: Evidence, fileCount: number): boolean {
  return !!evidence.text?.trim() || fileCount > 0;
}

/** R5: подтверждённый разрыв готовности ≥20 п.п. */
export function hasReadinessGap(z: Complex): boolean {
  return z.readinessClaimed != null && z.readinessConfirmed != null && Math.abs(z.readinessClaimed - z.readinessConfirmed) >= 20;
}

/** R5: два наблюдения claimed/confirmed с источником и датой каждого. */
export function hasReadinessPair(z: Complex): boolean {
  const claimed = z.readinessClaimedSource;
  const confirmedRec = z.readinessSources.find((r) => r.value === z.readinessConfirmed);
  return (
    !!claimed && !!claimed.source.trim() && !!claimed.date && !!confirmedRec && !!confirmedRec.source.trim() && !!confirmedRec.date
  );
}

/** R6: датированный факт — текст ≥10 символов с цифрами (срок/период простоя). */
export function isDatedIdleFact(text: string | undefined): boolean {
  const t = text?.trim() ?? '';
  return t.length >= 10 && /\d/.test(t);
}
