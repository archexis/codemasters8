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
    let s = { complexes: deepClone(seed.COMPLEXES), userAds: [], signals: {}, route: { view: "home" } };
    try {
      const raw = JSON.parse(localStorage.getItem(LS_STATE) || "null");
      if (raw) {
        // merge persisted factor statuses + user ads + signals onto fresh seed
        if (raw.factors) for (const zk of s.complexes) {
          if (raw.factors[zk.id]) zk.factors = raw.factors[zk.id];
        }
        if (Array.isArray(raw.userAds)) s.userAds = raw.userAds;
        if (raw.signals) s.signals = raw.signals;
      }
    } catch { /* malformed storage -> fresh seed */ }
    return s;
  }
  function persist() {
    const factors = {};
    for (const zk of state.complexes) factors[zk.id] = zk.factors;
    localStorage.setItem(LS_STATE, JSON.stringify({ factors, userAds: state.userAds, signals: state.signals }));
  }
  let state = loadState();

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
    b.textContent = s.name ? ("👤 " + s.name) : "Войти";
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
    home: ["SAQ QURYLYS", "Титул · начните с проверки объявления"],
    overview: ["Объекты", "Өскемен · 8 демо-ЖК · все совпадения случайны"],
    detail: ["Карточка ЖК", "история · источники · факторы риска"],
    ads: ["Мониторинг рекламы", "все публикации · подозрительные формулировки подсвечены"],
    analyze: ["Проверка", "парсер → гипотезы → решение человека"],
    signal: ["Сигнальная карточка", "факторы · доказательства · статус проверки"],
    scenarios: ["Контрольные сценарии", "A · B · C — живые расчёты по текущим данным"],
    registries: ["Открытые реестры РК", "внешние источники · живой интеграции в демо нет"],
    about: ["О проекте", "архитектура · ограничения · путь демонстрации"],
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
    updateCounts(); updateAIStatus();
    if (r.view === "home") vHome();
    else if (r.view === "overview") vOverview();
    else if (r.view === "detail") vDetail(r.zkId);
    else if (r.view === "ads") vAds();
    else if (r.view === "analyze") vAnalyze(r.prefill);
    else if (r.view === "signal") vSignal(r.zkId);
    else if (r.view === "scenarios") vScenarios();
    else if (r.view === "registries") vRegistries();
    else if (r.view === "about") vAbout();
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
      ? `AI: <b style="color:#7fd6b2">real</b> · <span style="font-family:var(--mono);font-size:11px">${esc(cfg.model || "")}</span>`
      : `AI: <b style="color:#ffd97a">demo-режим</b> · эвристика с честной меткой`;
  }

  // ---------- views ----------
  let overviewFilter = { q: "", zone: "all" };

  function parserEntitiesHtml(p) {
    if (!p) return "";
    const rows = (p.entities || []).slice(0, 12).map((e) => `<tr><td><b>${esc(e.label)}</b></td><td>${esc(e.value)}</td><td><span class="conf ${esc(e.confidence)}">${esc(e.confidence)}</span></td><td class="q">«${esc(e.quote)}»</td></tr>`).join("");
    return `<div style="margin:12px 0 4px"><span class="engine-badge parser">PARSER · local-parser — настоящий локальный разбор</span></div>
    <div style="font-size:12.5px;color:var(--ink-2)">Платёжных предложений: <b>${p.payment.flagged ? "найдены" : "не найдены"}</b> · предложений в тексте: ${p.sentences} · сущностей: ${p.entities.length}</div>
    ${rows ? `<table class="parse-table"><tr><th>Тип</th><th>Значение</th><th>Уверенность</th><th>Цитата</th></tr>${rows}</table>` : `<div class="empty">Сущностей не извлечено.</div>`}`;
  }

  function vHome() {
    const counts = { green: 0, yellow: 0, red: 0 };
    for (const zk of state.complexes) counts[scoreOf(zk).zone]++;
    const top = state.complexes.slice().sort((a, b) => scoreOf(b).score - scoreOf(a).score).slice(0, 3);
    const regs = window.SQ_SEED.REGISTRIES || [];
    const rules = ["R1", "R2", "R3", "R4", "R5", "R6"].map((c) => `<tr><td><b style="font-family:var(--mono)">${c}</b></td><td class="pts">+${FACTOR_META[c].points}</td><td>${esc(FACTOR_META[c].title)}<br><span style="color:var(--ink-2);font-size:12px">${esc(FACTOR_META[c].hint)}</span></td></tr>`).join("");
    page.innerHTML = `
      <div class="hero">
        <div class="orb a"></div><div class="orb b"></div><div class="orb c"></div>
        <span class="kicker"><span class="demo-pill">DEMO · данные вымышлены</span> Codemasters 8.0 · Өскемен</span>
        <h1>Риски долевого строительства — с объяснимыми основаниями</h1>
        <p class="lead">SAQ QURYLYS собирает объявления, объекты и проверки в одну карточку: парсер находит деньги и сроки дословно, риск считается по фиксированным правилам R1–R6, а решение всегда принимает человек.</p>
        <div class="cta">
          <button class="btn btn-sun" data-go="analyze">Проверить объявление</button>
          <button class="btn btn-glass" data-go="overview">Открыть рабочую панель</button>
        </div>
      </div>
      <div class="anchors" aria-label="Разделы страницы">
        <a href="#l-problem">Проблема</a><a href="#l-how">Как работает</a><a href="#l-rules">Правила R1–R6</a><a href="#l-zones">Зоны</a><a href="#l-cases">Кейсы A·B·C</a><a href="#l-regs">Реестры</a><a href="#l-demo">Демо-путь</a><a href="#l-faq">Вопросы</a>
      </div>
      <div class="stats">
        <div class="panel stat"><div class="n" data-count="${state.complexes.length}">0</div><div class="l">демо-ЖК под наблюдением</div></div>
        <div class="panel stat bad"><div class="n" data-count="${counts.red}" style="color:var(--red)">0</div><div class="l">красная зона · приоритет</div></div>
        <div class="panel stat warn"><div class="n" data-count="${counts.yellow}" style="color:var(--amber)">0</div><div class="l">жёлтая зона · проверка</div></div>
        <div class="panel stat"><div class="n" data-count="${allAds().length}">0</div><div class="l">публикаций разобрано</div></div>
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

      <div class="section-t">Приоритет сейчас <small>топ по баллу, вживую</small></div>
      <div class="panel">
        ${top.map((zk) => { const s = scoreOf(zk); return `<div class="zkrow" data-zk="${zk.id}" tabindex="0" role="link" aria-label="${esc(zk.name)}, ${s.score} баллов">
          <div><div class="nm">${esc(zk.name)} <span class="demo-pill">DEMO</span></div><div class="addr">${esc(zk.address)} · ${esc(zk.stage)}</div></div>
          <div class="hide-m"><div class="scorebar"><i style="width:${s.score}%"></i></div></div>
          <div class="hide-m"><span class="meta">${s.score} / 100</span></div>
          <div>${zoneChip(s.zone)}</div></div>`; }).join("")}
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
        Живой интеграции с госреестрами в демо нет — это честно указано. Две ссылки при проверке 15.10.2026 не открылись (кадастровая карта, реестр недобросовестных участников) — сверяйте вручную. Все компании, БИНы и адреса вымышлены.
      </div>

      <div class="section-t" id="l-demo">Путь демонстрации <small>2–3 минуты</small></div>
      <div class="panel" style="padding:14px 20px"><ol class="prose" style="margin:0;padding-left:20px">
        <li>Откройте <b>Объекты</b>: фильтры зон, карта, сортировка по баллу.</li>
        <li>Зайдите в карточку <b>SQ-002</b> (кейс B): факторы, доказательства, журнал.</li>
        <li>В <b>Проверке</b> вставьте пример → гипотеза с цитатой → подтвердите → балл пересчитан.</li>
        <li>В <b>сигнальной карточке</b> подтвердите сигнал и распечатайте отчёт в PDF.</li>
        <li>В <b>Сценариях</b> проверьте: A = 35, B = 70, C = 10.</li>
      </ol></div>

      <div class="section-t" id="l-faq">Частые вопросы <small>честно про ограничения</small></div>
      <div class="panel faq" style="padding:8px 18px 14px">
        <details open><summary>Это юридическое заключение?</summary><p>Нет. SAQ QURYLYS подсвечивает признаки и помогает принять решение, но не устанавливает факт правонарушения и ничего никуда не отправляет автоматически. Все записи демонстрационные.</p></details>
        <details><summary>Почему платная бронь — это «жёлтый», а не сразу «красный»?</summary><p>Красная зона требует одновременно подтверждённых R1 (основания нет — установлено проверкой) и R2 (деньги просят). Один платёж без проверки основания — жёлтая зона и повод проверить реестры.</p></details>
        <details><summary>Что делает AI, а что — человек?</summary><p>AI и локальный парсер извлекают только дословные фрагменты и честно помечают режим (real / demo). Фактором риска находка становится после подтверждения аналитиком с источником и датой.</p></details>
        <details><summary>Откуда данные?</summary><p>Все 8 ЖК, 13 объявлений, компании, БИНы и адреса вымышлены и помечены DEMO. Совпадения случайны. Реестры — внешние ссылки для ручной сверки.</p></details>
        <details><summary>Можно подключить настоящую модель?</summary><p>Да: кнопка «Настроить AI» принимает OpenAI-совместимый endpoint и ключ. Ключ хранится только в localStorage браузера и никогда не коммитится. Без ключа работает меченая эвристика.</p></details>
      </div>

      <div class="panel footer"><b>SAQ QURYLYS · DEMO — не юридический документ.</b> Скоринг детерминирован: минимум 100, только подтверждённые факторы, неизвестность — 0 и «требует проверки». Исходное ТЗ имеет приоритет над дизайном: визуальные изменения не ослабляют обязательные правила.</div>`;

    page.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => nav(b.dataset.go));
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
        <div class="panel stat"><div class="n">${state.complexes.length}</div><div class="l">демо-ЖК под наблюдением</div></div>
        <div class="panel stat"><div class="n" style="color:var(--red)">${counts.red}</div><div class="l">красная зона · приоритет</div></div>
        <div class="panel stat"><div class="n" style="color:var(--amber)">${counts.yellow}</div><div class="l">жёлтая зона · проверка</div></div>
        <div class="panel stat"><div class="n" style="color:var(--green)">${counts.green}</div><div class="l">зелёная зона · мониторинг</div></div>
      </div>
      <div class="mapwrap">
        <div><div id="map" role="img" aria-label="Карта объектов"></div></div>
        <div class="panel mapnote"><b>Карта — только объекты с координатами.</b><br><br><span id="map-note-text"></span></div>
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
            <div><div class="nm">${esc(zk.name)} <span class="demo-pill">DEMO</span>${zk.scenario ? ` <span class="chip">сценарий ${zk.scenario}</span>` : ""}</div>
              <div class="addr">${esc(zk.address)} · ${esc(zk.stage)}</div>
              <div class="meta">${zk.id} · ${esc(zk.developer)} · объявлений: ${ads.length} · ${esc(legalShort(zk.legalBasis))}</div></div>
            <div class="hide-m"><div class="scorebar" aria-hidden="true"><i style="width:${s.score}%;background:${color}"></i></div>
              <div class="meta" style="margin-top:4px">${s.score} / 100 · подтверждено: ${s.confirmed.join(", ") || "—"}</div></div>
            <div class="hide-m"><span class="meta">сигнал: ${esc(sigLabel(getSignal(zk.id).status))}</span></div>
            <div>${zoneChip(s.zone)}</div>
          </div>`;
        }).join("") : `<div class="empty">Ничего не найдено. Измените запрос или фильтр.</div>`}
      </div>`;

    $("#ov-q").addEventListener("input", (e) => { overviewFilter.q = e.target.value; const v = e.target.value; const pos = e.target.selectionStart; render(); const el = $("#ov-q"); el.focus(); el.setSelectionRange(pos, pos); });
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
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map);
    const bounds = [];
    for (const zk of withCoords) {
      const s = scoreOf(zk);
      const icon = L.divIcon({ className: "", html: `<span class="pin ${s.zone}"></span>`, iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -10] });
      const m = L.marker([zk.lat, zk.lng], { icon }).addTo(map);
      m.bindPopup(`<b>${esc(zk.name)}</b><br>${s.score} баллов · ${esc(zoneLabel(s.zone))}`);
      m.on("click", () => nav("detail", { zkId: zk.id }));
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
          <div style="padding:16px 18px 0"><h3 style="font-family:var(--serif);margin:0;font-size:22px">${esc(zk.name)} <span class="demo-pill">DEMO</span></h3>
          <div style="color:var(--ink-2);font-size:13px">${esc(zk.city)} · ${esc(zk.address)}</div></div>
          <dl class="kv">
            <dt>Застройщик / БИН</dt><dd>${esc(zk.developer)} · <span style="font-family:var(--mono)">${esc(zk.bin)}</span> <span class="chip">вымышлены</span></dd>
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
          <div class="factor"><div class="fh"><b>${esc(a.id)}</b> <span class="chip">${esc(a.platform)}</span> <span class="chip">${esc(a.account)}</span> <span class="chip">${esc(a.date)}</span> ${a.userAdded ? `<span class="chip">добавлено аналитиком</span>` : `<span class="chip">демо-снимок</span>`}</div>
          <div class="adtext" style="margin-top:6px">${highlight(a.text)}</div>
          <div class="src-link"><a href="${esc(a.url)}" target="_blank" rel="noopener">Источник (демо-ссылка)</a> · снято ${esc(a.captureAt)}</div></div>`).join("")
          : `<div class="empty">Объявлений пока нет. Добавьте первое через «Новый анализ».</div>`}
      </div>

      <div class="grid2">
        <div><div class="section-t">События</div><div class="panel timeline">
          ${(zk.events || []).map((e) => `<div><time>${esc(e.date)}</time><span>${esc(e.text)}</span></div>`).join("") || `<div class="empty">Нет событий.</div>`}
        </div></div>
        <div><div class="section-t">Источники и фиксация</div><div class="panel timeline">
          ${(zk.sources || []).map((e) => `<div><time>${esc(e.date)}</time><span>${esc(e.title)}</span></div>`).join("") || `<div class="empty">Нет источников.</div>`}
        </div></div>
      </div>`;

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
  }

  function vAds() {
    const ads = allAds();
    page.innerHTML = `
      <div class="toolbar"><span style="font-size:13px;color:var(--ink-2)">Всего публикаций: <b>${ads.length}</b> · жёлтая подсветка — потенциально платёжные формулировки (подсказка, не вердикт)</span>
      <span style="flex:1"></span><button class="btn primary small" id="ads-new">+ Новое объявление</button></div>
      <div class="panel">${ads.map((a) => {
        const zk = getZk(a.zkId);
        return `<div class="factor"><div class="fh"><b>${esc(a.id)}</b> <span class="chip">${esc(a.platform)}</span> <span class="chip">${esc(a.account)}</span> <span class="chip">${esc(a.date)}</span>
          → <a href="#" data-zk="${esc(a.zkId)}">${esc(zk ? zk.name : a.zkId)}</a></div>
          <div class="adtext" style="margin-top:6px">${highlight(a.text)}</div>
          <div class="src-link"><a href="${esc(a.url)}" target="_blank" rel="noopener">Источник</a> · снято ${esc(a.captureAt)}</div></div>`;
      }).join("")}</div>`;
    $("#ads-new").onclick = () => nav("analyze");
    page.querySelectorAll("[data-zk]").forEach((x) => x.onclick = (e) => { e.preventDefault(); nav("detail", { zkId: x.dataset.zk }); });
  }

  function vAnalyze(prefill) {
    const opts = state.complexes.map((z) => `<option value="${z.id}" ${prefill && prefill.zkId === z.id ? "selected" : ""}>${esc(z.name)} · ${z.id}</option>`).join("");
    page.innerHTML = `
      <div class="grid2">
        <div class="panel" style="padding:16px 18px">
          <h3 class="block" style="padding:0 0 8px">1 · Ввод объявления</h3>
          <div style="display:grid;gap:10px">
            <label class="f">Связанный ЖК<select id="an-zk">${opts}</select></label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <label class="f">Площадка<input type="text" id="an-platform" value="Krisha (демо)" maxlength="80"></label>
              <label class="f">Аккаунт<input type="text" id="an-account" value="@analyst_inbox" maxlength="80"></label>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <label class="f">Дата публикации<input type="date" id="an-date" value="2026-10-15"></label>
              <label class="f">URL<input type="url" id="an-url" value="https://example.invalid/new" maxlength="300"></label>
            </div>
            <label class="f">Текст объявления<textarea id="an-text" rows="8" maxlength="4000" placeholder="Вставьте текст объявления…"></textarea></label>
            <div class="row">
              <button class="btn primary" id="an-run">Запустить анализ</button>
              <button class="btn" id="an-fill">Вставить пример</button>
            </div>
            <div class="preset-grid">
              <button class="preset" data-preset="SQ-001"><b>Кейс A · платная бронь</b><span>основание не проверено → ?</span></button>
              <button class="preset" data-preset="SQ-002"><b>Кейс B · депозит</b><span>основания нет → ?</span></button>
              <button class="preset" data-preset="SQ-003"><b>Кейс C · гарантия</b><span>чистое объявление → ?</span></button>
            </div>
            <div style="font-size:12px;color:var(--ink-2);margin-top:6px">Пресеты подставляют демо-текст и объект. Живые расчёты A·B·C — ниже.</div>
          </div>
        </div>
        <div class="panel" style="padding:16px 18px" id="an-result">
          <h3 class="block" style="padding:0 0 8px">2 · Гипотезы и решение</h3>
          <div class="empty">Здесь появятся разбор парсера и гипотезы с точными цитатами.<br>Ничего не влияет на балл, пока человек не подтвердит.</div>
        </div>
      </div>
      <div class="section-t">Живые расчёты A·B·C <small>по текущим данным</small></div>
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
    $("#an-run").onclick = async () => {
      const text = $("#an-text").value;
      const zkId = $("#an-zk").value;
      const zk = getZk(zkId);
      if (!text.trim()) { toast("Вставьте текст объявления"); return; }
      $("#an-result").innerHTML = `<h3 class="block" style="padding:0 0 8px">2 · Гипотезы и решение</h3>
        <div><span class="engine-badge parser">PARSER · разбор…</span></div>
        <div class="loading-line"></div><div class="loading-line" style="width:72%"></div><div class="loading-line" style="width:48%"></div>`;
      let parsed = null;
      try { parsed = window.SQ_Parser.parseAdText(text); }
      catch (err) { $("#an-result").innerHTML += `<div class="empty">Парсер: ${esc(err.message)}</div>`; return; }
      let res;
      try { res = await window.SQ_AI.analyzeAdText(text, zk.name); }
      catch (err) { $("#an-result").innerHTML += `<div class="empty">Ошибка: ${esc(err.message)}</div>`; return; }
      const badge = res.realAI ? `<span class="engine-badge real">REAL AI · ${esc(res.engine)}</span>` : `<span class="engine-badge demo">DEMO · ${esc(res.engine)} — не настоящий ИИ</span>`;
      const hyps = res.hypotheses.length ? res.hypotheses.map((h, i) => `
        <div class="hyp"><b>Гипотеза ${i + 1} → кандидат ${esc(h.candidate_factor || "—")}</b> ${statusChip("hypothesis")}
          <span class="q">«${esc(h.exact_quote)}»</span>
          <div style="font-size:13px">${esc(h.explanation)}</div>
          <div style="font-size:12px;color:var(--ink-2)">уверенность: ${esc(h.confidence)} · требует решения человека</div>
          <div class="row" style="margin-top:8px">
            <button class="btn small primary" data-hok="${i}">Подтвердить как ${esc(h.candidate_factor)}</button>
            <button class="btn small danger" data-hno="${i}">Отклонить</button>
          </div></div>`).join("")
        : `<div class="empty">Прямых предложений внести деньги не найдено.<br>Объявление можно сохранить как обычное (кандидат R3 — на усмотрение аналитика).</div>`;
      $("#an-result").innerHTML = `<h3 class="block" style="padding:0 0 8px">2 · Гипотезы и решение</h3>
        <div style="margin-bottom:8px">${badge}</div>
        ${parserEntitiesHtml(parsed)}
        <div class="section-t">Гипотезы <small>только после решения человека влияют на балл</small></div>${hyps}
        <div class="section-t">Ограничения</div>
        <ul style="font-size:12.5px;color:var(--ink-2)">${res.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
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
        persist(); toast(`Объявление ${id} сохранено${hyp ? ", " + hyp.candidate_factor + " подтверждён" : ""}`);
        nav("detail", { zkId });
      });
      page.querySelectorAll("[data-hok]").forEach((b) => b.onclick = () => saveAd(+b.dataset.hok));
      page.querySelectorAll("[data-hno]").forEach((b) => b.onclick = () => { b.closest(".hyp").querySelector(".row").innerHTML = `<span class="st rejected">отклонён</span> <span style="font-size:12px;color:var(--ink-2)">решение зафиксировано локально, на балл не влияет</span>`; toast("Гипотеза отклонена"); });
      $("#an-save-plain").onclick = () => saveAd(null);
      $("#an-confirm-r3").onclick = () => askReviewer("Подтвердить R3 вручную", (r, c) => {
        const id = "AD-U" + String(state.userAds.length + 1).padStart(2, "0");
        state.userAds.unshift({ id, zkId, platform: $("#an-platform").value, account: $("#an-account").value, date: $("#an-date").value || "2026-10-15", url: $("#an-url").value, text, captureAt: new Date().toISOString().slice(0, 10), userAdded: true });
        setFactor(zkId, "R3", "confirmed", r + (c ? " · " + c : ""), { adId: id, quote: text.slice(0, 140), source: "Новое объявление " + id });
        persist(); toast(`R3 подтверждён`); nav("detail", { zkId });
      });
    };
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
          <div style="font-size:11.5px;letter-spacing:.09em;color:var(--ink-3)">SAQ QURYLYS · СИГНАЛЬНАЯ КАРТОЧКА · <b>DEMO — НЕ ЮРИДИЧЕСКИЙ ДОКУМЕНТ</b></div>
          <h3>${esc(zk.name)} — ${s.score}/100 · ${zoneLabel(s.zone)} зона</h3>
          <div style="font-size:13px;color:var(--ink-2)">${esc(zk.id)} · ${esc(zk.address)} · ${esc(zk.developer)} · БИН <span style="font-family:var(--mono)">${esc(zk.bin)}</span> (вымышлены)</div>
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
          <div style="font-size:12px;color:var(--ink-3);margin-top:10px">Система подсвечивает признаки и помогает принять решение, но не устанавливает факт правонарушения и не отправляет материалы в госорганы автоматически. Все записи демонстрационные.</div>
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
  function vScenarios() {
    page.innerHTML = `<p style="color:var(--ink-2);font-size:13.5px;max-width:70ch">Контрольные кейсы из ТЗ считаются <b>вживую</b> по текущим данным (учитываются ваши подтверждения/отклонения). Кнопка «Проверить вживую» прогоняет текст через AI-адаптер и показывает гипотезы.</p>
    <div class="scen">${SCENARIOS.map((sc) => {
        const zk = getZk(sc.id); const s = scoreOf(zk);
        const ok = s.score === sc.expect.score && s.zone === sc.expect.zone;
        return `<div class="panel scencard"><h4>Кейс ${sc.letter} · ${esc(sc.title)}</h4>
          <div class="calc">Ожидание: ${esc(sc.calc)} → ${sc.expect.score}, ${zoneLabel(sc.expect.zone)}<br>Сейчас: ${s.score}, ${zoneLabel(s.zone)} · ${ok ? `<span class="pass">СОВПАДАЕТ</span>` : `<span class="fail">ОТЛИЧАЕТСЯ (данные меняли?)</span>`}</div>
          <div style="font-size:12.5px;color:var(--ink-2)">${esc(sc.note)}</div>
          <div class="row"><button class="btn small" data-open="${sc.id}">Открыть ЖК</button><button class="btn small" data-live="${sc.id}">Проверить вживую</button></div>
          <div id="live-${sc.id}"></div></div>`;
      }).join("")}</div>`;
    page.querySelectorAll("[data-open]").forEach((b) => b.onclick = () => nav("detail", { zkId: b.dataset.open }));
    page.querySelectorAll("[data-live]").forEach((b) => b.onclick = async () => {
      const box = $("#live-" + b.dataset.live);
      box.innerHTML = `<div style="font-size:12.5px">Анализ…</div>`;
      try {
        const res = await window.SQ_AI.analyzeAdText(DEMO_TEXTS[b.dataset.live], getZk(b.dataset.live).name);
        box.innerHTML = `<div style="margin-top:6px">${res.realAI ? `<span class="engine-badge real">REAL AI</span>` : `<span class="engine-badge demo">DEMO-эвристика</span>`}
          ${res.hypotheses.length ? res.hypotheses.map((h) => `<div class="hyp"><span class="q">«${esc(h.exact_quote)}»</span><div style="font-size:12.5px">→ кандидат ${esc(h.candidate_factor)} · ${esc(h.explanation)}</div></div>`).join("") : `<div style="font-size:12.5px">Прямых предложений оплаты не найдено.</div>`}</div>`;
      } catch (e) { box.innerHTML = `<div style="font-size:12.5px;color:var(--red)">Ошибка: ${esc(e.message)}</div>`; }
    });
  }

  function vRegistries() {
    const regs = window.SQ_SEED.REGISTRIES;
    page.innerHTML = `<div class="panel" style="padding:6px 18px 14px"><div class="section-t">Открытые реестры и базы данных РК · внешние ссылки</div>
      <p style="font-size:13px;color:var(--ink-2)">В демо живой интеграции с реестрами нет — это честно указано. Список нужен аналитику для ручной сверки; результат сверки фиксируется в карточке ЖК с источником и датой.</p>
      ${(regs || []).map((r) => `<div style="padding:8px 0;border-top:1px solid var(--line);font-size:13.5px"><a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.name)}</b></a><br><span style="color:var(--ink-2);font-size:12.5px">${esc(r.note)} · ${esc(r.url)}</span></div>`).join("")}</div>`;
  }

  function vAbout() {
    page.innerHTML = `<div class="panel" style="padding:18px 22px;max-width:80ch">
      <h3 style="font-family:var(--serif);margin:0 0 8px">SAQ QURYLYS · что это</h3>
      <p>Аналитическая система мониторинга рисков в объявлениях о долевом строительстве. Собирает сведения о ЖК, публикациях и проверках в одну карточку, считает объяснимый риск по фиксированным правилам и формирует проверяемый сигнал. Решение всегда принимает человек.</p>
      <div class="section-t">Архитектура</div>
      <p style="font-size:13.5px"><span style="font-family:var(--mono)">js/data.js</span> — seed (демо-данные) · <span style="font-family:var(--mono)">js/scoring.js</span> — детерминированный движок R1–R6 (ноль зависимостей, покрыт тестами) · <span style="font-family:var(--mono)">js/ai.js</span> — адаптер извлечения гипотез (real LLM при ключе, иначе меченая эвристика) · <span style="font-family:var(--mono)">js/app.js</span> — интерфейс и workflow · состояние — localStorage.</p>
      <div class="section-t">Ограничения (честно)</div>
      <ul style="font-size:13.5px"><li>Все компании, БИНы, адреса и документы вымышлены; совпадения случайны.</li><li>Нет живой интеграции с госреестрами, Telegram или парсингом — только ручной ввод и ссылки.</li><li>Без ключа AI работает меченая эвристика, а не языковая модель (кнопка «Настроить AI»).</li><li>Красная зона требует одновременно R1 и R2; неизвестность никогда не даёт баллов.</li></ul>
      <div class="section-t">Путь демонстрации (2–3 минуты)</div>
      <ol style="font-size:13.5px"><li>Обзор: фильтры зон, карта, сортировка по баллу.</li><li>Карточка SQ-002 (сценарий B): факторы, доказательства, журнал.</li><li>Новый анализ: вставить пример → гипотеза с цитатой → подтвердить → балл пересчитан.</li><li>Сигнальная карточка: подтвердить, печать/PDF.</li><li>Сценарии A·B·C: живые расчёты сошлись.</li></ol></div>`;
  }

  // ---------- topbar actions ----------
  const menuBtn = $("#btn-menu");
  if (menuBtn) menuBtn.onclick = () => {
    const open = document.body.classList.toggle("nav-open");
    menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
  };
  $("#nav").addEventListener("click", () => document.body.classList.remove("nav-open"));
  $("#btn-account").onclick = () => {
    const s = getSession();
    if (!s.name) {
      openModal(`<h3>Вход · тестовый доступ</h3>
        <p class="acct-meta">Настоящей авторизации в демо нет: сервера, паролей и личных кабинетов не существует. Укажите имя аналитика — оно будет подписывать решения в журнале. Ничего кроме имени не хранится.</p>
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
  $("#btn-reset").onclick = () => { if (confirm("Сбросить все подтверждения, объявления и сигналы к исходному демо?")) { localStorage.removeItem(LS_STATE); state = loadState(); nav("home"); toast("Демо-данные сброшены"); } };
  $("#btn-ai-config").onclick = () => {
    const c = window.SQ_AI.getConfig();
    openModal(`<h3>Подключение AI-модели</h3>
      <p style="font-size:13px;color:var(--ink-2)">OpenAI-совместимый endpoint (например, https://openrouter.ai/api/v1/chat/completions). Ключ хранится только в localStorage этого браузера и никуда не коммитится. Без ключа работает меченая DEMO-эвристика.</p>
      <label class="f">Endpoint<input type="text" id="ai-endpoint" value="${esc(c.endpoint || "https://openrouter.ai/api/v1/chat/completions")}"></label>
      <label class="f" style="margin-top:8px">Model<input type="text" id="ai-model" value="${esc(c.model || "")}" placeholder="например, vendor/model-name"></label>
      <label class="f" style="margin-top:8px">API key<input type="text" id="ai-key" value="${esc(c.apiKey || "")}" placeholder="оставьте пустым для demo-режима"></label>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="ai-save">Сохранить</button><button class="btn danger" id="ai-clear">Отключить AI</button><button class="btn" id="ai-cancel">Закрыть</button></div>`);
    $("#ai-cancel").onclick = closeModal;
    $("#ai-clear").onclick = () => { window.SQ_AI.saveConfig({}); closeModal(); render(); toast("AI отключён, demo-режим"); };
    $("#ai-save").onclick = () => {
      window.SQ_AI.saveConfig({ endpoint: $("#ai-endpoint").value.trim(), model: $("#ai-model").value.trim(), apiKey: $("#ai-key").value.trim() });
      closeModal(); render(); toast(window.SQ_AI.hasRealAI() ? "Real AI подключён" : "Сохранено (ключа нет — demo-режим)");
    };
  };

  try { const r0 = routeFromHash(window.location.hash); if (r0) state.route = r0; } catch {}
  refreshAccount();
  render();
})();
