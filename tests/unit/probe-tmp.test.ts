import { it } from 'vitest';
import { parseAdText, normPhone } from '../../src/lib/parser';
it('probe', () => {
  const E09 = 'Продаётся светлая 2-комнатная квартира в ЖК «Самал»: 58,5 кв. м, готовность 70%, сдача в 2027 году, ключи весной. Депозит 500 000 тенге до договора обязателен. Звоните +7 701 123 45 67 или пишите в директ @samal_sales — покажем квартиру, школу и парк рядом.';
  const E10 = '🔥 Депозит 500 000 тенге до договора! Квартир осталось мало, успейте.';
  const E11 = 'Бронь квартиры — 300 000 тенге.\r\nЗвоните: 8(701)123-45-67.\r\nСдача в 2027 году.';
  const E12 = 'Депозит 500 000 тенге обязателен.';
  const E13 = 'Звоните +7 701 123 45 67 или 8(701)765-43-21. Бронь 200 000 тенге.';
  const E14 = 'Бастапқы жарна 1 500 000 теңге. Төлем қолма-қол емес, тек шарт бойынша.';
  const rows: Array<[string, string, boolean]> = [
    ['E09', E09, true], ['E10', E10, true], ['E11', E11, true],
    ['E12', E12, true], ['E13', E13, true], ['E14', E14, true],
    ['E08', 'Алдын ала төлем қажет емес.', false],
    ['NEM', 'Депозит 500 000 теңге немесе алдын ала жарна.', true],
  ];
  for (const [id, t, exp] of rows) {
    const r = parseAdText(t);
    const phones = r.entities.filter(e => e.type === 'phone').map(e => `${e.value}->${normPhone(e.value)}`);
    console.log(id, 'len=' + t.length, 'pay=' + r.payment.flagged, 'want=' + exp,
      'chan=' + r.channel.flagged, 'phones=[' + phones.join('|') + ']',
      'money=' + JSON.stringify(r.entities.filter(e => e.type === 'money').map(e => e.valueKzt)));
    let bad = 0;
    for (const e of r.entities) {
      const sub = t.slice(e.span[0], e.span[1]);
      const verbatim = e.type === 'readiness' ? sub.replace(/\s/g, '') === e.value : sub === e.value;
      if (!verbatim || !t.includes(e.quote)) { bad++; console.log('  SPAN-ISSUE', id, e.type, JSON.stringify(e.value), JSON.stringify(sub), JSON.stringify(e.quote)); }
    }
    if (r.payment.flagged !== exp) console.log('  FLAG-MISMATCH', id);
    if (!bad && r.payment.flagged === exp) console.log('  OK', id);
  }
});
