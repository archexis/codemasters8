// SAQ QURYLYS — локальный парсер объявлений v2 (без сети, без ИИ).
// Детерминированно извлекает сущности с дословными цитатами И символьными
// спанами [start, end] в исходном тексте:
// телефоны, деньги (с нормализацией в тенге), площадь, готовность в %,
// даты/сроки, юридические маркеры, контакты, инвест-приманки,
// платёжные сигналы с учётом отрицаний (RU + KZ).
// Важно: \w НЕ покрывает кириллицу — везде явный класс CYR.
(function () {
  "use strict";

  const CYR = "а-яёәіңғүұқөһ";
  const C = (s) => "[" + CYR + "]" + (s || "*");

  const PAY = [
    /брон[ьи]/i, /депозит/i,
    new RegExp("первоначальн" + C() + "\\s+взнос", "i"),
    new RegExp("перв" + C() + "\\s+взнос", "i"),
    /первоначалк/i,
    new RegExp("договор(" + "\\s+" + C("+") + "){0,3}\\s+бронирования", "i"),
    /задато[кч]/i, /предоплат/i, /аванс/i, /взнос/i, /залог/i,
    new RegExp("рассрочк" + C() + "\\s+от\\s+застройщика", "i"),
    new RegExp("оплат" + C() + "\\s+(?:напрямую|до\\s+заключения|до\\s+договора|наличными|на\\s+карту|переводом)", "i"),
    new RegExp("перевод[" + CYR + "]{0,20}(?:на\\s+карту|наличными|застройщику)", "i"),
    new RegExp("резерв" + C() + ".{0,30}плат", "i"),
    new RegExp("фиксиру" + C() + ".{0,30}цен", "i"),
    /кепіл(?!дік)/i, /төле/i, /бронда/i, /жарна/i, /қолма-қол/i,
    /алғашқы\s+жарна/i, /бастапқы\s+жарна/i,
    /алдын ала.{0,25}(?:төле|төлем|жарна|ақы)/i,
  ];
  const NEG = /никак|без |не |нет |не нужна|не нужен|не требуется|отсутств|только по договору|шарт\s+бойынша|эскроу|тегін|жоқ|бесплатн|без оплат|без предоплат|без задатка|без залога|(?:^|\D)0\s*(тенге|теңге|тг|₸)/i;
  const ESCROW_DENIED = /не\s+(?:через\s+)?эскроу|без\s+эскроу|эскроу\s+жоқ/i;

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

  const UNIT_KZT = [
    [/млрд/i, 1e9], [/млн/i, 1e6], [/тыс/i, 1e3], [/тысяч/i, 1e3], [/миллион/i, 1e6],
  ];
  function normalizeMoney(numRaw, unitRaw) {
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
  function splitSentences(text) {
    const masked = String(text)
      .replace(URL_OR_EMAIL, (m) => m.replace(/\./g, "⁠"))
      .replace(ABBR_DOT, (m, pre, abbr) => pre + abbr + "⁠");
    const out = [];
    const re = /[^.!?…\n]+[.!?…\n]+|[^.!?…\n]+$/g;
    let m;
    while ((m = re.exec(masked))) {
      const raw = m[0];
      const s = raw.trim().replace(/⁠/g, ".");
      if (!s) continue;
      const lead = raw.length - raw.trimStart().length;
      out.push({ text: s, start: m.index + lead });
    }
    return out;
  }

  function quote(sent) {
    const s = sent.trim();
    return s.length > 280 ? s.slice(0, 280).trim() + "…" : s;
  }

  function paymentCues(sent) {
    const cues = [];
    for (const re of PAY) {
      re.lastIndex = 0;
      const m = re.exec(sent);
      if (!m) continue;
      if (ESCROW_DENIED.test(sent)) { cues.push(m[0]); continue; }
      if (NEG.test(sent)) continue;
      cues.push(m[0]);
    }
    return cues;
  }

  function parseAdText(text) {
    const input = String(text || "");
    if (!input.trim()) throw new Error("Пустой текст объявления");
    const sentences = splitSentences(input);
    const entities = [];
    const seen = new Set();
    const push = (type, label, value, sent, start, end, confidence, extra) => {
      const key = type + "|" + String(value).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      entities.push({ type, label, value: String(value), quote: quote(sent), span: [start, end], confidence, ...(extra || {}) });
    };

    const paymentQuotes = [];
    const paymentCueSet = [];
    for (const { text: sent, start: base } of sentences) {
      const cues = paymentCues(sent);
      const hasPay = cues.length > 0;
      if (hasPay) for (const c of cues) if (!paymentCueSet.includes(c)) paymentCueSet.push(c);
      let m;
      const scan = (re, fn) => { re.lastIndex = 0; while ((m = re.exec(sent))) fn(m); };
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
      if (hasPay) paymentQuotes.push(quote(sent));
    }

    const byType = {};
    for (const e of entities) byType[e.type] = (byType[e.type] || 0) + 1;
    return {
      engine: "local-parser-v2",
      sentences: sentences.length,
      payment: { flagged: paymentQuotes.length > 0, quotes: paymentQuotes.slice(0, 3), cues: paymentCueSet.slice(0, 5) },
      entities,
      counts: byType,
    };
  }

  if (typeof window !== "undefined") window.SQ_Parser = { parseAdText };
  if (typeof module !== "undefined" && module.exports) module.exports = { parseAdText };
})();
