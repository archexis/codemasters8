/* SAQ QURYLYS — UI layer. State, routing, views, workflow. */
(function () {
  "use strict";
  const { computeScore, FACTOR_META, zoneLabel } = window.SQ_Scoring;
  const LS_STATE = "sq_state_v1";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel, el) => (el || document).querySelector(sel);
  const page = $("#page");

  // ---------- state ----------
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  function loadState() {
    const seed = window.SQ_SEED;
    let s = { complexes: deepClone(seed.COMPLEXES), userAds: [], signals: {}, media: {}, route: { view: "home" } };
    try {
      const raw = JSON.parse(localStorage.getItem(LS_STATE) || "null");
      if (raw) {
        // merge persisted factor statuses + user ads + signals onto fresh seed
        if (raw.factors) for (const zk of s.complexes) {
          if (raw.factors[zk.id]) zk.factors = raw.factors[zk.id];
        }
        if (raw.zkExtra) for (const zk of s.complexes) {
          const x = raw.zkExtra[zk.id];
          if (x) for (const k of ["readinessConfirmed", "readinessSources", "events", "sources"]) if (x[k] !== undefined) zk[k] = x[k];
        }
        if (Array.isArray(raw.userAds)) s.userAds = raw.userAds;
        if (raw.media) s.media = raw.media;
        if (raw.signals) s.signals = raw.signals;
      }
    } catch { /* malformed storage -> fresh seed */ }
    return s;
  }
  function persist() {
    try {
      const factors = {};
      const zkExtra = {};
      for (const zk of state.complexes) {
        factors[zk.id] = zk.factors;
        zkExtra[zk.id] = { readinessConfirmed: zk.readinessConfirmed, readinessSources: zk.readinessSources, events: zk.events, sources: zk.sources };
      }
      localStorage.setItem(LS_STATE, JSON.stringify({ factors, zkExtra, userAds: state.userAds, signals: state.signals, media: state.media }));
    } catch { toast("Хранилище переполнено: решение показано, но не сохранено"); }
  }
  let state = loadState();
  // Кадры площадки: сами файлы живут только в сеансе (objectURL), между
  // перезапусками сохраняются дата, подпись и оценка готовности. Честно.
  const mediaBlobs = {};

  const allAds = () => [...state.userAds, ...window.SQ_SEED.ADS];
  const getZk = (id) => state.complexes.find((z) => z.id === id);
  const adsOf = (zkId) => allAds().filter((a) => a.zkId === zkId);
  const scoreOf = (zk) => computeScore(zk.factors);
  const getSignal = (zkId) => state.signals[zkId] || { status: "draft", history: [] };

  function setSignal(zkId, status, reviewer, comment) {
    const prev = getSignal(zkId);
    const entry = { at: new Date().toISOString(), reviewer: reviewer || "analyst", from: prev.status, to: status, comment: comment || "" };
    state.signals[zkId] = { status, reviewer: entry.reviewer, updatedAt: entry.at, history: [...prev.history, entry] };
    persist();
  }

  // ---------- helpers ----------
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2600);
  }
  function openModal(html) {
    $("#modal-box").innerHTML = html; $("#modal-bg").classList.add("open");
    const f = $("#modal-box input, #modal-box button"); if (f) f.focus();
  }
  function closeModal() { $("#modal-bg").classList.remove("open"); }
  $("#modal-bg").addEventListener("click", (e) => { if (e.target.id === "modal-bg") closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  // Подсветка строится из тех же шаблонов, что и эвристика (единый источник истины).
  const PAY_RE = new RegExp("(" + (window.SQ_AI.PATTERN_SOURCES || ["брон[ьи]"]).join("|") + ")", "gi");
  function highlight(text) {
    return esc(text).replace(PAY_RE, "<mark>$1</mark>");
  }
  const ZONE_KZ = { green: "жасыл", yellow: "сары", red: "қызыл" };
  function zoneChip(zone) { return `<span class="zone ${zone}">${zoneLabel(zone)} <i>· ${ZONE_KZ[zone] || ""}</i></span>`; }
  function statusChip(st) {
    const labels = { confirmed: "подтверждён", hypothesis: "гипотеза ИИ", rejected: "отклонён", "needs-verification": "нужна проверка" };
    return `<span class="st ${esc(st)}">${labels[st] || esc(st)}</span>`;
  }
  // Один чип происхождения вместо DEMO-спама: учебные записи и записи реестра различимы везде.
  function originChip(zk) {
    if (!zk) return "";
    if (zk.origin === "public-snapshot") return `<span class="chip">реестр · Ashyq, 15.10.2026</span>`;
    if (zk.scenario) return `<span class="chip">сценарий ${esc(zk.scenario)}</span>`;
    return `<span class="chip">учебный пример</span>`;
  }
  function legalLabel(lb) {
    if (!lb) return "—";
    if (lb.status === "verified" && lb.type === "guarantee") return "Гарантия Единого оператора · проверено";
    if (lb.status === "verified" && lb.type === "mio-permit") return "Разрешение МИО · проверено";
    if (lb.status === "absent-verified") return "Отсутствие основания · установлено проверкой";
    return "Не проверено · нужна проверка";
  }

  const LS_REVIEWER = "sq_reviewer_v1";
  const LS_SESSION = "sq_session_v1";
  function getSession() {
    try { return JSON.parse(localStorage.getItem(LS_SESSION) || "null") || {}; }
    catch { return {}; }
  }
  function refreshAccount() {
    const b = $("#btn-account"); if (!b) return;
    const s = getSession();
    b.textContent = s.name ? s.name : "Войти";
  }
  function setSession(name) {
    const s = { name, at: new Date().toISOString() };
    localStorage.setItem(LS_SESSION, JSON.stringify(s));
    localStorage.setItem(LS_REVIEWER, name);
    refreshAccount();
    return s;
  }
  function clearSession() { localStorage.removeItem(LS_SESSION); refreshAccount(); }
  function askReviewer(actionLabel, cb) {
    const sess = getSession();
    const last = sess.name || localStorage.getItem(LS_REVIEWER) || "analyst";
    openModal(`<h3>${esc(actionLabel)}</h3>
      <label class="f">Аналитик (фиксируется в журнале)<input type="text" id="m-reviewer" value="${esc(last)}" maxlength="60"></label>
      <label class="f" style="margin-top:8px">Комментарий (необязательно)<input type="text" id="m-comment" maxlength="240" placeholder="основание решения"></label>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="m-ok">Записать</button><button class="btn" id="m-cancel">Отмена</button></div>`);
    $("#m-cancel").onclick = closeModal;
    $("#m-ok").onclick = () => { const r = $("#m-reviewer").value.trim() || "analyst"; const c = $("#m-comment").value.trim(); localStorage.setItem(LS_REVIEWER, r); closeModal(); cb(r, c); };
  }

  // ---------- factor review ----------
  function setFactor(zkId, code, status, reviewer, evidence) {
    const zk = getZk(zkId);
    let f = zk.factors.find((x) => x.code === code);
    if (!f) { f = { code, status, evidence: evidence || {} }; zk.factors.push(f); }
    else { f.status = status; if (evidence) f.evidence = { ...f.evidence, ...evidence }; }
    f.reviewer = reviewer; f.updatedAt = new Date().toISOString();
    persist();
  }

  // ---------- router ----------
  const TITLES = {
    home: ["SAQ QURYLYS", "Главная · начните с проверки объявления"],
    overview: ["Объекты", "Өскемен · учебные сценарии и записи реестра разрешений"],
    detail: ["Карточка ЖК", "история · источники · факторы риска"],
    ads: ["Мониторинг рекламы", "все публикации · подозрительные формулировки подсвечены"],
    analyze: ["Проверка", "вставьте текст — помощник подскажет, решать вам"],
    signal: ["Сигнальная карточка", "факторы · доказательства · статус проверки"],
    registries: ["Открытые реестры РК", "внешние источники · живой интеграции в демо нет"],
  };
  function routeFromHash(h) {
    const m = /^#\/(\w+)(?:\/([\w-]+))?/.exec(String(h || ""));
    if (!m || !TITLES[m[1]]) return null;
    if (m[1] === "detail" || m[1] === "signal") return m[2] ? { view: m[1], zkId: m[2] } : null;
    if (m[1] === "analyze") return m[2] ? { view: m[1], prefill: { zkId: m[2] } } : { view: m[1] };
    return { view: m[1] };
  }
  let suppressHash = false;
  function nav(view, param, push) {
    state.route = { view, ...param };
    document.body.dataset.view = view;
    document.querySelectorAll("#nav button").forEach((b) => b.setAttribute("aria-current", b.dataset.view === view || (((view === "detail" || view === "signal" || view === "ads") && b.dataset.view === "overview")) ? "page" : "false"));
    const t = TITLES[view] || TITLES.overview;
    $("#page-title").textContent = t[0]; $("#page-sub").textContent = t[1];
    window.scrollTo(0, 0);
    if (push !== false) {
      const r = state.route;
      const h = "#/" + r.view + (r.zkId ? "/" + r.zkId : (r.prefill && r.prefill.zkId ? "/" + r.prefill.zkId : ""));
      if (window.location.hash !== h) { suppressHash = true; window.location.hash = h; }
    }
    render();
  }
  window.addEventListener("hashchange", () => {
    if (suppressHash) { suppressHash = false; return; }
    const r = routeFromHash(window.location.hash);
    if (r) nav(r.view, r, false);
  });
  $("#nav").addEventListener("click", (e) => { const b = e.target.closest("button[data-view]"); if (b) nav(b.dataset.view); });

  function render() {
    const r = state.route;
    document.body.dataset.view = r.view;
    try { setSess(false); } catch {}
    updateCounts(); updateAIStatus();
    if (r.view === "home") vHome();
    else if (r.view === "overview") vOverview();
    else if (r.view === "detail") vDetail(r.zkId);
    else if (r.view === "ads") vAds();
    else if (r.view === "analyze") vAnalyze(r.prefill);
    else if (r.view === "signal") vSignal(r.zkId);
    else if (r.view === "registries") vRegistries();
    else vOverview();
    postRender();
  }

  function postRender() {
    try {
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      Array.from(page.children).forEach((el, i) => {
        if (!el.classList) return;
        el.classList.add("rv");
        el.style.animationDelay = reduce ? "0ms" : Math.min(i * 70, 350) + "ms";
      });
      page.querySelectorAll("[data-count]").forEach((el) => {
        const target = parseInt(el.dataset.count, 10) || 0;
        if (reduce) { el.textContent = target; return; }
        const t0 = performance.now(), dur = 850;
        const step = (t) => {
          const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
          el.textContent = Math.round(target * e);
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    } catch (e) { /* animations are decorative */ }
  }

  function updateCounts() {
    const z = $("#cnt-zk"); if (z) z.textContent = state.complexes.length;
    const a = $("#cnt-ads"); if (a) a.textContent = allAds().length;
  }
  function updateAIStatus() {
    const real = window.SQ_AI.hasRealAI();
    const cfg = window.SQ_AI.getConfig();
    $("#ai-status").innerHTML = real
      ? `AI: <span class="engine-badge real">подключён</span> <span style="font-family:var(--mono);font-size:11px">${esc(cfg.model || "")}</span>`
      : `AI: <span class="engine-badge demo">учебный разбор</span>`;
  }

  // ---------- views ----------
  let overviewFilter = { q: "", zone: "all" };

  function donutHtml(counts, total) {
    const C = 2 * Math.PI * 34;
    const segs = [["red", counts.red, "var(--red)"], ["amber", counts.yellow, "var(--sun)"], ["green", counts.green, "var(--green)"]];
    let off = 25;
    const arcs = segs.map(([k, v, col]) => {
      const frac = total ? v / total : 0;
      const s = `<circle cx="45" cy="45" r="34" fill="none" stroke="${col}" stroke-width="13" stroke-dasharray="${(frac * C).toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-off * C / 100).toFixed(1)}" transform="rotate(-90 45 45)"/>`;
      off += frac * 100;
      return s;
    }).join("");
    return `<div style="display:flex;gap:16px;align-items:center"><svg width="90" height="90" viewBox="0 0 90 90" role="img" aria-label="Распределение зон риска">${arcs}<text x="45" y="46" text-anchor="middle" font-size="17" font-weight="800" fill="var(--ink)">${total}</text><text x="45" y="60" text-anchor="middle" font-size="9" fill="var(--ink-2)">ЖК всего</text></svg>
      <div style="font-size:13px;display:grid;gap:6px"><span><span style="color:var(--red)">●</span> Красная — <b>${counts.red}</b></span><span><span style="color:var(--amber)">●</span> Жёлтая — <b>${counts.yellow}</b></span><span><span style="color:var(--green)">●</span> Зелёная — <b>${counts.green}</b></span></div></div>`;
  }
  function alertsHtml() {
    const items = [];
    for (const zk of state.complexes) {
      const sig = getSignal(zk.id);
      for (const h of (sig.history || [])) items.push({ raw: h.at || h.date || "", at: (h.at || "").slice(0, 10), text: `${zk.id}: ${sigLabel(h.from)} → ${h.to === "confirmed" ? "подтверждён" : h.to === "returned" ? "возвращён" : h.to}${h.reviewer ? ` · ${h.reviewer}` : ""}`, dot: h.to === "confirmed" ? "green" : h.to === "returned" ? "amber" : "blue" });
      for (const e of (zk.events || []).slice(-2)) items.push({ raw: e.date || "", at: (e.date || "").slice(0, 10), text: `${zk.id}: ${e.text}`, dot: "blue" });
      for (const f of (zk.factors || []).filter((x) => (x.status === "confirmed" || x.status === "rejected") && x.updatedAt)) items.push({ raw: f.updatedAt || "", at: (f.updatedAt || "").slice(0, 10), text: `${zk.id}: ${f.code} ${f.status === "confirmed" ? "подтверждён" : "отклонён"}${f.reviewer ? ` · ${f.reviewer}` : ""}`, dot: f.status === "confirmed" ? "green" : "amber" });
    }
    items.sort((a, b) => (b.raw < a.raw ? -1 : 1));
    const live = items.filter((i) => !/импортирован/i.test(i.text)); // сид-загрузка — не решение и не событие
    const merged = [];
    for (const i of live) {
      const prev = merged[merged.length - 1];
      if (prev && prev.text === i.text && prev.dot === i.dot) prev.n++;
      else merged.push({ ...i, n: 1 });
    }
    if (!merged.length) return `<div class="empty">Пока тихо — решений и событий нет.</div>`;
    return merged.slice(0, 8).map((i) => `<div class="arow"><time>${esc(i.at || "—")}</time><span class="dot ${i.dot}"></span><span>${esc(i.text)}${i.n > 1 ? ` · ×${i.n}` : ""}</span></div>`).join("");
  }
  function parserEntitiesHtml(p) {
    if (!p) return "";
    const rows = (p.entities || []).slice(0, 12).map((e) => `<tr><td><b>${esc(e.label)}</b></td><td>${esc(e.value)}</td><td><span class="conf ${esc(e.confidence)}">${esc(e.confidence)}</span></td><td class="q">«${esc(e.quote)}»</td></tr>`).join("");
    return `<div style="margin:12px 0 4px"><span class="engine-badge parser">Разбор текста · локальный парсер</span></div>
    <div style="font-size:12.5px;color:var(--ink-2)">Платёжных предложений: <b>${p.payment.flagged ? "найдены" : "не найдены"}</b> · предложений в тексте: ${p.sentences} · сущностей: ${p.entities.length}</div>
    ${rows ? `<table class="parse-table"><tr><th>Тип</th><th>Значение</th><th>Уверенность</th><th>Цитата</th></tr>${rows}</table>` : `<div class="empty">Сущностей не извлечено.</div>`}`;
  }

  function vHome() {
    const counts = { green: 0, yellow: 0, red: 0 };
    for (const zk of state.complexes) counts[scoreOf(zk).zone]++;
    const top = state.complexes.slice().sort((a, b) => scoreOf(b).score - scoreOf(a).score).slice(0, 3);
    const regs = window.SQ_SEED.REGISTRIES || [];
    const snapTop = top[0] ? scoreOf(top[0]) : null;
    const snapHtml = snapTop ? `<aside class="hero-snap" aria-label="Сводка рисков">
        <div class="t">СВОДКА · ${state.complexes.length} ЖК ПОД НАБЛЮДЕНИЕМ</div>
        <div class="rowline"><span class="n" style="color:#ff9d9d">${counts.red}</span><span class="sub">красная зона · приоритет</span></div>
        <div class="rowline"><span class="n" style="color:var(--sun)">${counts.yellow}</span><span class="sub">жёлтая зона · проверка</span></div>
        <div class="rowline"><span class="n" style="color:#8fe6bd">${counts.green}</span><span class="sub">зелёная зона · мониторинг</span></div>
        <div class="rowline"><span class="who">${esc(top[0].name)}</span></div>
        <div class="sub" style="margin:-4px 0 10px">топ-приоритет · ${snapTop.score}/100 · ${zoneLabel(snapTop.zone)} зона</div>
        <button class="btn btn-sun small" data-go="overview">Открыть приоритет</button>
      </aside>` : "";
    const rules = ["R1", "R2", "R3", "R4", "R5", "R6"].map((c) => `<tr><td><b style="font-family:var(--mono)">${c}</b></td><td class="pts">+${FACTOR_META[c].points}</td><td>${esc(FACTOR_META[c].title)}<br><span style="color:var(--ink-2);font-size:12px">${esc(FACTOR_META[c].hint)}</span></td></tr>`).join("");
    page.innerHTML = `
      <div class="hero">
        <div class="orb a"></div><div class="orb b"></div><div class="orb c"></div>
        <div class="hero-grid">
        <div>
        <span class="kicker"><span class="demo-pill">Учебные данные</span> Codemasters 8.0 · Өскемен</span>
        <h1>Риски долевого строительства: объяснимые основания</h1>
        <p class="lead">SAQ QURYLYS собирает объявления, объекты и проверки в одну карточку: парсер находит деньги и сроки дословно, риск считается по фиксированным правилам R1–R6, а решение всегда принимает человек.</p>
        <div class="cta">
          <button class="btn btn-sun" data-go="analyze">Проверить объявление</button>
          <button class="btn btn-glass" data-go="overview">Открыть рабочую панель</button>
        </div>
        </div>
        ${snapHtml}
        </div>
      </div>
      <div class="panel quick" aria-label="Быстрая проверка фразы">
        <div><b>Попробуйте прямо сейчас</b><span>Вставьте фразу из объявления — помощник скажет, есть ли просьба денег, за секунду и без ключей.</span></div>
        <div class="quick-row"><input type="text" id="q-text" maxlength="500" placeholder="например: бронь квартиры — 500 000 тенге в зачёт стоимости" aria-label="Фраза для быстрой проверки"><button class="btn btn-sun" id="q-go">Проверить</button></div>
        <div id="q-out" aria-live="polite"></div>
      </div>
      <div class="anchors" aria-label="Разделы страницы">
        <a href="#l-problem">Проблема</a><a href="#l-how">Как работает</a><a href="#l-rules">Правила R1–R6</a><a href="#l-zones">Зоны</a><a href="#l-cases">Кейсы A·B·C</a><a href="#l-regs">Реестры</a><a href="#l-faq">Вопросы</a>
      </div>
      <div class="stats">
        <div class="panel stat"><div class="n" data-count="${state.complexes.length}">0</div><div class="l">ЖК под наблюдением</div><div class="bar"><i style="width:100%;background:var(--accent)"></i></div></div>
        <div class="panel stat"><div class="n" data-count="${counts.red}" style="color:var(--red)">0</div><div class="l">красная зона · приоритет</div><div class="bar"><i style="width:${state.complexes.length ? Math.round(counts.red / state.complexes.length * 100) : 0}%;background:var(--red)"></i></div></div>
        <div class="panel stat"><div class="n" data-count="${counts.yellow}" style="color:var(--amber)">0</div><div class="l">жёлтая зона · проверка</div><div class="bar"><i style="width:${state.complexes.length ? Math.round(counts.yellow / state.complexes.length * 100) : 0}%;background:var(--sun)"></i></div></div>
        <div class="panel stat"><div class="n" data-count="${allAds().length}">0</div><div class="l">объявлений разобрано</div><div class="bar"><i style="width:100%;background:var(--deep)"></i></div></div>
      </div>
      <div class="grid2">
        <div class="panel" style="padding:16px 18px"><div class="section-t" style="margin-top:0">Распределение зон <small>по текущим данным</small></div>${donutHtml(counts, state.complexes.length)}</div>
        <div class="panel" style="padding:16px 18px"><div class="section-t" style="margin-top:0">Последние изменения <small>журнал решений и события</small></div><div class="alerts">${alertsHtml()}</div></div>
      </div>

      <div class="section-t" id="l-problem">Проблема <small>почему объявлений недостаточно</small></div>
      <div class="kv3">
        <div class="panel"><div class="big">Деньги раньше документов</div><p class="prose">Платная бронь, депозит или «взнос напрямую» в рекламе строящегося дома — повод проверить правовое основание, а не приговор. Система отделяет формулировки от фактов.</p></div>
        <div class="panel"><div class="big">Основание бывает разным</div><p class="prose">В Казахстане законны и гарантия Единого оператора, и разрешение МИО. Отсутствие одного документа не доказывает отсутствие другого — <b>неизвестность не даёт баллов</b>.</p></div>
        <div class="panel"><div class="big">Решение — за человеком</div><p class="prose">AI и парсер выделяют только дословные фрагменты. Фактором риска находка становится <b>после подтверждения аналитиком</b> с источником и датой.</p></div>
      </div>

      <div class="section-t" id="l-how">Как это работает <small>от объявления до решения — за 4 шага</small></div>
      <div class="lgrid">
        <div class="scene" id="scene" aria-label="Схема: от объявления к решению">
          <svg viewBox="0 0 560 320" role="img" aria-hidden="true">
            <path class="draw" d="M60 260 V120 H200 V260 M60 260 H200 M95 120 V260 M130 120 V260 M165 120 V260 M60 160 H200 M60 200 H200 M200 120 L236 92 M236 92 V70 M222 78 L236 70 L248 80"/>
            <g class="fade" id="st2"><line x1="250" y1="104" x2="510" y2="104" stroke="#7fe3b8" stroke-width="2"/><circle cx="290" cy="104" r="6" fill="#ffc531"/><circle cx="380" cy="104" r="6" fill="#7fe3b8"/><circle cx="470" cy="104" r="6" fill="#7aa2ff"/><text x="278" y="88" fill="#cfe9db" font-size="11">объявление</text><text x="362" y="88" fill="#cfe9db" font-size="11">осмотр</text><text x="452" y="88" fill="#cfe9db" font-size="11">акт сверки</text></g>
            <g class="fade" id="st3"><rect x="250" y="130" width="260" height="66" rx="10" fill="rgba(255,255,255,.07)" stroke="#ffc531" stroke-width="1.5"/><text x="264" y="156" fill="#fff" font-size="12.5">«Бронь — 500 000 ₸ в зачёт…»</text><rect x="264" y="166" width="150" height="10" rx="5" fill="#ffc531" opacity=".8"/><text x="264" y="190" fill="#cfe9db" font-size="11">дословный фрагмент, не вывод</text></g>
            <path class="flow" id="fl1" d="M205 190 C228 190 228 163 248 163"/>
            <g class="fade" id="st4"><rect x="250" y="212" width="130" height="52" rx="10" fill="rgba(255,255,255,.07)" stroke="#7fe3b8" stroke-width="1.5"/><text x="262" y="233" fill="#fff" font-size="12">акт сверки</text><text x="262" y="250" fill="#cfe9db" font-size="11">источник · дата</text></g>
            <path class="flow" id="fl2" d="M380 164 V210"/>
            <g class="fade" id="st5"><rect x="398" y="206" width="140" height="64" rx="10" fill="#f2faf5"/><circle cx="414" cy="226" r="7" fill="#d13438"/><text x="428" y="230" fill="#10201b" font-size="13" font-weight="bold">70/100 · Красная</text><text x="414" y="250" fill="#3d4f48" font-size="11">ждёт решения человека</text></g>
            <path class="flow" id="fl3" d="M382 238 H396"/>
            <text x="60" y="286" fill="#9dc2b2" font-size="11">контур объекта · заявленный срок · наблюдение</text>
          </svg>
          <div class="storybar"><span class="ph" id="story-ph">01 / 05</span><span id="story-cap">Контур объекта — фиксируем стройку и заявленный срок.</span><span style="flex:1"></span><button class="btn small btn-glass" id="story-skip">Пропустить</button></div>
        </div>
        <div class="steps" style="grid-template-columns:1fr 1fr;margin:0">
          <div class="panel step"><div class="num">01</div><b>Обзор</b><p>Объекты города с баллом и зоной. Карта — только с реальными координатами.</p></div>
          <div class="panel step"><div class="num">02</div><b>Проверка</b><p>Парсер извлекает деньги, сроки и контакты дословно; гипотезы ждёт человек.</p></div>
          <div class="panel step"><div class="num">03</div><b>Сигнал</b><p>Факторы, цитаты-доказательства, журнал решений и печать отчёта.</p></div>
          <div class="panel step"><div class="num">04</div><b>Решение</b><p>Подтвердить или вернуть. Неизвестность никогда не становится обвинением.</p></div>
        </div>
      </div>

      <div class="section-t" id="l-rules">Правила скоринга R1–R6 <small>строгая версия из ТЗ</small></div>
      <div class="panel" style="padding:6px 14px 12px">
        <table class="rules"><tr><th>Фактор</th><th>Баллы</th><th>Что считается</th></tr>${rules}</table>
        <p class="prose" style="padding:0 4px">Считаются <b>только подтверждённые</b> факторы, итог — не выше 100. Неизвестность даёт <b>0 баллов и пометку «требует проверки»</b>. Гипотезы AI до решения человека на балл не влияют.</p>
      </div>

      <div class="section-t" id="l-zones">Зоны риска <small>цвет — это правило, а не ощущение</small></div>
      <div class="zones3">
        <div class="panel g"><b>Зелёная · 0–24</b><p class="prose">Мониторинг. Пример — кейс C: гарантия подтверждена, обычное объявление, R3 = 10.</p></div>
        <div class="panel y"><b>Жёлтая · 25–59</b><p class="prose">Проверка. Пример — кейс A: платная бронь + реклама, R2 + R3 = 35. Неизвестное основание — не R1.</p></div>
        <div class="panel r"><b>Красная · 60+</b><p class="prose">Только при <b>одновременном R1 и R2</b>. Пример — кейс B: R1 + R2 + R3 = 70, но карточка ждёт человека.</p></div>
      </div>

      <div class="section-t" id="l-cases">Контрольные кейсы A·B·C <small>живые расчёты по текущим данным</small></div>
      <div class="scen" id="home-scen"></div>

      <div class="section-t" id="l-regs">Открытые реестры <small>ручная сверка, результат — в карточку ЖК</small></div>
      <div class="reg-strip">${regs.map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>`).join("")}</div>
      <div class="panel" style="padding:14px 18px;margin-top:10px;font-size:13px;color:var(--ink-2)">
        Живой интеграции с госреестрами здесь нет — сверяйте вручную, результат фиксируйте в карточке с источником и датой. Две ссылки при проверке 15.10.2026 не открылись (кадастровая карта, реестр недобросовестных участников). Учебные записи вымышлены; записи с чипом «реестр» — из открытого набора Ashyq Data.
      </div>

      <div class="section-t" id="l-faq">Частые вопросы <small>честно про ограничения</small></div>
      <div class="panel faq" style="padding:8px 18px 14px">
        <details open><summary>Это юридическое заключение?</summary><p>Нет. SAQ QURYLYS подсвечивает признаки и помогает принять решение, но не устанавливает факт правонарушения и ничего никуда не отправляет автоматически.</p></details>
        <details><summary>Почему платная бронь — это «жёлтый», а не сразу «красный»?</summary><p>Красная зона требует одновременно подтверждённых R1 (основания нет — установлено проверкой) и R2 (деньги просят). Один платёж без проверки основания — жёлтая зона и повод проверить реестры.</p></details>
        <details><summary>Что делает AI, а что — человек?</summary><p>Встроенный помощник и локальный парсер извлекают только дословные фрагменты — ничего настраивать не нужно. Фактором риска находка становится после подтверждения аналитиком с источником и датой.</p></details>
        <details><summary>Откуда данные?</summary><p>Учебные сценарии и объявления к ним вымышлены — у них чип «сценарий» или «учебный пример». Отдельно показаны записи разрешений из открытого набора Ashyq Data (снимок 15.10.2026) с чипом «реестр» — у них нет объявлений и оценок, только номер разрешения и источник.</p></details>
        <details><summary>Нужен ли ключ или настройка для AI?</summary><p>Нет. Встроенный помощник работает сразу: вставьте текст в «Проверке» и нажмите «Запустить анализ». Свой ключ от внешней модели — только по желанию, в блоке «Хочу свою модель — необязательно» под результатом. Ключ хранится только в этом браузере и никогда не коммитится.</p></details>
      </div>

      <div class="panel footer"><b>SAQ QURYLYS · не юридический документ.</b> Скоринг детерминирован: максимум 100, только подтверждённые факторы, неизвестность — 0 и «требует проверки». Исходное ТЗ имеет приоритет над дизайном: визуальные изменения не ослабляют обязательные правила.</div>`;

    page.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => nav(b.dataset.go));
    const qGo = $("#q-go");
    if (qGo) {
      const runQ = () => {
        const t = $("#q-text").value.trim();
        if (!t) { $("#q-out").innerHTML = ""; return; }
        let verdict;
        try {
          const pr = window.SQ_Parser.parseAdText(t);
          verdict = pr.payment.flagged
            ? `<span class="qverdict warn">Похоже на просьбу денег: «${esc(pr.payment.quotes[0])}» — стоит проверить полностью.</span> <button class="btn small" id="q-full">Открыть полную проверку</button>`
            : (pr.channel.flagged
              ? `<span class="qverdict info">Денег не просят, но уводят в мессенджер: «${esc(pr.channel.quotes[0])}» — повод присмотреться.</span>`
              : `<span class="qverdict ok">Прямой просьбы денег не видно. Полную проверку это не заменяет.</span>`);
        } catch { verdict = `<span class="qverdict info">Не разобралось — попробуйте другую фразу.</span>`; }
        $("#q-out").innerHTML = verdict;
        const qf = $("#q-full");
        if (qf) qf.onclick = () => { nav("analyze"); setTimeout(() => { const ta = $("#an-text"); if (ta) { ta.value = t; ta.focus(); } }, 60); };
      };
      qGo.onclick = runQ;
      $("#q-text").addEventListener("keydown", (e) => { if (e.key === "Enter") runQ(); });
    }
    page.querySelectorAll("[data-zk]").forEach((el) => {
      el.onclick = () => nav("detail", { zkId: el.dataset.zk });
      el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") nav("detail", { zkId: el.dataset.zk }); };
    });
    $("#home-scen").innerHTML = SCENARIOS.map((sc) => {
      const zk = getZk(sc.id); const s = scoreOf(zk);
      const ok = s.score === sc.expect.score && s.zone === sc.expect.zone;
      return `<div class="panel scencard"><h4>Кейс ${sc.letter} · ${esc(sc.title)}</h4>
        <div class="calc">Ожидание: ${esc(sc.calc)} → ${sc.expect.score}<br>Сейчас: ${s.score} · ${ok ? `<span class="pass">СОВПАДАЕТ</span>` : `<span class="fail">ОТЛИЧАЕТСЯ</span>`}</div>
        <div class="row"><button class="btn small" data-copen="${sc.id}">Открыть ЖК</button><button class="btn small" data-cgo="analyze">Проверить текст</button></div></div>`;
    }).join("");
    page.querySelectorAll("[data-copen]").forEach((b) => b.onclick = () => nav("detail", { zkId: b.dataset.copen }));
    page.querySelectorAll("[data-cgo]").forEach((b) => b.onclick = () => nav(b.dataset.cgo));

    // First-visit story animation: decorative, skippable, never blocking.
    try {
      const scene = $("#scene");
      const caps = [
        "Контур объекта — фиксируем стройку и заявленный срок.",
        "Шкала наблюдения — события и источники с датами.",
        "Сигналы в тексте — дословные фрагменты, не выводы.",
        "Связка с доказательствами — каждая гипотеза ждёт человека.",
        "Карточка риска — балл только из подтверждённого.",
      ];
      const groups = ["st2", "st3", "st4", "st5"].map((id) => document.getElementById(id));
      const flows = ["fl1", "fl2", "fl3"].map((id) => document.getElementById(id));
      const ph = $("#story-ph"), cap = $("#story-cap");
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const seen = localStorage.getItem("sq_intro_seen") === "1";
      const finish = () => {
        scene.classList.add("play");
        groups.forEach((g) => g && g.classList.add("on"));
        flows.forEach((f) => f && f.classList.add("on"));
        if (ph) ph.textContent = "05 / 05";
        if (cap) cap.textContent = caps[4];
        try { localStorage.setItem("sq_intro_seen", "1"); } catch {}
      };
      const timers = [];
      if (reduce || seen) { finish(); }
      else {
        scene.classList.add("play");
        const steps = [[900, 0, 0], [2000, 1, 0], [3100, 2, 1], [4200, 3, 2]];
        steps.forEach(([t, gi, fi], k) => timers.push(setTimeout(() => {
          if (groups[gi]) groups[gi].classList.add("on");
          if (flows[fi]) flows[fi].classList.add("on");
          if (ph) ph.textContent = "0" + (k + 2) + " / 05";
          if (cap) cap.textContent = caps[k + 1];
          if (k === steps.length - 1) try { localStorage.setItem("sq_intro_seen", "1"); } catch {}
        }, t)));
      }
      $("#story-skip").onclick = () => { timers.forEach(clearTimeout); finish(); };
    } catch (e) { /* story is decorative */ }
  }

  function vOverview() {
    const counts = { green: 0, yellow: 0, red: 0 };
    for (const zk of state.complexes) counts[scoreOf(zk).zone]++;
    const q = overviewFilter.q.trim().toLowerCase();
    let list = state.complexes.filter((zk) => {
      const s = scoreOf(zk);
      if (overviewFilter.zone !== "all" && s.zone !== overviewFilter.zone) return false;
      if (q && !(zk.name + " " + zk.address + " " + zk.developer + " " + zk.id).toLowerCase().includes(q)) return false;
      return true;
    });
    list = list.slice().sort((a, b) => scoreOf(b).score - scoreOf(a).score);

    page.innerHTML = `
      <div class="stats">
        <div class="panel stat"><div class="n">${state.complexes.length}</div><div class="l">объектов под наблюдением</div></div>
        <div class="panel stat"><div class="n" style="color:var(--red)">${counts.red}</div><div class="l">красная зона · приоритет</div></div>
        <div class="panel stat"><div class="n" style="color:var(--amber)">${counts.yellow}</div><div class="l">жёлтая зона · проверка</div></div>
        <div class="panel stat"><div class="n" style="color:var(--green)">${counts.green}</div><div class="l">зелёная зона · мониторинг</div></div>
      </div>
      <div class="mapwrap">
        <div><div id="map" role="img" aria-label="Карта объектов"></div></div>
        <div class="panel mapnote"><b>Карта — только объекты с координатами.</b><br><span style="font-size:12px">Метки: <span style="color:var(--red)">●</span> красная · <span style="color:var(--amber)">●</span> жёлтая · <span style="color:var(--green)">●</span> зелёная зона.<br>Справа вверху — переключатель «Карта / Спутник» (открытые снимки Esri, без ключа). Дату съёмки спутник не сообщает — для выводов о готовности используйте кадры с датой из раздела «Площадка» в карточке ЖК.</span><br><br><span id="map-note-text"></span></div>
      </div>
      <div class="toolbar">
        <input type="text" id="ov-q" class="search" placeholder="Поиск: название, адрес, застройщик…" value="${esc(overviewFilter.q)}" aria-label="Поиск ЖК">
        <div class="seg" role="group" aria-label="Фильтр по зоне">
          ${["all", "red", "yellow", "green"].map((z) => `<button data-z="${z}" aria-pressed="${overviewFilter.zone === z}">${z === "all" ? "Все" : zoneLabel(z)}</button>`).join("")}
        </div>
      </div>
      <div class="panel" id="zk-list">
        ${list.length ? list.map((zk) => {
          const s = scoreOf(zk); const ads = adsOf(zk.id);
          const color = s.zone === "red" ? "var(--red)" : s.zone === "yellow" ? "var(--amber)" : "var(--green)";
          return `<div class="zkrow" data-zk="${zk.id}" tabindex="0" role="link" aria-label="${esc(zk.name)}, ${s.score} баллов, ${zoneLabel(s.zone)} зона">
            <div><div class="nm">${esc(zk.name)} ${originChip(zk)}</div>
              <div class="addr">${esc(zk.address)} · ${esc(zk.stage)}</div>
              <div class="meta">${zk.id} · ${esc(zk.developer)} · объявлений: ${ads.length} · ${esc(legalShort(zk.legalBasis))}</div></div>
            <div class="hide-m"><div class="scorebar" aria-hidden="true"><i style="width:${s.score}%;background:${color}"></i></div>
              <div class="meta" style="margin-top:4px">${s.score} / 100 · подтверждено: ${s.confirmed.join(", ") || "—"}</div></div>
            <div class="hide-m"><span class="meta">сигнал: ${esc(sigLabel(getSignal(zk.id).status))}</span></div>
            <div>${zoneChip(s.zone)}</div>
          </div>`;
        }).join("") : `<div class="empty">Ничего не найдено. Измените запрос или фильтр.</div>`}
      </div>`;

    let ovTimer = null;
    $("#ov-q").addEventListener("input", (e) => {
      overviewFilter.q = e.target.value;
      const v = e.target.value, pos = e.target.selectionStart;
      clearTimeout(ovTimer);
      ovTimer = setTimeout(() => { render(); const el = $("#ov-q"); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch {} } }, 220);
    });
    page.querySelectorAll(".seg button").forEach((b) => b.onclick = () => { overviewFilter.zone = b.dataset.z; render(); });
    page.querySelectorAll(".zkrow").forEach((el) => {
      el.onclick = () => nav("detail", { zkId: el.dataset.zk });
      el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") nav("detail", { zkId: el.dataset.zk }); };
    });
    initMap(list);
  }

  function legalShort(lb) {
    if (!lb) return "основание: —";
    if (lb.status === "verified") return `основание: ${lb.type === "guarantee" ? "гарантия ✓" : lb.type === "mio-permit" ? "разрешение МИО ✓" : "проверено ✓"}`;
    if (lb.status === "absent-verified") return "основание: отсутствует ✕";
    return "основание: не проверено …";
  }
  function confLabel(c) {
    return { high: "высокая", medium: "средняя", low: "низкая", "low-demo": "низкая (учебный разбор)", unknown: "неизвестно" }[c] || c;
  }
  function sigLabel(st) {
    return { draft: "черновик", pending: "на проверке", confirmed: "подтверждён", returned: "возвращён" }[st] || st;
  }

  let mapInstance = null;
  function initMap(list) {
    const withCoords = list.filter((z) => typeof z.lat === "number" && typeof z.lng === "number");
    const missing = list.length - withCoords.length;
    $("#map-note-text").textContent = missing > 0
      ? `Показано меток: ${withCoords.length} из ${list.length}. Без координат (${missing}) на карту не ставятся — это честное поведение, а не ошибка.`
      : `Показано меток: ${withCoords.length} из ${list.length}.`;
    if (typeof L === "undefined") { $("#map").innerHTML = `<div class="empty">Карта недоступна офлайн (CDN Leaflet не загрузился). Список выше — полный.</div>`; return; }
    if (mapInstance) { mapInstance.remove(); mapInstance = null; } // повторный рендер (поиск/фильтр) — без «already initialized»
    const map = L.map("map").setView([49.984, 82.614], 12);
    mapInstance = map;
    const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" });
    const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Esri World Imagery" });
    osm.addTo(map);
    L.control.layers({ "Карта": osm, "Спутник": sat }, null, { position: "topright" }).addTo(map);
    const bounds = [];
    const layer = (L.markerClusterGroup ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 48 }) : L.layerGroup()).addTo(map);
    for (const zk of withCoords) {
      const s = scoreOf(zk);
      const icon = L.divIcon({ className: "", html: `<span class="pin ${s.zone}"></span>`, iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -10] });
      const m = L.marker([zk.lat, zk.lng], { icon });
      m.bindPopup(`<b>${esc(zk.name)}</b><br>${s.score} баллов · ${esc(zoneLabel(s.zone))}`);
      m.on("click", () => nav("detail", { zkId: zk.id }));
      layer.addLayer(m);
      bounds.push([zk.lat, zk.lng]);
    }
    if (bounds.length > 1) map.fitBounds(bounds, { padding: [24, 24] });
    else if (bounds.length === 1) map.setView(bounds[0], 13);
  }

  function vDetail(zkId) {
    const zk = getZk(zkId);
    if (!zk) { page.innerHTML = `<div class="panel empty">Объект не найден. <button class="btn" onclick="document.querySelector('#nav button').click()">К обзору</button></div>`; return; }
    const s = scoreOf(zk);
    const ads = adsOf(zkId);
    const sig = getSignal(zkId);
    const media = (state.media && state.media[zkId]) || [];
    const color = s.zone === "red" ? "var(--red)" : s.zone === "yellow" ? "var(--amber)" : "var(--green)";
    const codes = ["R1", "R2", "R3", "R4", "R5", "R6"];
    const byCode = Object.fromEntries(zk.factors.map((f) => [f.code, f]));

    page.innerHTML = `
      <div class="row no-print" style="margin-bottom:12px">
        <button class="btn small" id="d-back">← К обзору</button>
        <button class="btn small primary" id="d-signal">Сигнальная карточка</button>
        <button class="btn small" id="d-analyze">+ Анализ объявления</button>
      </div>
      <div class="detail-head">
        <div class="panel">
          <div style="padding:16px 18px 0"><h3 style="font-family:var(--serif);margin:0;font-size:22px">${esc(zk.name)} ${originChip(zk)}</h3>
          <div style="color:var(--ink-2);font-size:13px">${esc(zk.city)} · ${esc(zk.address)}${zk.geoApprox ? ` <span class="chip">координаты приблизительные</span>` : ""}</div></div>
          <dl class="kv">
            <dt>Застройщик / БИН</dt><dd>${esc(zk.developer)}${zk.bin ? ` · <span style="font-family:var(--mono)">${esc(zk.bin)}</span>` : ""} ${zk.origin === "public-snapshot" ? `<span class="chip">наименование из реестра</span>` : `<span class="chip">учебный пример</span>`}</dd>
            <dt>Этап строительства</dt><dd>${esc(zk.stage)}</dd>
            <dt>Готовность</dt><dd>заявлено ${zk.readinessClaimed ?? "—"}% · подтверждено ${zk.readinessConfirmed ?? "—"}%
              <span class="rbar" aria-hidden="true"><i class="claim" style="width:${zk.readinessClaimed || 0}%"></i><i class="conf" style="width:${zk.readinessConfirmed || 0}%"></i></span>
              <span style="font-size:11.5px;color:var(--ink-3)">серая — заявлено · зелёная — подтверждено</span></dd>
            <dt>Правовое основание</dt><dd><b>${esc(legalLabel(zk.legalBasis))}</b><br><span style="font-size:12.5px;color:var(--ink-2)">${esc(zk.legalBasis.source)} · ${esc(zk.legalBasis.checkedAt)}</span></dd>
            <dt>Заметка аналитика</dt><dd>${esc(zk.note || "—")}</dd>
          </dl>
        </div>
        <div class="panel" style="padding:16px 18px">
          <div class="section-t" style="margin-top:0">Риск-балл · только подтверждённое</div>
          <div class="score-num">${s.score}<span style="font-size:16px;color:var(--ink-3)">/100</span></div>
          <div style="margin:8px 0">${zoneChip(s.zone)}</div>
          <div class="scorebar"><i style="width:${s.score}%;background:${color}"></i></div>
          <div style="font-size:12.5px;color:var(--ink-2);margin-top:8px">Подтверждено: ${s.confirmed.join(" · ") || "—"}${s.pending.length ? `<br>Ожидают решения: ${s.pending.join(" · ")} (на балл не влияют)` : ""}</div>
          <div style="margin-top:10px;font-size:12.5px">Сигнал: <b>${esc(sigLabel(sig.status))}</b></div>
        </div>
      </div>

      <div class="section-t">Факторы риска · R1–R6</div>
      <div class="panel">
        ${codes.map((code) => {
          const m = FACTOR_META[code]; const f = byCode[code];
          const st = f ? f.status : "needs-verification";
          const ev = f && f.evidence;
          return `<div class="factor" id="f-${code}">
            <div class="fh"><span class="code">${code}</span><span class="pts">+${m.points}</span>
              <b>${esc(m.title)}</b> ${statusChip(st)}</div>
            <div style="font-size:12.5px;color:var(--ink-2)">${esc(m.hint)}</div>
            ${ev ? `<div class="ev">${ev.quote ? `<q>${esc(ev.quote)}</q><br>` : ""}<span class="src">Источник: ${esc(ev.source || "—")}${ev.adId ? ` · <a href="#" data-ad="${ev.adId}">${esc(ev.adId)}</a>` : ""}${ev.date ? ` · ${esc(ev.date)}` : ""}${f.reviewer ? ` · проверил: ${esc(f.reviewer)} · ${esc((f.updatedAt || "").slice(0, 16).replace("T", " "))}` : ""}</span></div>`
              : `<div style="font-size:12.5px;color:var(--ink-3);margin-top:4px">Доказательств нет — 0 баллов, пометка «нужна проверка».</div>`}
            <div class="row no-print" style="margin-top:8px">
              ${st === "hypothesis" ? `<button class="btn small primary" data-confirm="${code}">Подтвердить</button><button class="btn small danger" data-reject="${code}">Отклонить</button>` : ""}
              ${st === "needs-verification" ? `<button class="btn small" data-confirm="${code}">Подтвердить вручную</button>` : ""}
              ${st === "confirmed" ? `<button class="btn small" data-unconfirm="${code}">Снять подтверждение</button>` : ""}
              ${st === "rejected" ? `<button class="btn small" data-confirm="${code}">Пересмотреть</button>` : ""}
            </div>
          </div>`;
        }).join("")}
      </div>

      <div class="section-t">Связанные объявления · ${ads.length}</div>
      <div class="panel">
        ${ads.length ? ads.map((a) => `
          <div class="factor"><div class="fh"><b>${esc(a.id)}</b> <span class="chip">${esc(a.platform)}</span> <span class="chip">${esc(a.account)}</span> <span class="chip">${esc(a.date)}</span> ${a.userAdded ? `<span class="chip">добавлено аналитиком</span>` : `<span class="chip">снимок</span>`}</div>
          <div class="adtext" style="margin-top:6px">${highlight(a.text)}</div>
          <div class="src-link"><a href="${esc(a.url)}" target="_blank" rel="noopener">Источник</a> · снято ${esc(a.captureAt)}</div></div>`).join("")
          : `<div class="empty">Объявлений пока нет. Добавьте первое через «Новый анализ».</div>`}
      </div>

      <div class="section-t">Площадка: фото и видео <small>кадры с дрона, осмотр, спутник — с датой</small></div>
      <div class="panel" style="padding:14px 18px">
        <p class="pane-hint">Загрузите кадры с дрона или фото осмотра: укажите дату съёмки и что видно. По дате кадра можно зафиксировать подтверждённую готовность — при разрыве с заявленной от 20 п.п. система предложит гипотезу R5, решение — за вами. Сами файлы видны только в этом сеансе, дата и подпись сохраняются.</p>
        <div class="gallery" id="d-gallery">${media.length ? media.map((m, i) => {
          const blob = (mediaBlobs[zkId] || [])[i];
          const inner = blob ? (m.kind.indexOf("video") === 0 ? `<video src="${blob}" controls preload="metadata"></video>` : `<img src="${blob}" alt="${esc(m.note || "Кадр площадки")}" loading="lazy">`) : `<div class="file-lost">Файл сеанса закрыт — остались дата и подпись</div>`;
          return `<figure>${inner}<figcaption><b>${esc(m.date || "—")}</b> · ${esc(m.note || "без подписи")}${m.ready != null && m.ready !== "" ? ` · вижу ${esc(String(m.ready))}%` : ""}</figcaption></figure>`;
        }).join("") : `<div class="empty">Кадров пока нет. Первый кадр — ниже.</div>`}</div>
        <div class="media-form">
          <label class="f">Файл (фото/видео)<input type="file" id="d-file" accept="image/*,video/*"></label>
          <label class="f">Дата съёмки<input type="date" id="d-date" value="2026-10-15"></label>
          <label class="f">Что видно<input type="text" id="d-note" maxlength="140" placeholder="например, 7 этажей из 12, крана нет"></label>
          <label class="f">Видимая готовность, %<input type="number" id="d-ready" min="0" max="100" placeholder="—"></label>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn small primary" id="d-add-frame">Добавить кадр</button>
          <button class="btn small" id="d-fix-ready">Зафиксировать подтверждённую готовность</button>
        </div>
      </div>

      <div class="grid2">
        <div><div class="section-t">События</div><div class="panel timeline">
          ${(zk.events || []).map((e) => `<div><time>${esc(e.date)}</time><span>${esc(e.text)}</span></div>`).join("") || `<div class="empty">Нет событий.</div>`}
        </div></div>
        <div><div class="section-t">Источники и фиксация</div><div class="panel timeline">
          ${(zk.sources || []).map((e) => `<div><time>${esc(e.date)}</time><span>${esc(e.title)}</span></div>`).join("") || `<div class="empty">Нет источников.</div>`}
        </div></div>
      </div>
      <div class="section-t">Хронология риска <small>события и решения по датам</small></div>
      <div class="panel" style="padding:14px 18px"><div class="tline">${tlineHtml(zk, sig)}</div></div>`;

    $("#d-back").onclick = () => nav("overview");
    $("#d-signal").onclick = () => nav("signal", { zkId });
    $("#d-analyze").onclick = () => nav("analyze", { prefill: { zkId } });
    page.querySelectorAll("[data-confirm]").forEach((b) => b.onclick = () => askReviewer(`Подтвердить ${b.dataset.confirm} — ${zk.name}`, (r, c) => {
      setFactor(zkId, b.dataset.confirm, "confirmed", r + (c ? " · " + c : "")); toast(`${b.dataset.confirm} подтверждён, балл пересчитан`); render();
    }));
    page.querySelectorAll("[data-reject]").forEach((b) => b.onclick = () => askReviewer(`Отклонить гипотезу ${b.dataset.reject}`, (r, c) => {
      setFactor(zkId, b.dataset.reject, "rejected", r + (c ? " · " + c : "")); toast(`${b.dataset.reject} отклонён`); render();
    }));
    page.querySelectorAll("[data-unconfirm]").forEach((b) => b.onclick = () => askReviewer(`Снять подтверждение ${b.dataset.unconfirm}`, (r, c) => {
      setFactor(zkId, b.dataset.unconfirm, "needs-verification", r + (c ? " · " + c : "")); toast(`${b.dataset.unconfirm} возвращён на проверку`); render();
    }));
    page.querySelectorAll("[data-ad]").forEach((a) => a.onclick = (e) => { e.preventDefault(); nav("ads"); });
    $("#d-add-frame").onclick = () => {
      const f = $("#d-file").files && $("#d-file").files[0];
      if (!f) { toast("Выберите файл кадра"); return; }
      const item = { date: $("#d-date").value || new Date().toISOString().slice(0, 10), note: $("#d-note").value.trim(), ready: $("#d-ready").value === "" ? null : Math.max(0, Math.min(100, +$("#d-ready").value)), kind: f.type || "image/*", name: f.name };
      if (!state.media[zkId]) state.media[zkId] = [];
      state.media[zkId].push(item);
      if (!mediaBlobs[zkId]) mediaBlobs[zkId] = [];
      mediaBlobs[zkId].push(URL.createObjectURL(f));
      persist(); toast("Кадр добавлен"); render();
    };
    $("#d-fix-ready").onclick = () => askReviewer("Зафиксировать подтверждённую готовность", (r, c) => {
      const v = $("#d-ready").value === "" ? null : Math.max(0, Math.min(100, +$("#d-ready").value));
      if (v == null) { toast("Укажите видимую готовность в %"); return; }
      const date = $("#d-date").value || new Date().toISOString().slice(0, 10);
      const note = $("#d-note").value.trim() || "кадр площадки";
      zk.readinessConfirmed = v;
      zk.readinessSources = [...(zk.readinessSources || []), { value: v, source: "Кадр площадки: " + note, date }];
      zk.events = [...(zk.events || []), { date, text: "Зафиксирована подтверждённая готовность " + v + "% по кадру (" + note + ")." }];
      const claimed = zk.readinessClaimed;
      if (claimed != null && Math.abs(claimed - v) >= 20) {
        setFactor(zkId, "R5", "hypothesis", r + (c ? " · " + c : ""), { quote: "Заявлено " + claimed + "%, по кадру " + v + "% (" + date + ")", source: "Кадр площадки от " + date });
        toast("Разрыв ≥20 п.п. — создана гипотеза R5, подтвердите её во вкладке факторов");
      } else toast("Готовность " + v + "% зафиксирована");
      persist(); render();
    });
  }

  let adsPlatform = "all";
  function vAds() {
    const ads = allAds();
    const plats = [...new Set(ads.map((a) => window.SQ_Parser.detectPlatform({ url: a.url, platform: a.platform, text: "" }).label))].sort();
    const shown = ads.filter((a) => adsPlatform === "all" || window.SQ_Parser.detectPlatform({ url: a.url, platform: a.platform, text: "" }).label === adsPlatform);
    page.innerHTML = `
      <div class="toolbar"><span style="font-size:13px;color:var(--ink-2)">Всего публикаций: <b>${ads.length}</b> · жёлтая подсветка — потенциально платёжные формулировки (подсказка, не вердикт)</span>
      <span style="flex:1"></span><button class="btn primary small" id="ads-new">+ Новое объявление</button></div>
      <div class="seg" role="group" aria-label="Фильтр по площадке" style="margin-bottom:10px">
        <button data-p="all" aria-pressed="${adsPlatform === "all"}">Все площадки</button>${plats.map((p) => `<button data-p="${esc(p)}" aria-pressed="${adsPlatform === p}">${esc(p)}</button>`).join("")}
      </div>
      <div class="panel">${shown.map((a) => {
        const zk = getZk(a.zkId);
        const rel = window.SQ_Parser.relatedAds(a, ads).slice(0, 3);
        return `<div class="factor"><div class="fh"><b>${esc(a.id)}</b> <span class="chip">${esc(a.platform)}</span> <span class="chip">${esc(a.account)}</span> <span class="chip">${esc(a.date)}</span>
          → <a href="#" data-zk="${esc(a.zkId)}">${esc(zk ? zk.name : a.zkId)}</a></div>
          <div class="adtext" style="margin-top:6px">${highlight(a.text)}</div>
          ${rel.length ? `<div style="font-size:12px;color:var(--ink-2);margin-top:4px">Связано: ${rel.map((x) => `<b>${esc(x.id)}</b> (${esc(x.via)})`).join(" · ")}</div>` : ""}
          <div class="src-link"><a href="${esc(a.url)}" target="_blank" rel="noopener">Источник</a> · снято ${esc(a.captureAt)}</div></div>`;
      }).join("") || `<div class="empty">На этой площадке публикаций нет.</div>`}</div>`;
    $("#ads-new").onclick = () => nav("analyze");
    page.querySelectorAll(".seg button").forEach((b) => b.onclick = () => { adsPlatform = b.dataset.p; render(); });
    page.querySelectorAll("[data-zk]").forEach((x) => x.onclick = (e) => { e.preventDefault(); nav("detail", { zkId: x.dataset.zk }); });
  }

  function vAnalyze(prefill) {
    const opts = state.complexes.map((z) => `<option value="${z.id}" ${prefill && prefill.zkId === z.id ? "selected" : ""}>${esc(z.name)} · ${z.id}</option>`).join("");
    page.innerHTML = `
      <div class="grid2">
        <div class="panel" style="padding:16px 18px">
          <h3 class="block" style="padding:0 0 8px">Шаг 1 · Откуда объявление</h3>
          <div class="steps-mini" aria-label="Шаги проверки"><span class="on">1 · Источник</span><span>2 · Проверка</span><span>3 · Решение</span></div>
          <div class="src-tabs" role="tablist" aria-label="Способ ввода">
            <button class="on" data-src="text" role="tab" aria-selected="true">Вставить текст</button>
            <button data-src="web" role="tab" aria-selected="false">Из сети и соцсетей</button>
            <button data-src="shot" role="tab" aria-selected="false">Скриншот</button>
          </div>
          <div data-pane="text">
            <p class="pane-hint">Скопируйте текст объявления куда угодно и вставьте в поле ниже. Дальше помощник сам найдёт деньги, сроки и контакты.</p>
            <div class="preset-grid">
              <button class="preset" data-preset="SQ-001"><b>Кейс A · платная бронь</b><span>основание не проверено → ?</span></button>
              <button class="preset" data-preset="SQ-002"><b>Кейс B · депозит</b><span>основания нет → ?</span></button>
              <button class="preset" data-preset="SQ-003"><b>Кейс C · гарантия</b><span>чистое объявление → ?</span></button>
            </div>
          </div>
          <div data-pane="web" hidden>
            <p class="pane-hint">Прямой забор страниц из браузера невозможен: площадки не отдают тексты посторонним сайтам, а мессенджеры закрыты авторизацией. Поэтому так: откройте объявление, скопируйте текст, вставьте ниже. Ссылка и время снятия сохранятся как доказательство.</p>
            <div class="chip-pick" id="an-pick" aria-label="Быстрый выбор площадки"></div>
            <div style="display:grid;gap:10px;margin-top:10px">
              <label class="f">Несколько объявлений сразу (CSV из Excel)<textarea id="an-csv" rows="3" maxlength="20000" placeholder="текст;площадка;аккаунт;дата;ссылка"></textarea></label>
              <div class="row"><button class="btn small" id="an-csv-go">Разобрать список</button><button class="btn small" id="an-src-open">Открыть источник</button></div>
              <div id="an-csv-prev"></div>
            </div>
          </div>
          <div data-pane="shot" hidden>
            <p class="pane-hint">Приложите снимок экрана — он сохранится рядом с проверкой как иллюстрация. Автораспознавания текста в демо нет: перепечатайте или вставьте текст в поле ниже.</p>
            <label class="f">Файл снимка<input type="file" id="an-shot" accept="image/*"></label>
            <div id="an-shot-prev"></div>
          </div>
          <div style="display:grid;gap:10px;margin-top:10px">
            <label class="f">Связанный ЖК<select id="an-zk">${opts}</select></label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <label class="f">Площадка<input type="text" id="an-platform" list="an-platforms" value="Krisha" maxlength="80"></label>
              <label class="f">Аккаунт<input type="text" id="an-account" value="@analyst_inbox" maxlength="80"></label>
            </div>
            <datalist id="an-platforms"><option value="Krisha.kz"></option><option value="OLX"></option><option value="Instagram"></option><option value="TikTok"></option><option value="Telegram"></option><option value="WhatsApp"></option><option value="Сайт застройщика"></option></datalist>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <label class="f">Дата публикации<input type="date" id="an-date" value="2026-10-15"></label>
              <label class="f">Ссылка<input type="url" id="an-url" value="https://example.invalid/new" maxlength="300"></label>
            </div>
            <div id="an-autoplat" style="font-size:12.5px;color:var(--ink-2)"></div>
            <label class="f">Текст объявления<textarea id="an-text" rows="8" maxlength="4000" placeholder="Вставьте текст объявления…"></textarea></label>
            <div class="row">
              <button class="btn primary" id="an-run">Запустить анализ</button>
              <button class="btn" id="an-fill">Вставить пример</button>
            </div>
            <div style="font-size:12px;color:var(--ink-2);margin-top:6px">Пресеты — во вкладке «Вставить текст». Живые расчёты A·B·C — ниже.</div>
          </div>
        </div>
        <div class="panel" style="padding:16px 18px" id="an-result">
          <h3 class="block" style="padding:0 0 8px">Шаг 2 · Что нашёл помощник</h3>
          <div class="empty">Здесь появятся разбор парсера и гипотезы с точными цитатами.<br><br>Как получить результат:<br>1 — вставьте текст слева и нажмите «Запустить анализ»;<br>2 — прочитайте гипотезы с цитатами;<br>3 — подтвердите или отклоните каждую.<br><br>Ничего не влияет на балл, пока человек не подтвердит.</div>
        </div>
      </div>
      <div class="section-t">Живые расчёты A·B·C <small>по текущим данным</small></div>
      <p style="font-size:12.5px;color:var(--ink-2);margin:0 2px 8px">Обозначения: <b>R1</b> — нет основания, установлено проверкой (+35) · <b>R2</b> — просят деньги (+25) · <b>R3</b> — реклама стройки (+10). Подробно — на главной в «Правилах скоринга».</p>
      <div class="scen" id="check-scen"></div>
      <div class="section-t">Открытые реестры <small>ручная сверка, результат — в карточку ЖК</small></div>
      <div class="reg-strip" id="check-regs"></div>`;
    $("#an-fill").onclick = () => { $("#an-text").value = "Срочно! Продажа квартир в строящемся доме, сдача в 2027. Первоначальный взнос 1 500 000 тенге напрямую застройщику, остаток в рассрочку. Торопитесь, этажи разбирают!"; };
    page.querySelectorAll("[data-preset]").forEach((b) => b.onclick = () => {
      const id = b.dataset.preset;
      $("#an-zk").value = id;
      $("#an-text").value = DEMO_TEXTS[id] || "";
      $("#an-text").focus();
      toast("Пресет подставлен — жмите «Запустить анализ»");
    });
    $("#check-scen").innerHTML = SCENARIOS.map((sc) => {
      const zk = getZk(sc.id); const s = scoreOf(zk);
      const ok = s.score === sc.expect.score && s.zone === sc.expect.zone;
      return `<div class="panel scencard"><h4>Кейс ${sc.letter} · ${esc(sc.title)}</h4>
        <div class="calc">Ожидание: ${esc(sc.calc)} → ${sc.expect.score}<br>Сейчас: ${s.score} · ${ok ? `<span class="pass">СОВПАДАЕТ</span>` : `<span class="fail">ОТЛИЧАЕТСЯ</span>`}</div>
        <div class="row"><button class="btn small" data-copen="${sc.id}">Открыть ЖК</button></div></div>`;
    }).join("");
    page.querySelectorAll("[data-copen]").forEach((b) => b.onclick = () => nav("detail", { zkId: b.dataset.copen }));
    $("#check-regs").innerHTML = (window.SQ_SEED.REGISTRIES || []).map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>`).join("");
    // Вкладки источника
    page.querySelectorAll(".src-tabs button").forEach((b) => b.onclick = () => {
      page.querySelectorAll(".src-tabs button").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", x === b ? "true" : "false"); });
      page.querySelectorAll("[data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.src; });
    });
    // Быстрый выбор площадки
    const PLAT_PICK = ["Krisha.kz", "OLX", "Instagram", "TikTok", "Telegram", "WhatsApp", "Сайт застройщика"];
    $("#an-pick").innerHTML = PLAT_PICK.map((p) => `<button class="pick" data-p="${esc(p)}">${esc(p)}</button>`).join("");
    page.querySelectorAll("#an-pick .pick").forEach((b) => b.onclick = () => { $("#an-platform").value = b.dataset.p; toast("Площадка: " + b.dataset.p); });
    // Автоопределение площадки по ссылке
    const autoplat = () => {
      try {
        const d = window.SQ_Parser.detectPlatform({ url: $("#an-url").value, platform: $("#an-platform").value, text: "" });
        if (d.via === "url") {
          $("#an-platform").value = d.label;
          $("#an-autoplat").textContent = "По ссылке похоже на: " + d.label + ". Проверьте и поправьте при нужде.";
        } else $("#an-autoplat").textContent = "";
      } catch {}
    };
    $("#an-url").addEventListener("change", autoplat);
    $("#an-src-open").onclick = () => {
      const u = $("#an-url").value.trim();
      if (!u || u.indexOf("example.invalid") >= 0) { toast("Сначала вставьте настоящую ссылку"); return; }
      window.open(u, "_blank", "noopener");
    };
    // Скриншот: превью в сеансе
    $("#an-shot").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const url = URL.createObjectURL(f);
      $("#an-shot-prev").innerHTML = `<img src="${url}" alt="Снимок объявления" style="max-width:100%;border-radius:10px;border:1px solid var(--line);margin-top:8px">`;
    });
    // CSV-импорт: предпросмотр, каждая строка — в проверку по клику
    $("#an-csv-go").onclick = () => {
      const box = $("#an-csv-prev");
      let parsed;
      try { parsed = window.SQ_Parser.parseCsvAds($("#an-csv").value); }
      catch (err) { box.innerHTML = `<div class="empty">Не разобралось: ${esc(err.message)}</div>`; return; }
      const keys = new Set(allAds().map((a) => window.SQ_Parser.dedupeKey(a)));
      box.innerHTML = (parsed.errors.length ? `<div class="empty">${parsed.errors.map(esc).join("<br>")}</div>` : "")
        + parsed.rows.slice(0, 20).map((row, i) => {
          let flag = "";
          try {
            const pr = window.SQ_Parser.parseAdText(row.text);
            flag = pr.payment.flagged ? " · <b>есть просьба денег</b>" : (pr.channel.flagged ? " · увод в мессенджер" : " · чисто");
          } catch {}
          const dup = keys.has(window.SQ_Parser.dedupeKey(row));
          return `<div class="csvrow"><span>${esc(row.text.slice(0, 90))}…${flag}${dup ? " · <b>похоже на дубль</b>" : ""}</span><button class="btn small" data-csv="${i}">В проверку</button></div>`;
        }).join("")
        + (parsed.rows.length > 20 ? `<div class="empty">Показаны первые 20 из ${parsed.rows.length}.</div>` : "");
      box.querySelectorAll("[data-csv]").forEach((b) => b.onclick = () => {
        const row = parsed.rows[+b.dataset.csv];
        $("#an-text").value = row.text;
        if (row.platform) $("#an-platform").value = row.platform;
        if (row.account) $("#an-account").value = row.account;
        if (row.date) $("#an-date").value = row.date;
        if (row.url) $("#an-url").value = row.url;
        autoplat();
        toast("Строка подставлена — жмите «Запустить анализ»");
      });
    };
    $("#an-run").onclick = async () => {
      const runBtn = $("#an-run");
      if (runBtn.disabled) return;
      const text = $("#an-text").value;
      const zkId = $("#an-zk").value;
      const zk = getZk(zkId);
      if (!text.trim()) { toast("Вставьте текст объявления"); return; }
      runBtn.disabled = true;
      try {
      $("#an-result").innerHTML = `<h3 class="block" style="padding:0 0 8px">Шаг 2 · Что нашёл помощник</h3>
        <div><span class="engine-badge parser">Разбор текста…</span></div>
        <div class="loading-line"></div><div class="loading-line" style="width:72%"></div><div class="loading-line" style="width:48%"></div>`;
      let parsed = null;
      try { parsed = window.SQ_Parser.parseAdText(text); }
      catch (err) { $("#an-result").innerHTML += `<div class="empty">Парсер: ${esc(err.message)}</div>`; return; }
      let res;
      try { res = await window.SQ_AI.analyzeAdText(text, zk.name); }
      catch (err) { $("#an-result").innerHTML += `<div class="empty">Ошибка: ${esc(err.message)}</div>`; return; }
      const badge = res.realAI ? `<span class="engine-badge real">Смотрит ваша модель · ${esc(res.engine)}</span>` : `<span class="engine-badge demo">Смотрит встроенный помощник — работает сразу, без ключей</span>`;
      const hyps = res.hypotheses.length ? res.hypotheses.map((h, i) => `
        <div class="hyp"><b>Гипотеза ${i + 1} → кандидат ${esc(h.candidate_factor || "—")}</b> ${statusChip("hypothesis")}
          <span class="q">«${esc(h.exact_quote)}»</span>
          <div style="font-size:13px">${esc(h.explanation)}</div>
          <div style="font-size:12px;color:var(--ink-2)">уверенность: ${esc(confLabel(h.confidence))} · требует решения человека</div>
          <div class="row" style="margin-top:8px">
            <button class="btn small primary" data-hok="${i}">Подтвердить как ${esc(h.candidate_factor)}</button>
            <button class="btn small danger" data-hno="${i}">Отклонить</button>
          </div></div>`).join("")
        : `<div class="empty">Прямых предложений внести деньги не найдено.<br>Объявление можно сохранить как обычное (кандидат R3 — на усмотрение аналитика).</div>`;
      $("#an-result").innerHTML = `<h3 class="block" style="padding:0 0 8px">Шаг 2 · Что нашёл помощник</h3>
        <div style="margin-bottom:8px">${badge}</div>
        ${parserEntitiesHtml(parsed)}
        <div class="section-t">Гипотезы <small>только после решения человека влияют на балл</small></div>${hyps}
        <div class="section-t">Ограничения</div>
        <ul style="font-size:12.5px;color:var(--ink-2)">${res.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
        <details class="byok"><summary>Хочу свою модель — необязательно</summary>
          <p>По умолчанию всё уже работает. Свой ключ нужен, только если хотите, чтобы текст смотрела внешняя языковая модель вместо встроенного помощника. Ключ живёт только в этом браузере.</p>
          <label class="f">Адрес сервиса<input type="text" id="an-ai-endpoint" value="${esc((window.SQ_AI.getConfig().endpoint) || "https://openrouter.ai/api/v1/chat/completions")}"></label>
          <label class="f" style="margin-top:8px">Модель<input type="text" id="an-ai-model" value="${esc(window.SQ_AI.getConfig().model || "")}" placeholder="например, vendor/model-name"></label>
          <label class="f" style="margin-top:8px">Ключ<input type="password" id="an-ai-key" placeholder="вставьте ключ" autocomplete="off"></label>
          <div class="row" style="margin-top:10px"><button class="btn small primary" id="an-ai-save">Запомнить</button><button class="btn small" id="an-ai-off">Вернуться ко встроенному</button></div>
        </details>
        <div class="row" style="margin-top:10px">
          <button class="btn small" id="an-save-plain">Сохранить как обычное объявление</button>
          <button class="btn small" id="an-confirm-r3">Подтвердить R3 вручную</button>
        </div>`;
      const saveAd = (idx) => askReviewer("Сохранить объявление и решение", (r, c) => {
        const id = "AD-U" + String(state.userAds.length + 1).padStart(2, "0");
        state.userAds.unshift({
          id, zkId, platform: $("#an-platform").value, account: $("#an-account").value,
          date: $("#an-date").value || "2026-10-15", url: $("#an-url").value, text,
          captureAt: new Date().toISOString().slice(0, 10), userAdded: true,
        });
        const hyp = idx != null ? res.hypotheses[idx] : null;
        if (hyp) setFactor(zkId, hyp.candidate_factor, "confirmed", r + (c ? " · " + c : ""), { adId: id, quote: hyp.exact_quote, source: "Новое объявление " + id });
        persist();
        const rel = window.SQ_Parser.relatedAds(state.userAds[0], allAds());
        toast(`Объявление ${id} сохранено${hyp ? ", " + hyp.candidate_factor + " подтверждён" : ""}${rel.length ? " · связано: " + rel.slice(0, 2).map((x) => x.id + " (" + x.via + ")").join(", ") : ""}`);
        nav("detail", { zkId });
      });
      page.querySelectorAll("[data-hok]").forEach((b) => b.onclick = () => saveAd(+b.dataset.hok));
      page.querySelectorAll("[data-hno]").forEach((b) => b.onclick = () => { b.closest(".hyp").querySelector(".row").innerHTML = `<span class="st rejected">отклонён</span> <span style="font-size:12px;color:var(--ink-2)">решение зафиксировано локально, на балл не влияет</span>`; toast("Гипотеза отклонена"); });
      $("#an-save-plain").onclick = () => saveAd(null);
      const aiSave = $("#an-ai-save"), aiOff = $("#an-ai-off");
      if (aiSave) aiSave.onclick = () => {
        const key = $("#an-ai-key").value.trim();
        if (!key) { toast("Вставьте ключ — или ничего не трогайте, помощник уже работает"); return; }
        window.SQ_AI.saveConfig({ endpoint: $("#an-ai-endpoint").value.trim(), model: $("#an-ai-model").value.trim(), apiKey: key });
        $("#an-ai-key").value = "";
        toast(window.SQ_AI.hasRealAI() ? "Ваша модель подключена" : "Нужно ещё название модели");
        render();
      };
      if (aiOff) aiOff.onclick = () => { window.SQ_AI.saveConfig({}); toast("Снова встроенный помощник"); render(); };
      $("#an-confirm-r3").onclick = () => askReviewer("Подтвердить R3 вручную", (r, c) => {
        const id = "AD-U" + String(state.userAds.length + 1).padStart(2, "0");
        state.userAds.unshift({ id, zkId, platform: $("#an-platform").value, account: $("#an-account").value, date: $("#an-date").value || "2026-10-15", url: $("#an-url").value, text, captureAt: new Date().toISOString().slice(0, 10), userAdded: true });
        setFactor(zkId, "R3", "confirmed", r + (c ? " · " + c : ""), { adId: id, quote: text.slice(0, 140), source: "Новое объявление " + id });
        persist(); toast(`R3 подтверждён`); nav("detail", { zkId });
      });
      } finally { runBtn.disabled = false; }
    };
  }

  function tlineHtml(zk, sig) {
    const items = [];
    for (const e of (zk.events || [])) items.push({ d: (e.date || "").slice(0, 10), t: e.text, k: "" });
    for (const h of ((sig && sig.history) || [])) items.push({ d: (h.at || "").slice(0, 10), t: `${sigLabel(h.from)} → ${h.to === "confirmed" ? "сигнал подтверждён" : h.to === "returned" ? "сигнал возвращён" : h.to}${h.reviewer ? ` · ${h.reviewer}` : ""}`, k: h.to === "confirmed" ? "bad" : h.to === "returned" ? "warn" : "" });
    for (const f of (zk.factors || []).filter((x) => x.status === "confirmed" && x.updatedAt)) items.push({ d: (f.updatedAt || "").slice(0, 10), t: `${f.code} подтверждён${f.reviewer ? ` · ${f.reviewer}` : ""}`, k: f.code === "R1" || f.code === "R2" ? "bad" : "warn" });
    items.sort((a, b) => (a.d < b.d ? -1 : 1));
    if (!items.length) return `<div class="empty">Событий пока нет.</div>`;
    return items.map((i) => `<div class="tev ${i.k}"><time>${esc(i.d || "—")}</time><br>${esc(i.t)}</div>`).join("");
  }
  function vSignal(zkId) {
    const zk = getZk(zkId);
    if (!zk) { page.innerHTML = `<div class="panel empty">Объект не найден.</div>`; return; }
    const s = scoreOf(zk);
    const sig = getSignal(zkId);
    const confirmed = zk.factors.filter((f) => f.status === "confirmed");
    page.innerHTML = `
      <div class="row no-print" style="margin-bottom:12px">
        <button class="btn small" id="sg-back">← К карточке ЖК</button>
        <span style="flex:1"></span>
        <button class="btn small primary" id="sg-confirm">Подтвердить сигнал</button>
        <button class="btn small danger" id="sg-return">Вернуть на доработку</button>
        <button class="btn small" id="sg-print">Печать / PDF</button>
      </div>
      <div class="panel signal" id="signal-card">
        <div class="shead">
          <div style="font-size:11.5px;letter-spacing:.09em;color:var(--ink-3)">SAQ QURYLYS · СИГНАЛЬНАЯ КАРТОЧКА · <b>НЕ ЮРИДИЧЕСКИЙ ДОКУМЕНТ</b></div>
          <h3>${esc(zk.name)} — ${s.score}/100 · ${zoneLabel(s.zone)} зона</h3>
          <div style="font-size:13px;color:var(--ink-2)">${esc(zk.id)} · ${esc(zk.address)} · ${esc(zk.developer)}${zk.bin ? ` · БИН <span style="font-family:var(--mono)">${esc(zk.bin)}</span>` : ""} ${originChip(zk)}</div>
          <div style="margin-top:6px">${zoneChip(s.zone)} <span class="chip">статус: ${esc(sigLabel(sig.status))}</span> ${zk.scenario ? `<span class="chip">сценарий ${zk.scenario}</span>` : ""}</div>
        </div>
        <div class="sig-grid">
          <div><div class="section-t">Подтверждённые факторы</div>
            ${confirmed.length ? confirmed.map((f) => { const m = FACTOR_META[f.code]; return `<div style="font-size:13px;margin-bottom:8px"><b style="font-family:var(--mono)">${f.code} +${m.points}</b> · ${esc(m.title)}<br><span style="color:var(--ink-2);font-size:12.5px">${f.evidence && f.evidence.quote ? `«${esc(f.evidence.quote)}» · ` : ""}${esc((f.evidence && (f.evidence.source || f.evidence.date)) || "—")}${f.reviewer ? ` · ${esc(f.reviewer)}` : ""}</span></div>`; }).join("") : `<div style="font-size:13px;color:var(--ink-2)">Нет подтверждённых факторов.</div>`}
          </div>
          <div><div class="section-t">Правовое основание и готовность</div>
            <div style="font-size:13px">Основание: <b>${esc(legalLabel(zk.legalBasis))}</b><br>
            <span style="color:var(--ink-2);font-size:12.5px">${esc(zk.legalBasis.source)} · ${esc(zk.legalBasis.checkedAt)}</span></div>
            <div style="font-size:13px;margin-top:8px">Готовность: заявлено ${zk.readinessClaimed ?? "—"}% · подтверждено ${zk.readinessConfirmed ?? "—"}%</div>
            <div style="font-size:13px;margin-top:8px">Связанных объявлений: ${adsOf(zkId).length}</div>
          </div>
        </div>
        <div class="log"><div class="section-t">Журнал решений</div>
          ${sig.history.length ? `<table><tr><th>Дата</th><th>Аналитик</th><th>Переход</th><th>Комментарий</th></tr>${sig.history.map((h) => `<tr><td style="font-family:var(--mono)">${esc(h.at.slice(0, 16).replace("T", " "))}</td><td>${esc(h.reviewer)}</td><td>${esc(h.from)} → <b>${esc(h.to)}</b></td><td>${esc(h.comment || "—")}</td></tr>`).join("")}</table>` : `<div style="font-size:13px;color:var(--ink-2)">Решений пока нет — сигнал в статусе «черновик».</div>`}
          <div style="font-size:12px;color:var(--ink-3);margin-top:10px">Система подсвечивает признаки и помогает принять решение, но не устанавливает факт правонарушения и не отправляет материалы в госорганы автоматически. Учебные записи вымышлены; записи реестра — из открытого набора Ashyq Data.</div>
        </div>
      </div>`;
    $("#sg-back").onclick = () => nav("detail", { zkId });
    $("#sg-print").onclick = () => window.print();
    $("#sg-confirm").onclick = () => askReviewer("Подтвердить сигнал", (r, c) => { setSignal(zkId, "confirmed", r, c); toast("Сигнал подтверждён"); render(); });
    $("#sg-return").onclick = () => askReviewer("Вернуть на доработку", (r, c) => { setSignal(zkId, "returned", r, c); toast("Сигнал возвращён"); render(); });
  }

  const SCENARIOS = [
    { id: "SQ-001", letter: "A", title: "Основание не проверено + платная бронь", calc: "R2 25 + R3 10 = 35", expect: { score: 35, zone: "yellow" }, note: "Неизвестное основание не превращается в R1." },
    { id: "SQ-002", letter: "B", title: "Отсутствие основания установлено + депозит", calc: "R1 35 + R2 25 + R3 10 = 70", expect: { score: 70, zone: "red" }, note: "Красный, но карточка ждёт решения человека." },
    { id: "SQ-003", letter: "C", title: "Гарантия подтверждена + обычное объявление", calc: "R3 10 = 10", expect: { score: 10, zone: "green" }, note: "Нет отдельного разрешения МИО — и это не R1." },
  ];
  const DEMO_TEXTS = {
    "SQ-001": "Старт продаж в строящемся доме, сдача в 2027 году. Бронь квартиры — всего 500 000 тенге, сумма идёт в зачёт стоимости!",
    "SQ-002": "Продажа квартир на этапе котлована! Депозит 1 000 000 тенге для фиксации цены, остаток в рассрочку от застройщика.",
    "SQ-003": "Открыты продажи в строящемся доме, сдача — IV квартал 2026. Оформление строго по договору с гарантией Единого оператора, оплата через эскроу.",
  };
  function vRegistries() {
    const regs = window.SQ_SEED.REGISTRIES;
    page.innerHTML = `<div class="panel" style="padding:6px 18px 14px"><div class="section-t">Открытые реестры и базы данных РК · внешние ссылки</div>
      <p style="font-size:13px;color:var(--ink-2)">Живой интеграции с реестрами здесь нет. Список нужен аналитику для ручной сверки; результат сверки фиксируется в карточке ЖК с источником и датой.</p>
      ${(regs || []).map((r) => `<div style="padding:8px 0;border-top:1px solid var(--line);font-size:13.5px"><a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.name)}</b></a><br><span style="color:var(--ink-2);font-size:12.5px">${esc(r.note)} · ${esc(r.url)}</span></div>`).join("")}</div>`;
  }

  // ---------- topbar actions ----------
  const sessBtn = $("#btn-sess"), sessMenu = $("#sess-menu");
  const setSess = (open) => { if (!sessBtn) return; sessMenu.hidden = !open; sessBtn.setAttribute("aria-expanded", open ? "true" : "false"); };
  if (sessBtn) {
    sessBtn.onclick = (e) => { e.stopPropagation(); setSess(sessMenu.hidden); };
    document.addEventListener("click", (e) => { if (!sessMenu.hidden && !e.target.closest(".sess")) setSess(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sessMenu.hidden) { setSess(false); sessBtn.focus(); } });
  }
  const menuBtn = $("#btn-menu");
  if (menuBtn) menuBtn.onclick = () => {
    const open = document.body.classList.toggle("nav-open");
    menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
  };
  $("#nav").addEventListener("click", () => document.body.classList.remove("nav-open"));
  const brandHome = $("#brand-home");
  if (brandHome) brandHome.onclick = () => { document.body.classList.remove("nav-open"); nav("home"); };
  $("#btn-account").onclick = () => {
    const s = getSession();
    if (!s.name) {
      openModal(`<h3>Вход · тестовый доступ</h3>
        <p class="acct-meta">Настоящей авторизации здесь нет: сервера, паролей и личных кабинетов не существует. Укажите имя аналитика — оно будет подписывать решения в журнале. Ничего кроме имени не хранится.</p>
        <label class="f">Имя аналитика<input type="text" id="m-login" maxlength="60" placeholder="например, А. Аналитик"></label>
        <div class="err" id="m-login-err" role="alert"></div>
        <div class="row" style="margin-top:12px"><button class="btn primary" id="m-login-ok">Войти</button><button class="btn" id="m-login-cancel">Отмена</button></div>`);
      $("#m-login-cancel").onclick = closeModal;
      $("#m-login-ok").onclick = () => {
        const v = $("#m-login").value.trim();
        if (v.length < 2) { $("#m-login-err").textContent = "Введите имя: минимум 2 символа."; $("#m-login").focus(); return; }
        setSession(v); closeModal(); toast("Вы вошли как " + v + " (тестовый доступ)");
      };
    } else {
      openModal(`<h3>Аккаунт · тестовый доступ</h3>
        <p class="acct-meta">Аналитик: <b>${esc(s.name)}</b><br>Вход: ${esc((s.at || "").slice(0, 16).replace("T", " "))}<br>Это локальная подпись решений, а не настоящий аккаунт.</p>
        <div class="row" style="margin-top:12px"><button class="btn danger" id="m-logout">Выйти</button><button class="btn" id="m-acct-close">Закрыть</button></div>`);
      $("#m-acct-close").onclick = closeModal;
      $("#m-logout").onclick = () => { clearSession(); closeModal(); toast("Вы вышли из тестового доступа"); };
    }
  };
  $("#btn-reset").onclick = () => { if (confirm("Сбросить все подтверждения, объявления и сигналы к исходному состоянию?")) { localStorage.removeItem(LS_STATE); state = loadState(); nav("home"); toast("Всё сброшено к исходному состоянию"); } };
  // AI-настройка убрана из меню: помощник работает сразу (см. раздел «Проверка»,
  // блок «Хочу свою модель — необязательно»). Здесь только сброс состояния.

  try { const r0 = routeFromHash(window.location.hash); if (r0) state.route = r0; } catch {}
  refreshAccount();
  render();
})();
