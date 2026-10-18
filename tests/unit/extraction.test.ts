import { describe, expect, it } from 'vitest';
import { parseAdText, normPhone } from '../../src/lib/parser';
import corpus from '../fixtures/contracts/extraction.json' with { type: 'json' };

// S3.1 — корпус извлечения RU/KZ. Ожидания зафиксированы контрактом,
// а не вычисляются кодом. Спаны — UTF-16 индексы JS.
type Case = {
  id: string; text: string; payment: boolean; note?: string;
  channel?: boolean; minLength?: number; phones?: number; moneyKzt?: number; nbsp?: boolean;
};
const NBSP = String.fromCharCode(160);
const CRLF = String.fromCharCode(13, 10);
const cases = (corpus as { cases: Case[] }).cases;

// NBSP-кейс гоняем детерминированно: все пробелы -> U+00A0.
// Если фикстура уже содержит NBSP, проверяем и сырой вариант тоже.
function variants(c: Case): string[] {
  if (!c.nbsp) return [c.text];
  const all = c.text.split(' ').join(NBSP);
  return c.text.includes(NBSP) ? [c.text, all] : [all];
}

function checkSpans(caseId: string, text: string, r: ReturnType<typeof parseAdText>) {
  for (const e of r.entities) {
    const [start, end] = e.span;
    expect(Number.isInteger(start) && Number.isInteger(end), `${caseId} ${e.type}: span integers`).toBe(true);
    expect(start >= 0 && start < end && end <= text.length, `${caseId} ${e.type}: span in bounds`).toBe(true);
    const sub = text.slice(start, end);
    expect(sub.length > 0, `${caseId} ${e.type}: slice non-empty`).toBe(true);
    if (e.type === 'readiness') expect(sub.replace(/\s+/g, ''), `${caseId} readiness verbatim`).toBe(e.value);
    else expect(sub, `${caseId} ${e.type} verbatim`).toBe(e.value);
    expect(typeof e.quote === 'string' && e.quote.length > 0, `${caseId} ${e.type}: quote present`).toBe(true);
    expect(text.includes(e.quote), `${caseId} ${e.type}: quote is exact substring`).toBe(true);
  }
  for (const q of [...r.payment.quotes, ...r.channel.quotes]) {
    expect(text.includes(q), `${caseId}: payment/channel quote is exact substring`).toBe(true);
    if (!text.includes('…')) expect(q.includes('…'), `${caseId}: no added ellipsis`).toBe(false);
    if (!text.includes('...')) expect(q.includes('...'), `${caseId}: no added dots`).toBe(false);
  }
}

describe('S3.1 extraction corpus', () => {
  it.each(cases)('$id payment flag', (c) => {
    for (const text of variants(c)) {
      const r = parseAdText(text);
      expect(r.payment.flagged, `${c.id}: flagged`).toBe(c.payment);
      if (c.payment) {
        expect(r.payment.quotes.length > 0, `${c.id}: quote kept`).toBe(true);
        expect(r.payment.cues.length > 0, `${c.id}: cues listed`).toBe(true);
      } else {
        expect(r.payment.quotes, `${c.id}: no quotes when clean`).toEqual([]);
      }
      if (c.channel !== undefined) expect(r.channel.flagged, `${c.id}: channel`).toBe(c.channel);
      checkSpans(c.id, text, r);
    }
  });

  it('table rows keep exact source text', () => {
    const byId = Object.fromEntries(cases.map((c) => [c.id, c]));
    expect(byId['E01-RU-DEPOSIT'].text).toBe('Депозит 500 000 тенге обязателен.');
    expect(byId['E08-KZ-EMES'].text).toBe('Алдын ала төлем қажет емес.');
  });

  it('E09 long ad >280 with all entity kinds', () => {
    const c = cases.find((x) => x.id === 'E09-RU-LONG')!;
    expect(c.text.length).toBeGreaterThan(280);
    if (c.minLength) expect(c.text.length).toBeGreaterThanOrEqual(c.minLength);
    const r = parseAdText(c.text);
    expect(r.payment.flagged).toBe(true);
    for (const t of ['money', 'phone', 'date', 'area', 'contact']) {
      expect(r.entities.some((e) => e.type === t), `E09 has ${t}`).toBe(true);
    }
    checkSpans(c.id, c.text, r);
  });

  it('E10 emoji before quote keeps UTF-16 spans', () => {
    const c = cases.find((x) => x.id === 'E10-RU-EMOJI')!;
    expect(c.text.slice(0, 2)).toBe('🔥'); // суррогатная пара = 2 единицы UTF-16
    const r = parseAdText(c.text);
    expect(r.payment.flagged).toBe(true);
    const money = r.entities.find((e) => e.type === 'money')!;
    expect(money.span[0]).toBe(11); // после '🔥 Депозит ' (эмодзи = 2 единицы UTF-16)
    expect(r.payment.quotes[0].startsWith('🔥')).toBe(true);
    checkSpans(c.id, c.text, r);
  });

  it('E11 CRLF splits into sentences', () => {
    const c = cases.find((x) => x.id === 'E11-RU-CRLF')!;
    expect(c.text.includes(CRLF)).toBe(true);
    const r = parseAdText(c.text);
    expect(r.sentences).toBe(3);
    expect(r.payment.flagged).toBe(true);
    checkSpans(c.id, c.text, r);
  });

  it('E12 NBSP amount normalizes to 500000 KZT', () => {
    const c = cases.find((x) => x.id === 'E12-RU-NBSP')!;
    for (const text of variants(c)) {
      expect(text.includes(NBSP)).toBe(true);
      const r = parseAdText(text);
      expect(r.payment.flagged).toBe(true);
      expect(r.entities.some((e) => e.type === 'money' && e.valueKzt === c.moneyKzt)).toBe(true);
      checkSpans(c.id, text, r);
    }
  });

  it('E13 two phone formats stay distinct', () => {
    const c = cases.find((x) => x.id === 'E13-RU-PHONES')!;
    const r = parseAdText(c.text);
    const phones = r.entities.filter((e) => e.type === 'phone');
    expect(phones.length).toBe(c.phones);
    expect(new Set(phones.map((e) => normPhone(e.value))).size).toBe(2);
    checkSpans(c.id, c.text, r);
  });

  it('E06 channel cue is not a payment signal', () => {
    const c = cases.find((x) => x.id === 'E06-RU-CHANNEL')!;
    const r = parseAdText(c.text);
    expect(r.payment.flagged).toBe(false);
    expect(r.channel.flagged).toBe(true);
    expect(r.entities.some((e) => e.type === 'channel')).toBe(true);
    checkSpans(c.id, c.text, r);
  });
});
