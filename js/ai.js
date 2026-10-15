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

  const PAY_PATTERNS = [
    /брон[ьи]/i, /депозит/i, /первоначальн\w*\s+взнос/i, /задато[кч]/i,
    /предоплат/i, /аванс/i, /взнос/i, /рассрочк\w*\s+от\s+застройщика/i,
    /оплат\w*\s+(напрямую|до\s+заключения|до\s+договора)/i,
    /резерв\w*.{0,30}плат/i, /фиксиру\w*.{0,30}цен/i,
  ];

  const NEG_RE = /никак|без |не |нет |отсутств|только по договору|через эскроу/i;

  function heuristicAnalyze(text) {
    const findings = [];
    let negatedOnly = false;
    for (const re of PAY_PATTERNS) {
      const m = text.match(re);
      if (m) {
        const start = Math.max(0, (m.index || 0) - 50);
        const before = text.slice(start, m.index || 0);
        if (NEG_RE.test(before)) { negatedOnly = true; continue; } // «без предоплаты», «никаких взносов» — не находка
        const after = text.slice((m.index || 0) + m[0].length, (m.index || 0) + m[0].length + 30);
        if (/бесплатн|без оплат|(?:^|\D)0\s*тенге/i.test(after)) { negatedOnly = true; continue; } // «бронь бесплатная» — не находка
        const i = Math.max(0, (m.index || 0) - 60);
        const quote = text.slice(i, (m.index || 0) + m[0].length + 80).trim();
        findings.push({
          payment_offer_detected: true,
          candidate_factor: "R2",
          exact_quote: quote,
          explanation: "Эвристика DEMO: найдена формулировка про платёж до/вне договора. Требует проверки человеком.",
          confidence: "low-demo",
          needs_human_review: true,
        });
        break;
      }
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

  if (typeof window !== "undefined") window.SQ_AI = { analyzeAdText, getConfig, saveConfig, hasRealAI, heuristicAnalyze };
  if (typeof module !== "undefined" && module.exports) module.exports = {};
})();
