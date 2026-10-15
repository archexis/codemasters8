// SAQ QURYLYS — настоящий локальный парсер объявлений (без сети, без ИИ).
// Детерминированно извлекает сущности с дословными цитатами:
// телефоны, деньги, готовность в %, даты/сроки, юридические маркеры,
// контакты, платёжные сигналы с учётом отрицаний (RU + KZ).
(function () {
  "use strict";

  const CYR = "а-яёәіңғүұқөһ";

  const PAY = [
    /брон[ьи]/i, /депозит/i,
    new RegExp("первоначальн[" + CYR + "]*\\s+взнос", "i"),
    /задато[кч]/i, /предоплат/i, /аванс/i, /взнос/i,
    new RegExp("рассрочк[" + CYR + "]*\\s+от\\s+застройщика", "i"),
    new RegExp("оплат[" + CYR + "]*\\s+(?:напрямую|до\\s+заключения|до\\s+договора)", "i"),
    new RegExp("резерв[" + CYR + "]*.{0,30}плат", "i"),
    new RegExp("фиксиру[" + CYR + "]*.{0,30}цен", "i"),
    /төлем/i, /бронда/i, /жарна/i,
    /алдын ала.{0,25}(?:төле|төлем|жарна|ақы)/i,
  ];
  const NEG = /никак|без |не |нет |отсутств|только по договору|эскроу|тегін|жоқ|бесплатн|без оплат|(?:^|\D)0\s*тенге/i;
  const ESCROW_DENIED = /не\s+(?:через\s+)?эскроу|без\s+эскроу|эскроу\s+жоқ/i;

  const RE_MONEY = /(\d[\d\s]*(?:[.,]\d+)?)\s*(млрд|млн|тыс\.?|тысяч\w*|миллион\w*|тенге|тг|₸|теңге)/gi;
  const RE_PHONE = /((?:\+7|8)[\s\-()]?\d{3}[\s\-()]?\d{3}[\s\-()]?\d{2}[\s\-()]?\d{2})/g;
  const RE_PERCENT = /(\d{1,3})\s*%/g;
  const RE_YEAR = /((?:19|20)\d{2})\s*(год\w*|жыл\w*|г\.?)/gi;
  const RE_QUARTER = /((?:[1-4]|I{1,3}V?)\s*[-–]?\s*(?:квартал\w*|тоқсан\w*))/gi;
  const RE_DEADLINE = /(сдача|сдаем|сдаём|ключи|заселение|ввод\w*\s+в\s+эксплуатацию|тапсыру)/gi;
  const RE_GUARANTEE = /(гаранти\w*|кепілдік|единого оператора)/gi;
  const RE_PERMIT = /(разрешен\w*\s+МИО|МИО\s+рұқсаты|рұқсат\s+алынған)/gi;
  const RE_ESCROW = /(эскроу)/gi;
  const RE_CONTRACT = /(договор\w*|шарт\s+бойынша|ДДУ|долев\w*\s+участи\w*|үлестік)/gi;
  const RE_HANDLE = /(@[A-Za-z0-9_.]{3,}|t\.me\/[^\s,;]+)/g;
  const RE_URL = /(https?:\/\/[^\s,;()«»"']+)/g;

  function splitSentences(text) {
    return String(text).split(/(?<=[.!?…\n])\s+/).map((s) => s.trim()).filter(Boolean);
  }

  function quote(sent) {
    const s = sent.trim();
    return s.length > 280 ? s.slice(0, 280).trim() + "…" : s;
  }

  function paymentInSentence(sent) {
    for (const re of PAY) {
      if (!re.test(sent)) continue;
      if (ESCROW_DENIED.test(sent)) return true;
      if (NEG.test(sent)) continue;
      return true;
    }
    return false;
  }

  function parseAdText(text) {
    const input = String(text || "");
    if (!input.trim()) throw new Error("Пустой текст объявления");
    const sentences = splitSentences(input);
    const entities = [];
    const seen = new Set();
    const push = (type, label, value, sent, confidence) => {
      const key = type + "|" + String(value).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      entities.push({ type, label, value: String(value), quote: quote(sent), confidence });
    };

    const paymentQuotes = [];
    for (const sent of sentences) {
      const hasPay = paymentInSentence(sent);
      let m;
      RE_MONEY.lastIndex = 0;
      while ((m = RE_MONEY.exec(sent))) {
        push("money", "Сумма", m[0].trim(), sent, hasPay ? "high" : "medium");
      }
      RE_PHONE.lastIndex = 0;
      while ((m = RE_PHONE.exec(sent))) push("phone", "Телефон", m[1].trim(), sent, "high");
      RE_PERCENT.lastIndex = 0;
      while ((m = RE_PERCENT.exec(sent))) {
        const ready = /(готов|дайын|выполнен|орындал)/i.test(sent);
        push("readiness", "Готовность", m[1] + "%", sent, ready ? "high" : "medium");
      }
      RE_YEAR.lastIndex = 0;
      while ((m = RE_YEAR.exec(sent))) push("date", "Срок", m[0].trim(), sent, "high");
      RE_QUARTER.lastIndex = 0;
      while ((m = RE_QUARTER.exec(sent))) push("date", "Квартал", m[1].trim(), sent, "high");
      RE_DEADLINE.lastIndex = 0;
      while ((m = RE_DEADLINE.exec(sent))) push("deadline", "Маркер срока", m[1].trim(), sent, "medium");
      RE_GUARANTEE.lastIndex = 0;
      while ((m = RE_GUARANTEE.exec(sent))) push("legal", "Упоминание гарантии", m[1].trim(), sent, "medium");
      RE_PERMIT.lastIndex = 0;
      while ((m = RE_PERMIT.exec(sent))) push("legal", "Упоминание разрешения", m[1].trim(), sent, "medium");
      RE_ESCROW.lastIndex = 0;
      while ((m = RE_ESCROW.exec(sent))) push("legal", "Эскроу", m[1].trim(), sent, "medium");
      RE_CONTRACT.lastIndex = 0;
      while ((m = RE_CONTRACT.exec(sent))) push("legal", "Договор", m[1].trim(), sent, "medium");
      RE_HANDLE.lastIndex = 0;
      while ((m = RE_HANDLE.exec(sent))) push("contact", "Контакт", m[1].trim(), sent, "high");
      RE_URL.lastIndex = 0;
      while ((m = RE_URL.exec(sent))) push("contact", "Ссылка", m[1].trim(), sent, "high");
      if (hasPay) paymentQuotes.push(quote(sent));
    }

    const byType = {};
    for (const e of entities) byType[e.type] = (byType[e.type] || 0) + 1;
    return {
      engine: "local-parser",
      sentences: sentences.length,
      payment: { flagged: paymentQuotes.length > 0, quotes: paymentQuotes.slice(0, 3) },
      entities,
      counts: byType,
    };
  }

  if (typeof window !== "undefined") window.SQ_Parser = { parseAdText };
  if (typeof module !== "undefined" && module.exports) module.exports = { parseAdText };
})();
