// SAQ QURYLYS — локальный парсер объявлений v2 (без сети, без ИИ).
// Детерминированно извлекает сущности с дословными цитатами И символьными
// спанами [start, end] в исходном тексте:
// телефоны, деньги (с нормализацией в тенге), площадь, готовность в %,
// даты/сроки, юридические маркеры, контакты, инвест-приманки,
// платёжные сигналы с учётом отрицаний (RU + KZ).
// Важно: \w НЕ покрывает кириллицу — везде явный класс CYR.

import Papa from 'papaparse';
import type { Ad } from './types';
export interface Entity { type: string; label: string; value: string; quote: string; span: number[]; confidence: string; valueKzt?: number }
interface SourceInfo { url?: string; platform?: string; text?: string }


  const CYR = "а-яёәіңғүұқөһ";
  const C = (s?: string) => "[" + CYR + "]" + (s || "*");

  const PAY = [
    /брон[ьи]/i, /депозит/i,
    new RegExp("первоначальн" + C() + "\\s+взнос", "i"),
    new RegExp("перв" + C() + "\\s+взнос", "i"),
    /первоначалк/i,
    new RegExp("договор(" + "\\s+" + C("+") + "){0,3}\\s+бронирования", "i"),
    /задато[кч]/i, /предоплат/i, /аванс/i, /взнос/i, /залог/i,
    /перевод[^.!?…\n]{0,30}(?:каспи|kaspi|на\s+карту)/i,
    /(?:скидывай|кидай|отправляй)[^.!?…\n]{0,25}(?:каспи|kaspi|карту|деньги)/i,
    /номер\s+карт[уы]/i,
    new RegExp("рассрочк" + C() + "\\s+от\\s+застройщика", "i"),
    new RegExp("оплат" + C() + "\\s+(?:напрямую|до\\s+заключения|до\\s+договора|наличными|на\\s+карту|переводом)", "i"),
    new RegExp("перевод[" + CYR + "]{0,20}(?:на\\s+карту|наличными|застройщику)", "i"),
    new RegExp("резерв" + C() + ".{0,30}плат", "i"),
    new RegExp("фиксиру" + C() + ".{0,30}цен", "i"),
    /кепіл(?!дік)/i, /төле/i, /бронда/i, /жарна/i, /қолма-қол/i,
    /алғашқы\s+жарна/i, /бастапқы\s+жарна/i,
    /алдын ала.{0,25}(?:төле|төлем|жарна|ақы)/i,
  ];
  const NEG = /никак|(?:без|нет)\s+(?:оплат|предоплат|задат|залог|взнос|депозит|аванс|платн|брон)|не\s+(?:нужна|нужен|нужны|требуется|требуются)|(?:оплат|предоплат|задат|залог|взнос|депозит|аванс|брон)[^,;]{0,25}отсутств|только по договору|шарт\s+бойынша|эскроу|тегін|жоқ|бесплатн|(?:^|\D)0\s*(тенге|теңге|тг|₸)/i;
  const ESCROW_DENIED = /не\s+(?:через\s+)?эскроу|без\s+эскроу|эскроу\s+жоқ/i;

  // Увод в мессенджер — НЕ платёжный сигнал (не R2), а канальный маркер:
  // «пишите в личку» денег не просит, но уводит сделку с площадки.
  const CHANNEL = [
    /пишите\s+в\s+(?:личку|директ|direct)/i,
    /подробности\s+в\s+(?:личке|директе|direct)/i,
    /в\s+директ/i,
    /whatsapp|вацап|ватсап|вотсап|wa\.me/i,
  ];
  function channelCues(sent: string) {
    const cues = [];
    for (const re of CHANNEL) {
      re.lastIndex = 0;
      const m = re.exec(sent);
      if (m) cues.push(m[0]);
    }
    return cues;
  }

  // Инвест-приманки и давление сроком: не прямое требование денег (не R2), но повод присмотреться.
  const LURE = [
    /инвестиру[йю]/i,
    new RegExp("доходность\\s+(?:до\\s+)?\\d", "i"),
    new RegExp("гарантир" + C() + ".{0,20}(?:доход|прибыль|рост)", "i"),
    /осталось\s+\d+\s+квартир/i,
    /успейте|торопитесь/i,
    new RegExp("(?:цены|цена)\\s+(?:ниже\\s+рынка|только\\s+сегодня|уже\\s+растут)", "i"),
  ];

  const RE_MONEY = new RegExp("(\\d[\\d\\s]*(?:[.,]\\d+)?)\\s*(млрд" + C() + "|млн" + C() + "|тыс\\.?|тысяч" + C() + "|миллион" + C() + "|тенге|теңге|тг|₸)", "gi");
  const RE_PHONE = /((?:\+7|8)[\s\-()]?\d{3}[\s\-()]?\d{3}[\s\-()]?\d{2}[\s\-()]?\d{2})/g;
  const RE_PERCENT = /(\d{1,3})\s*%/g;
  const RE_AREA = new RegExp("(\\d+(?:[.,]\\d+)?)\\s*(?:м\\s?2|м²|кв\\.?\\s*м" + C() + "|шаршы\\s*метр" + C() + ")", "gi");
  const RE_YEAR = new RegExp("((?:19|20)\\d{2})\\s*(год" + C() + "|жыл" + C() + "|г\\.?)", "gi");
  const RE_QUARTER = new RegExp("((?:[1-4]|I{1,3}V?)\\s*[-–]?\\s*(?:квартал" + C() + "|тоқсан" + C() + "))", "gi");
  const RE_DEADLINE = new RegExp("(сдача|сдаем|сдаём|ключи|заселение|ввод" + C() + "\\s+в\\s+эксплуатацию|тапсыру)", "gi");
  const RE_GUARANTEE = new RegExp("(гаранти" + C() + "|кепілдік|единого оператора)", "gi");
  const RE_PERMIT = new RegExp("(разрешен" + C() + "\\s+МИО|МИО\\s+рұқсаты|рұқсат\\s+алынған|ДПГ-\\d[\\d\\-а-яё/]*|KZ\\dVWE\\d+)", "gi");
  const RE_ESCROW = /(эскроу)/gi;
  const RE_CONTRACT = new RegExp("(договор" + C() + "|шарт\\s+бойынша|ДДУ|долев" + C() + "\\s+участи" + C() + "|үлестік)", "gi");
  const RE_HANDLE = /(@[A-Za-z0-9_.]{3,}|t\.me\/[^\s,;]+)/g;
  const RE_URL = /(https?:\/\/[^\s,;()«»\"']+)/g;
  const RE_EMAIL = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
  const RE_RELATIVE = /через\s+\d+\s+(?:месяц[а-яё]*|год[а-яё]*|лет|недел[а-яё]*|д[её]н[а-яё]*|ай[а-яё]*|жыл[а-яё]*)/gi;
  const RE_SEASON = /(весной|летом|осенью|зимой)/gi;

  const UNIT_KZT: [RegExp, number][] = [
    [/млрд/i, 1e9], [/млн/i, 1e6], [/тыс/i, 1e3], [/тысяч/i, 1e3], [/миллион/i, 1e6],
  ];
  function normalizeMoney(numRaw: string, unitRaw: string) {
    const n = parseFloat(String(numRaw).replace(/\s+/g, "").replace(",", "."));
    if (!isFinite(n)) return null;
    let mult = 1;
    for (const [re, m] of UNIT_KZT) if (re.test(unitRaw)) { mult = m; break; }
    return Math.round(n * mult);
  }

  // Точки в сокращениях («кв.», «тыс.», «ул.») не должны рвать предложения.
  // Маскируем их односимвольным плейсхолдером: длина не меняется, спаны валидны.
  // NB: \b не видит границу слова в кириллице без флага u — используем явный разделитель.
  const ABBR_DOT = /(^|[\s(,;«"'“”\-–])(кв|тыс|млн|млрд|г|ул|пр|пер|д|стр|корп|им|т)\./giu;
  // Точки внутри ссылок и почты — тоже не границы предложений.
  const URL_OR_EMAIL = /(https?:\/\/[^\s,;()«»\"']+|t\.me\/[^\s,;]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
  function splitSentences(text: string) {
    const masked = String(text)
      .replace(URL_OR_EMAIL, (m) => m.replace(/\./g, "⁠"))
      .replace(ABBR_DOT, (m, pre, abbr) => pre + abbr + "⁠");
    const out = [];
    const re = /[^.!?…\n]+[.!?…\n]+|[^.!?…\n]+$/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked))) {
      const raw = m[0];
      const s = raw.trim().replace(/⁠/g, ".");
      if (!s) continue;
      const lead = raw.length - raw.trimStart().length;
      out.push({ text: s, start: m.index + lead });
    }
    return out;
  }

  function quote(sent: string) {
    return sent.trim();
  }

  function paymentCues(sent: string) {
    const cues: string[] = [];
    // Scope negation to a clause, and only to payment/legal expressions.
    // «Без комиссии, депозит ...» and «не упустите ...» still require review.
    for (const clause of sent.split(/[,;]|\s+(?:но|а)\s+/i)) {
      for (const re of PAY) {
        re.lastIndex = 0;
        const m = re.exec(clause);
        if (!m) continue;
        const scoped = clause.replace(ESCROW_DENIED, '');
        if (NEG.test(scoped)) continue;
        cues.push(m[0]);
      }
    }
    return cues;
  }

  export function parseAdText(text: string) {
    const input = String(text || "");
    if (!input.trim()) throw new Error("Пустой текст объявления");
    const sentences = splitSentences(input);
    const entities: Entity[] = [];
    const seen = new Set();
    const push = (type: string, label: string, value: string, sent: string, start: number, end: number, confidence: string, extra?: { valueKzt: number }) => {
      const key = type + "|" + String(value).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      entities.push({ type, label, value: String(value), quote: quote(sent), span: [start, end], confidence, ...(extra || {}) });
    };

    const paymentQuotes = [];
    const paymentCueSet: string[] = [];
    const channelQuotes = [];
    for (const { text: sent, start: base } of sentences) {
      const cues = paymentCues(sent);
      const hasPay = cues.length > 0;
      if (hasPay) for (const c of cues) if (!paymentCueSet.includes(c)) paymentCueSet.push(c);
      let m: RegExpExecArray | null;
      const scan = (re: RegExp, fn: (m: RegExpExecArray) => void) => { re.lastIndex = 0; while ((m = re.exec(sent))) fn(m); };
      scan(RE_MONEY, (m) => {
        const kzt = normalizeMoney(m[1], m[2]);
        push("money", "Сумма", m[0].trim(), sent, base + m.index, base + m.index + m[0].length,
          hasPay ? "high" : "medium", kzt == null ? undefined : { valueKzt: kzt });
      });
      scan(RE_PHONE, (m) => push("phone", "Телефон", m[1].trim(), sent, base + m.index, base + m.index + m[1].length, "high"));
      scan(RE_PERCENT, (m) => {
        const ready = /(готов|дайын|выполнен|орындал)/i.test(sent);
        push("readiness", "Готовность", m[1] + "%", sent, base + m.index, base + m.index + m[0].length, ready ? "high" : "medium");
      });
      scan(RE_AREA, (m) => push("area", "Площадь", m[0].trim(), sent, base + m.index, base + m.index + m[0].length, "high"));
      scan(RE_YEAR, (m) => push("date", "Срок", m[0].trim(), sent, base + m.index, base + m.index + m[0].length, "high"));
      scan(RE_QUARTER, (m) => push("date", "Квартал", m[1].trim(), sent, base + m.index, base + m.index + m[1].length, "high"));
      scan(RE_DEADLINE, (m) => push("deadline", "Маркер срока", m[1].trim(), sent, base + m.index, base + m.index + m[1].length, "medium"));
      scan(RE_GUARANTEE, (m) => push("legal", "Упоминание гарантии", m[1].trim(), sent, base + m.index, base + m.index + m[1].length, "medium"));
      scan(RE_PERMIT, (m) => push("legal", "Упоминание разрешения", m[1].trim(), sent, base + m.index, base + m.index + m[1].length, "medium"));
      scan(RE_ESCROW, (m) => push("legal", "Эскроу", m[1].trim(), sent, base + m.index, base + m.index + m[1].length, "medium"));
      scan(RE_CONTRACT, (m) => push("legal", "Договор", m[1].trim(), sent, base + m.index, base + m.index + m[1].length, "medium"));
      scan(RE_HANDLE, (m) => push("contact", "Контакт", m[1].trim(), sent, base + m.index, base + m.index + m[1].length, "high"));
      scan(RE_URL, (m) => push("contact", "Ссылка", m[1].trim(), sent, base + m.index, base + m.index + m[1].length, "high"));
      scan(RE_EMAIL, (m) => push("contact", "Почта", m[1].trim(), sent, base + m.index, base + m.index + m[1].length, "high"));
      scan(RE_RELATIVE, (m) => push("date", "Относит. срок", m[0].trim(), sent, base + m.index, base + m.index + m[0].length, "medium"));
      scan(RE_SEASON, (m) => push("date", "Сезон сдачи", m[1].trim(), sent, base + m.index, base + m.index + m[1].length, "medium"));
      for (const re of LURE) {
        re.lastIndex = 0;
        const lm = re.exec(sent);
        if (lm) push("lure", "Инвест-приманка", lm[0].trim(), sent, base + lm.index, base + lm.index + lm[0].length, "medium");
      }
      for (const re of CHANNEL) {
        re.lastIndex = 0;
        const cm = re.exec(sent);
        if (cm) push("channel", "Увод в мессенджер", cm[0].trim(), sent, base + cm.index, base + cm.index + cm[0].length, "medium");
      }
      if (hasPay) paymentQuotes.push(quote(sent));
      else if (channelCues(sent).length) channelQuotes.push(quote(sent));
    }

    const byType: Record<string, number> = {};
    for (const e of entities) byType[e.type] = (byType[e.type] || 0) + 1;
    return {
      engine: "local-parser-v3",
      sentences: sentences.length,
      payment: { flagged: paymentQuotes.length > 0, quotes: paymentQuotes.slice(0, 3), cues: paymentCueSet.slice(0, 5) },
      channel: { flagged: channelQuotes.length > 0, quotes: channelQuotes.slice(0, 3) },
      entities,
      counts: byType,
    };
  }

  // ---------- Источники: веб / соцсети / мессенджеры ----------
  // Честная модель: живого скрейпинга из статичного демо нет (CORS, авторизация,
  // правила площадок). Парсер нормализует источник по URL и подсказкам в тексте,
  // чтобы аналитик видел происхождение публикации и находил связанные
  // аккаунты и телефоны (доп. сценарий п.11 ТЗ).
  const PLATFORMS = [
    { key: "krisha", label: "Krisha.kz", urlRe: /krisha\.kz/i, hintRe: /krisha|крыша/i },
    { key: "olx", label: "OLX", urlRe: /olx\.kz|olx\./i, hintRe: /\bolx\b/i },
    { key: "instagram", label: "Instagram", urlRe: /instagram\.com|instagr\.am/i, hintRe: /instagram|инстаграм|директ|сторис/i },
    { key: "tiktok", label: "TikTok", urlRe: /tiktok\.com/i, hintRe: /tiktok|тикток/i },
    { key: "telegram", label: "Telegram", urlRe: /t\.me|telegram\.(me|org|dog)/i, hintRe: /telegram|телеграм|тг-канал/i },
    { key: "whatsapp", label: "WhatsApp", urlRe: /wa\.me|whatsapp\.com/i, hintRe: /whatsapp|вацап|ватсап|вотсап/i },
    { key: "developer", label: "Сайт застройщика", urlRe: null, hintRe: /сайт застройщика|официальный сайт|отдел продаж/i },
  ];
  export function detectPlatform(info: SourceInfo) {
    let url = '';
    try { url = new URL(info.url || '').hostname; } catch { /* Manual source hints remain usable. */ }
    const txt = String(((info && info.platform) || "") + " " + ((info && info.text) || ""));
    for (const p of PLATFORMS) {
      if (p.urlRe && p.urlRe.test(url) && /(^|\.)(krisha\.kz|olx\.[a-z]+|instagram\.com|instagr\.am|tiktok\.com|t\.me|telegram\.(me|org|dog)|wa\.me|whatsapp\.com)$/.test(url)) return { key: p.key, label: p.label, via: "url" };
    }
    for (const p of PLATFORMS) {
      if (p.hintRe && p.hintRe.test(txt)) return { key: p.key, label: p.label, via: "hint" };
    }
    if (txt.trim()) return { key: "other", label: String((info && info.platform) || "Другой источник").slice(0, 60), via: "manual" };
    return { key: "unknown", label: "Источник не указан", via: "unknown" };
  }
  export function platformLabel(key: string) {
    const p = PLATFORMS.find((x) => x.key === key);
    return p ? p.label : "Другой источник";
  }

  // Телефон к каноническому виду +7XXXXXXXXXX для поиска связей.
  const RE_PHONE_G = /((?:\+7|8)[\s\-()]?\d{3}[\s\-()]?\d{3}[\s\-()]?\d{2}[\s\-()]?\d{2})/g;
  const RE_HANDLE_G = /(@[A-Za-z0-9_.]{3,}|t\.me\/[^\s,;]+)/g;
  export function normPhone(p: string) {
    let d = String(p || "").replace(/\D/g, "");
    if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1);
    if (d.length === 10) d = "7" + d;
    return d.length >= 10 ? "+" + d : null;
  }
  function phoneList(s: string) {
    RE_PHONE_G.lastIndex = 0;
    return (String(s || "").match(RE_PHONE_G) || []).map(normPhone).filter(Boolean);
  }
  function handleList(s: string) {
    RE_HANDLE_G.lastIndex = 0;
    return (String(s || "").match(RE_HANDLE_G) || []).map((h) => h.toLowerCase());
  }
  function normUrl(u: string) {
    const s = String(u || "").trim().toLowerCase().replace(/\/$/, "");
    if (!s || s.indexOf("example.invalid") >= 0) return null;
    return s;
  }

  // Связанные публикации: общий телефон, аккаунт или ссылка.
  export function relatedAds(ad: Ad, ads: Ad[]) {
    const out = [];
    const phones = new Set(phoneList(ad.text));
    const handles = new Set(handleList((ad.text || "") + " " + (ad.account || "")));
    const myUrl = normUrl(ad.url);
    for (const other of (ads || [])) {
      if (!other || other.id === ad.id) continue;
      const vias = [];
      if (phoneList(other.text).some((p) => phones.has(p))) vias.push("общий телефон");
      const oh = handleList((other.text || "") + " " + (other.account || ""));
      if (oh.some((h) => h.length >= 4 && handles.has(h))) vias.push("общий аккаунт");
      if (myUrl && normUrl(other.url) === myUrl) vias.push("общая ссылка");
      if (vias.length) out.push({ id: other.id, via: vias.join(" + ") });
    }
    return out;
  }

  export function dedupeKey(ad: { text: string }) {
    const txt = String(ad.text || "");
    const ph = phoneList(txt)[0] || "nophone";
    RE_PHONE_G.lastIndex = 0;
    const canon = txt.replace(RE_PHONE_G, (m) => normPhone(m) || m);
    const head = canon.replace(/\s+/g, " ").trim().toLowerCase();
    return ph + "|" + head;
  }


const CSV_COLS: Record<string, string[]> = {
 text: ['text', 'текст', 'объявление', 'публикация'], platform: ['platform', 'площадка', 'источник'],
 account: ['account', 'аккаунт'], date: ['date', 'дата'], url: ['url', 'ссылка'], zkHint: ['zk', 'жк', 'объект']
};
export function parseCsvAds(input: string) {
 const result = Papa.parse<Record<string, string>>(input.trim(), { header: true, skipEmptyLines: true, transformHeader: h => h.trim().toLowerCase().replace(/^\uFEFF/, '') });
 const fields = result.meta.fields || [];
 if (!fields.some(f => CSV_COLS.text.includes(f))) throw new Error('Нет колонки текста (text/текст)');
 const errors = result.errors.map(e => `Строка ${(e.row ?? 0) + 2}: ${e.message}`);
 const rows = result.data.flatMap((row, index) => {
  const get = (key: string) => row[fields.find(f => CSV_COLS[key].includes(f)) || ''] || '';
  if (!get('text').trim()) { errors.push(`Строка ${index + 2}: пустой текст`); return []; }
  return [{ text: get('text'), platform: get('platform'), account: get('account'), date: get('date'), url: get('url'), zkHint: get('zkHint') }];
 });
 return { rows, errors, delim: result.meta.delimiter };
}
