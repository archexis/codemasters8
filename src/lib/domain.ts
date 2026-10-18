import seed from './seed.json' with { type: 'json' };
import type { Ad, AppState, Code, Complex, Evidence, FactorStatus, Media, Signal } from './types';
import { codes } from './scoring';
import { dedupeKey } from './parser';
export type Command =
  | { type: 'factor'; zkId: string; code: Code; status: FactorStatus; evidence: Evidence; comment: string }
  | { type: 'ad'; ad: Ad; hypothesis?: { code: Code; quote: string }; decision: 'confirmed' | 'rejected' | 'saved'; comment: string }
  | { type: 'media'; media: Media }
  | { type: 'readiness'; zkId: string; value: number; source: string; date: string }
  | { type: 'signal'; zkId: string; status: Signal['status']; comment: string }
  | { type: 'complex'; complex: Complex };
export function initialState(): AppState {
  return { complexes: structuredClone(seed.COMPLEXES) as Complex[], ads: structuredClone(seed.ADS), media: [], signals: {}, audit: [] };
}
export function validateFactor(z: Complex, code: Code, status: FactorStatus, evidence: Evidence) {
  if (!codes.includes(code)) throw new Error('Неизвестный фактор');
  if (status !== 'confirmed') return;
  if (!evidence.source.trim()) throw new Error('Укажите источник доказательства');
  if (code === 'R1' && z.legalBasis.status !== 'absent-verified') throw new Error('R1 требует проверенного отсутствия законного основания');
  if (code === 'R2' && !evidence.quote?.trim()) throw new Error('Для R2 нужна дословная цитата');
  if (code === 'R5' && (z.readinessClaimed == null || z.readinessConfirmed == null || Math.abs(z.readinessClaimed - z.readinessConfirmed) < 20)) throw new Error('Для R5 нужен подтверждённый разрыв ≥20 п.п.');
}
export function applyCommand(state: AppState, command: Command, reviewer: string): AppState {
  const next = structuredClone(state);
  const at = new Date().toISOString();
  let zkId = 'zkId' in command ? command.zkId : command.type === 'ad' ? command.ad.zkId : command.type === 'media' ? command.media.zkId : command.complex.id;
  const z = next.complexes.find(z => z.id === zkId);
  if (!z && command.type !== 'complex') throw new Error('Объект не найден');
  const setFactor = (code: Code, status: FactorStatus, evidence: Evidence) => {
    validateFactor(z!, code, status, evidence);
    const factor = { code, status, evidence, reviewer, updatedAt: at };
    z!.factors = [...z!.factors.filter(f => f.code !== code), factor];
  };
  switch (command.type) {
    case 'complex': {
      if (!command.complex.name.trim() || !command.complex.address.trim()) throw new Error('Укажите название и адрес');
      if (command.complex.bin && !/^\d{12}$/.test(command.complex.bin)) throw new Error('БИН должен содержать 12 цифр');
      if (command.complex.legalBasis.status !== 'unknown' && !command.complex.legalBasis.source.trim()) throw new Error('Укажите источник проверки основания');
      if (command.complex.readinessClaimed != null && (command.complex.readinessClaimed < 0 || command.complex.readinessClaimed > 100)) throw new Error('Готовность должна быть от 0 до 100');
      if (command.complex.lat != null && (!Number.isFinite(command.complex.lat) || Math.abs(command.complex.lat) > 90)) throw new Error('Некорректная широта');
      if (command.complex.lng != null && (!Number.isFinite(command.complex.lng) || Math.abs(command.complex.lng) > 180)) throw new Error('Некорректная долгота');
      if (z) {
        const oldClaim = z.readinessClaimed;
        const updated = { ...command.complex, factors: z.factors, events: z.events, sources: z.sources, readinessSources: z.readinessSources, readinessConfirmed: z.readinessConfirmed };
        Object.assign(z, updated);
        if (z.legalBasis.status !== 'absent-verified') z.factors = z.factors.map(f => f.code === 'R1' && f.status === 'confirmed' ? { ...f, status: 'needs-verification', updatedAt: at, reviewer } : f);
        if (oldClaim !== z.readinessClaimed) z.factors = z.factors.map(f => f.code === 'R5' ? { ...f, status: 'needs-verification', updatedAt: at, reviewer } : f);
      } else next.complexes.push({ ...command.complex, factors: [], events: [], sources: [], readinessSources: [], readinessConfirmed: null });
      break;
    }
    case 'factor': setFactor(command.code, command.status, command.evidence); break;
    case 'ad': {
      if (!command.ad.text.trim()) throw new Error('Введите текст');
      if (next.ads.some(ad => dedupeKey(ad) === dedupeKey(command.ad))) throw new Error('Такая публикация уже сохранена');
      if (command.ad.url && !safeUrl(command.ad.url)) throw new Error('Ссылка должна начинаться с https:// или http://');
      next.ads.unshift({ ...command.ad, decision: command.decision });
      if (command.hypothesis && command.decision === 'confirmed') {
        if (!command.hypothesis.quote.trim() || !command.ad.text.includes(command.hypothesis.quote)) throw new Error('Цитата отсутствует в исходном тексте');
        setFactor(command.hypothesis.code, 'confirmed', { source: command.ad.platform || 'Ручной ввод', quote: command.hypothesis.quote, adId: command.ad.id, date: command.ad.captureAt });
      }
      break;
    }
    case 'media': next.media.push(command.media); break;
    case 'readiness': {
      if (!Number.isFinite(command.value) || command.value < 0 || command.value > 100 || !command.source.trim() || !command.date) throw new Error('Нужны готовность 0–100, источник и дата');
      z!.readinessConfirmed = command.value;
      z!.readinessSources.push({ value: command.value, source: command.source, date: command.date });
      const gap = z!.readinessClaimed == null ? 0 : Math.abs(z!.readinessClaimed - command.value);
      setFactor('R5', gap >= 20 ? 'hypothesis' : 'needs-verification', { source: command.source, date: command.date });
      break;
    }
    case 'signal': {
      if (!command.comment.trim()) throw new Error('Укажите обоснование решения');
      if (command.status === 'confirmed' && !z!.factors.some(f => f.status === 'confirmed')) throw new Error('Нет подтверждённых факторов');
      next.signals[zkId] = { status: command.status, snapshot: structuredClone(z!), at, reviewer, comment: command.comment };
      break;
    }
  }
  if (command.type !== 'signal' && next.signals[zkId]) next.signals[zkId].status = 'draft';
  next.audit.unshift({ id: crypto.randomUUID(), zkId, at, reviewer, action: command.type, comment: 'comment' in command ? command.comment : command.type === 'readiness' ? command.source : '', details: structuredClone(command) });
  return next;
}
export function safeUrl(value?: string): string | undefined {
  try { const u = new URL(value || ''); return ['https:', 'http:'].includes(u.protocol) ? u.href : undefined; } catch { return undefined; }
}
