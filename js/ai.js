// SAQ QURYLYS — AI extraction adapter.
// Real inference when the user provides an OpenAI-compatible key + endpoint
// (stored in localStorage only, never committed). Otherwise an explicitly
// labeled DEMO heuristic fallback. Never present heuristic as real AI.
(function () {
  const LS_KEY = "sq_ai_config_v1";

  function getConfig() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); }
    catch { return {}; }
  }
  function saveConfig(cfg) { localStorage.setItem(LS_KEY, JSON.stringify(cfg || {})); }
  function hasRealAI() {
    const c = getConfig();
    return !!(c && c.apiKey && c.endpoint && c.model);
  }

  // Источники шаблонов экспортируются для подсветки в UI (единый источник истины).
  // Внутренние группы — только (?:…), чтобы внешняя обёртка для <mark> была $1.
  // Важно: \w НЕ покрывает кириллицу/қазақша — используем явный класс [а-яёәіңғүұқөһ].
  const CYR = "а-яёәіңғүұқөһ";
  const PAY_PATTERNS = [
    /брон[ьи]/i, /депозит/i,
    new RegExp("первоначальн[" + CYR + "]*\\s+взнос", "i"),
    new RegExp("перв[" + CYR + "]*\\s+взнос", "i"),
    /первоначалк/i,
    /задато[кч]/i, /предоплат/i, /аванс/i, /взнос/i, /залог/i,
    new RegExp("рассрочк[" + CYR + "]*\\s+от\\s+застройщика", "i"),
    new RegExp("оплат[" + CYR + "]*\\s+(?:напрямую|до\\s+заключения|до\\s+договора|наличными|на\\s+карту|переводом)", "i"),
    new RegExp("перевод[" + CYR + "]{0,20}(?:на\\s+карту|наличными|застройщику)", "i"),
    new RegExp("резерв[" + CYR + "]*.{0,30}плат", "i"),
    new RegExp("фиксиру[" + CYR + "]*.{0,30}цен", "i"),
    new RegExp("договор(?:\\s+[" + CYR + "]+){0,3}\\s+бронирования", "i"),
    // Қазақша формулировки
    /кепіл(?!дік)/i, /төле/i, /бронда/i, /алғашқы\s+жарна/i, /бастапқы\s+жарна/i, /жарна/i, /қолма-қол/i,
    /алдын ала.{0,25}(?:төле|төлем|жарна|ақы)/i, /ақы\s+төлеу/i,
  ];

  // Отрицание действует в пределах одного предложения: «Взнос 2 млн. Бронь бесплатная.»
  // взнос — находка, бронь — нет. Межпредложенческие «очистки» запрещены.
  const NEG_WORDS_RE = /никак|без |не |нет |не нужна|не нужен|не требуется|отсутств|только по договору|шарт\s+бойынша|эскроу|тегін|жоқ|бесплатн|без оплат|без предоплат|без задатка|без залога|(?:^|\D)0\s*(тенге|теңге|тг|₸)/i;
  // «не через эскроу» / «эскроу жоқ» — отягчает, а не очищает: такую «очистку» запрещаем.
  const ESCROW_DENIED_RE = /не\s+(?:через\s+)?эскроу|без\s+эскроу|эскроу\s+жоқ/i;

  function sentenceFlagged(sent) {
    for (const re of PAY_PATTERNS) {
      if (!re.test(sent)) continue;
      if (ESCROW_DENIED_RE.test(sent)) return { flagged: true };
      if (NEG_WORDS_RE.test(sent)) continue; // отрицание в том же предложении — не находка
      return { flagged: true };
    }
    return { flagged: false, negated: NEG_WORDS_RE.test(sent) };
  }

  function heuristicAnalyze(text) {
    const findings = [];
    let negatedOnly = false;
    const sentences = String(text).split(/(?<=[.!?…\n])\s+/).map((s) => s.trim()).filter(Boolean);
    for (const sent of sentences) {
      const r = sentenceFlagged(sent);
      if (r.flagged) {
        findings.push({
          payment_offer_detected: true,
          candidate_factor: "R2",
          exact_quote: sent.length > 280 ? sent.slice(0, 280).trim() + "…" : sent,
          explanation: "Эвристика DEMO: найдена формулировка про платёж до/вне договора. Требует проверки человеком.",
          confidence: "low-demo",
          needs_human_review: true,
        });
        break; // первая находка — достаточно для гипотезы; остальное решает человек
      }
      if (r.negated) negatedOnly = true;
    }
    return {
      engine: "demo-heuristic",
      realAI: false,
      hypotheses: findings,
      limitations: [(negatedOnly && !findings.length ? "Платёжные слова встретились только в отрицании («без», «никаких», «не») — находок нет. " : "") + "Локальная эвристика по ключевым словам, а не языковая модель.", "Не делает юридических выводов.", "Каждая гипотеза требует подтверждения человеком и не влияет на балл до подтверждения."],
    };
  }

  // Real LLM call: OpenAI-compatible /chat/completions. Returns same shape.
  async function realAnalyze(text, zkName) {
    const c = getConfig();
    const sys = "Ты ассистент аналитика долевого строительства Казахстана. Из рекламного текста извлеки ТОЛЬКО прямое предложение внести деньги (платная бронь, депозит, первоначальный взнос, задаток, предоплата застройщику до договора). Ответь строго JSON: {\"payment_offer_detected\": bool, \"exact_quote\": \"точная подстрока из текста или null\", \"explanation\": \"коротко\", \"confidence\": \"high|medium|low\"}. Не выдумывай цитаты: exact_quote обязана быть дословной подстрокой входа. Не делай юридических выводов.";
    const res = await fetch(c.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + c.apiKey },
      body: JSON.stringify({
        model: c.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sys },
          { role: "user", content: "ЖК: " + (zkName || "?") + "\n\nТекст объявления:\n" + text },
        ],
      }),
    });
    if (!res.ok) throw new Error("AI HTTP " + res.status);
    const data = await res.json();
    const raw = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "{}";
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch { throw new Error("AI вернул не-JSON"); }
    const hyps = [];
    if (parsed.payment_offer_detected && typeof parsed.exact_quote === "string" && text.includes(parsed.exact_quote)) {
      hyps.push({
        payment_offer_detected: true, candidate_factor: "R2",
        exact_quote: parsed.exact_quote,
        explanation: parsed.explanation || "", confidence: parsed.confidence || "unknown",
        needs_human_review: true,
      });
    }
    return {
      engine: "real-llm:" + c.model, realAI: true, hypotheses: hyps,
      limitations: parsed.payment_offer_detected && !hyps.length
        ? ["Модель заявила находку, но точная цитата не совпала с текстом — гипотеза отклонена автоматически."]
        : ["LLM-гипотеза, требует подтверждения человеком; на балл не влияет до подтверждения."],
      raw,
    };
  }

  async function analyzeAdText(text, zkName) {
    if (!text || !text.trim()) throw new Error("Пустой текст объявления");
    if (hasRealAI()) return realAnalyze(text, zkName);
    return heuristicAnalyze(text);
  }

  if (typeof window !== "undefined") window.SQ_AI = { analyzeAdText, getConfig, saveConfig, hasRealAI, heuristicAnalyze, PATTERN_SOURCES: PAY_PATTERNS.map((r) => r.source) };
  if (typeof module !== "undefined" && module.exports) module.exports = {};
})();
