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
  // KZ «емес» ограничен границами слова: частое «немесе» («или») отрицанием не является.
  const NEG_BOUND_EMEC = /(?:^|[^\wа-яёәіңғүұқөһ])емес(?:$|[^\wа-яёәіңғүұқөһ])/i;
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

  // Спан указывает ровно на обрезанный матч: text.slice(start, end) === value.
  // Индексы — UTF-16 кодовые единицы JS (те же, что использует String.slice).
  function trimSpan(base: number, index: number, raw: string) {
    const value = raw.trim();
    const lead = value ? raw.length - raw.trimStart().length : 0;
    const start = base + index + lead;
    return { value, start, end: start + value.length };
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
        if (NEG.test(scoped) || NEG_BOUND_EMEC.test(scoped)) continue;
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
      const sp = (m: RegExpExecArray, raw: string) => trimSpan(base, m.index, raw);
      scan(RE_MONEY, (m) => {
        const kzt = normalizeMoney(m[1], m[2]);
        const s = sp(m, m[0]);
        push("money", "Сумма", s.value, sent, s.start, s.end,
          hasPay ? "high" : "medium", kzt == null ? undefined : { valueKzt: kzt });
      });
      scan(RE_PHONE, (m) => { const s = sp(m, m[1]); push("phone", "Телефон", s.value, sent, s.start, s.end, "high"); });
      scan(RE_PERCENT, (m) => {
        const ready = /(готов|дайын|выполнен|орындал)/i.test(sent);
        push("readiness", "Готовность", m[1] + "%", sent, base + m.index, base + m.index + m[0].length, ready ? "high" : "medium");
      });
      scan(RE_AREA, (m) => { const s = sp(m, m[0]); push("area", "Площадь", s.value, sent, s.start, s.end, "high"); });
      scan(RE_YEAR, (m) => { const s = sp(m, m[0]); push("date", "Срок", s.value, sent, s.start, s.end, "high"); });
      scan(RE_QUARTER, (m) => { const s = sp(m, m[1]); push("date", "Квартал", s.value, sent, s.start, s.end, "high"); });
      scan(RE_DEADLINE, (m) => { const s = sp(m, m[1]); push("deadline", "Маркер срока", s.value, sent, s.start, s.end, "medium"); });
      scan(RE_GUARANTEE, (m) => { const s = sp(m, m[1]); push("legal", "Упоминание гарантии", s.value, sent, s.start, s.end, "medium"); });
      scan(RE_PERMIT, (m) => { const s = sp(m, m[1]); push("legal", "Упоминание разрешения", s.value, sent, s.start, s.end, "medium"); });
      scan(RE_ESCROW, (m) => { const s = sp(m, m[1]); push("legal", "Эскроу", s.value, sent, s.start, s.end, "medium"); });
      scan(RE_CONTRACT, (m) => { const s = sp(m, m[1]); push("legal", "Договор", s.value, sent, s.start, s.end, "medium"); });
      scan(RE_HANDLE, (m) => { const s = sp(m, m[1]); push("contact", "Контакт", s.value, sent, s.start, s.end, "high"); });
      scan(RE_URL, (m) => { const s = sp(m, m[1]); push("contact", "Ссылка", s.value, sent, s.start, s.end, "high"); });
      scan(RE_EMAIL, (m) => { const s = sp(m, m[1]); push("contact", "Почта", s.value, sent, s.start, s.end, "high"); });
      scan(RE_RELATIVE, (m) => { const s = sp(m, m[0]); push("date", "Относит. срок", s.value, sent, s.start, s.end, "medium"); });
      scan(RE_SEASON, (m) => { const s = sp(m, m[1]); push("date", "Сезон сдачи", s.value, sent, s.start, s.end, "medium"); });
      for (const re of LURE) {
        re.lastIndex = 0;
        const lm = re.exec(sent);
        if (lm) { const s = sp(lm, lm[0]); push("lure", "Инвест-приманка", s.value, sent, s.start, s.end, "medium"); }
      }
      for (const re of CHANNEL) {
        re.lastIndex = 0;
        const cm = re.exec(sent);
        if (cm) { const s = sp(cm, cm[0]); push("channel", "Увод в мессенджер", s.value, sent, s.start, s.end, "medium"); }
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

  /* ------------------------------------------------------------------ */
  /* S3.2 (C4). Единый канонический ключ дедупа: zkId|canonicalText.     */
  /* Паритет с validation.adDedupeKey и SQL public.ad_dedupe_key        */
  /* (серверный пересчёт, клиентскому ключу никто не доверяет): полный  */
  /* текст, телефоны 8XXXXXXXXXX → +7XXXXXXXXXX, схлопнутые пробелы,     */
  /* нижний регистр. Сравнение — строго в пределах одного ЖК: тот же     */
  /* текст в другом ЖК допустим. Старый dedupeKey оставлен для           */
  /* совместимости черновиков без zkId (CSV-строки до сопоставления).    */
  /* ------------------------------------------------------------------ */

  /** KZ-телефон вида +7/8 + 10 цифр (зеркало AD_PHONE_RE из validation.ts). */
  const AD_PHONE_RE = /((?:\+7|8)[\s\-()]?\d{3}[\s\-()]?\d{3}[\s\-()]?\d{2}[\s\-()]?\d{2})/g;

  function normKzPhone(m: string): string | null {
    let d = m.replace(/\D/g, '');
    if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
    if (d.length === 10) d = '7' + d;
    return d.length >= 10 ? '+' + d : null;
  }

  /** Канонический текст публикации для дедупа: телефоны → +7, пробелы/регистр. */
  export function canonicalAdText(text: string): string {
    AD_PHONE_RE.lastIndex = 0;
    const canon = String(text ?? '').replace(AD_PHONE_RE, (m) => normKzPhone(m) ?? m);
    return canon.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /**
   * Полный ключ дедупа C4: область (zkId) + канонический текст.
   * Без zkId (несопоставленный черновик) — голый канон: такое сравнение
   * глобально и повтором не считается, только подсказка для preview.
   */
  export function adDedupeKey(zkId: string, text: string): string;
  export function adDedupeKey(ad: { text: string; zkId?: string }): string;
  export function adDedupeKey(zkIdOrAd: string | { text: string; zkId?: string }, text?: string): string {
    const zkId = typeof zkIdOrAd === 'string' ? zkIdOrAd : (zkIdOrAd.zkId ?? '');
    const body = typeof zkIdOrAd === 'string' ? String(text ?? '') : String(zkIdOrAd.text ?? '');
    const canon = canonicalAdText(body);
    return zkId ? `${zkId}|${canon}` : canon;
  }


import type { CsvHintKind, CsvParseResult, CsvRow } from './types';

const CSV_COLS: Record<string, string[]> = {
 text: ['text', 'текст', 'объявление', 'публикация'], platform: ['platform', 'площадка', 'источник'],
 account: ['account', 'аккаунт'], date: ['date', 'дата'], url: ['url', 'ссылка'], zkHint: ['zk', 'жк', 'объект']
};
// Локальная проверка календарной даты (без импорта validation: тот модуль
// ссылается на парсер в комментариях стыка, цикл здесь не нужен).
const CSV_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isCsvCalendarDate(value: string) {
 if (!CSV_DATE_RE.test(value)) return false;
 const [y, m, d] = value.split('-').map(Number);
 const t = Date.UTC(y, m - 1, d);
 const dt = new Date(t);
 return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
/**
 * S3.3 (C4). Подсказка ЖК из CSV: точное совпадение ID → предсопоставление;
 * уникальное совпадение имени (без учёта регистра/пробелов) → предложение;
 * пусто/неизвестно/двусмысленно → null. Предыдущий выбор UI не наследуется:
 * вызывающий обязан явно подтвердить mappedZkId или выбрать ЖК вручную.
 */
export function resolveCsvHint(hint: string, targets: { id: string; name: string }[]): { mappedZkId: string | null; suggestionId: string | null; kind: CsvHintKind } {
 const h = String(hint || '').trim();
 if (!h) return { mappedZkId: null, suggestionId: null, kind: 'unknown' };
 const byId = targets.find(t => t.id === h) || targets.find(t => t.id.toLowerCase() === h.toLowerCase());
 if (byId) return { mappedZkId: byId.id, suggestionId: null, kind: 'id' };
 const norm = (s: string) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
 const named = targets.filter(t => norm(t.name) === norm(h) || (norm(h).length >= 3 && norm(t.name).includes(norm(h))));
 if (named.length === 1) return { mappedZkId: null, suggestionId: named[0].id, kind: 'name' };
 if (named.length > 1) return { mappedZkId: null, suggestionId: null, kind: 'ambiguous' };
 return { mappedZkId: null, suggestionId: null, kind: 'unknown' };
}
export function parseCsvAds(input: string): CsvParseResult {
 const src = String(input || '').replace(/^\uFEFF/, '');
 if (!src.trim()) throw new Error('Пустой CSV');
 const result = Papa.parse<Record<string, string>>(src, { header: true, skipEmptyLines: true, transformHeader: h => h.trim().toLowerCase().replace(/^\uFEFF/, '') });
 const fields = result.meta.fields || [];
 if (!fields.some(f => CSV_COLS.text.includes(f))) throw new Error('Нет колонки текста (text/текст)');
 const errors = result.errors.map(e => `Строка ${(e.row ?? 0) + 2}: ${e.message}`);
 const rows: CsvRow[] = (result.data as Record<string, unknown>[]).map((rawRow, index) => {
  const row = (rawRow || {}) as Record<string, unknown>;
  const get = (key: string): string => {
   const f = fields.find(ff => CSV_COLS[key].includes(ff));
   const v = f ? row[f] : '';
   return String(v ?? '').trim();
  };
  const rowNumber = index + 2;
  const rowErrors: string[] = [];
  const text = get('text');
  if (!text) rowErrors.push(`Строка ${rowNumber}: пустой текст`);
  const dateRaw = get('date');
  let date: string | null = null;
  if (dateRaw) {
   if (isCsvCalendarDate(dateRaw)) date = dateRaw;
   else { rowErrors.push(`Строка ${rowNumber}: неверная дата «${dateRaw}» (нужна реальная YYYY-MM-DD)`); }
  }
  // Ошибки PapaParse, привязанные к этой строке данных, блокируют её save.
  for (const e of result.errors) {
   if ((e.row ?? -1) === index) rowErrors.push(`Строка ${rowNumber}: ${e.message}`);
  }
  return {
   rowId: `csv-r${index + 1}`, rowNumber, text,
   platform: get('platform'), account: get('account'),
   date, dateRaw, url: get('url'), zkHint: get('zkHint'),
   errors: rowErrors, hintKind: 'unknown' as CsvHintKind,
   mappedZkId: null, suggestionId: null, savedAdId: null,
  };
 });
 return { rows, errors, delim: result.meta.delimiter };
}
