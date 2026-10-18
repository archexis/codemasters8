<script lang="ts">
  import { onMount } from 'svelte';
  import type { AppState, Complex, Zone } from './lib/types';
  import type { Command } from './lib/domain';
  import { initialState, safeUrl } from './lib/domain';
  import { computeScore, zoneLabel, codes, WEIGHTS, FACTOR_META } from './lib/scoring';
  import { supabase, demoMode } from './lib/supabase';
  import { loadState, saveCommand, resetDemo, initializeWorkspace } from './lib/repository';
  import { detectPlatform, relatedAds, parseAdText } from './lib/parser';
  import seed from './lib/seed.json' with { type: 'json' };
  import RiskMap from './components/RiskMap.svelte';
  import Analyze from './components/Analyze.svelte';
  import Detail from './components/Detail.svelte';
  import ComplexForm from './components/ComplexForm.svelte';
  let workspace = $state<AppState>(demoMode ? initialState() : { complexes: [], ads: [], media: [], signals: {}, audit: [] });
  const readRoute = () => location.hash.startsWith('#/') ? location.hash.slice(2) : 'home';
  let route = $state(readRoute());
  let loading = $state(true); let error = $state(''); let notice = $state('');
  let menu = $state(false); let authOpen = $state(false); let email = $state(''); let password = $state(''); let reviewer = $state(demoMode ? 'Демо-аналитик' : ''); let authBusy = $state(false);
  let query = $state(''); let zone = $state<Zone | 'all'>('all'); let platform = $state('all'); let creating = $state(false);
  let quick = $state(''); let quickResult = $state('');
  const baseRoute = $derived(route.split('?')[0]);
  const page = $derived(/^[a-z]+(?:\/[A-Za-z0-9-]+)?$/.test(baseRoute) ? baseRoute.split('/')[0] : 'missing');
  const zkId = $derived(baseRoute.split('/')[1] || '');
  const selected = $derived(workspace.complexes.find(z => z.id === zkId));
  const titles: Record<string,string> = { home: 'Главная', overview: 'Объекты', ads: 'Публикации', analyze: 'Проверка', registries: 'Реестры', detail: 'Карточка объекта', signal: 'Сигнал' };
  const shown = $derived(workspace.complexes.filter(z => `${z.id} ${z.name} ${z.address} ${z.developer} ${z.bin || ''}`.toLowerCase().includes(query.toLowerCase()) && (zone === 'all' || computeScore(z.factors).zone === zone)).sort((a,b) => computeScore(b.factors).score - computeScore(a.factors).score));
  const counts = $derived({ red: workspace.complexes.filter(z => computeScore(z.factors).zone === 'red').length, yellow: workspace.complexes.filter(z => computeScore(z.factors).zone === 'yellow').length, green: workspace.complexes.filter(z => computeScore(z.factors).zone === 'green').length });
  $effect(() => { document.title = `${titles[page] || 'Страница не найдена'} · SAQ QURYLYS`; });
  async function reload() { loading = true; error = ''; try { workspace = await loadState(); } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { loading = false; } }
  onMount(() => {
    const update = () => { route = readRoute(); menu = false; creating = false; window.scrollTo(0,0); };
    window.addEventListener('hashchange', update);
    void reload();
    const listener = supabase?.auth.onAuthStateChange((_event, session) => {
      reviewer = session?.user.email || '';
      // Defer network calls outside the auth callback to avoid the SDK lock.
      setTimeout(() => { if (session) void reload(); else { workspace = { complexes: [], ads: [], media: [], signals: {}, audit: [] }; loading = false; } }, 0);
    });
    return () => { window.removeEventListener('hashchange', update); listener?.data.subscription.unsubscribe(); };
  });
  async function commit(command: Command) { workspace = await saveCommand($state.snapshot(workspace), $state.snapshot(command), reviewer); notice = 'Изменения сохранены'; }
  async function auth(signup: boolean) {
    if (!supabase) return; authBusy = true; error = ''; notice = '';
    try {
      const { data, error: err } = signup ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } }) : await supabase.auth.signInWithPassword({ email, password });
      if (err) throw err;
      if (signup && !data.session) notice = 'Подтвердите email по ссылке из письма.';
      authOpen = false; password = '';
    } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { authBusy = false; }
  }
  async function initialize() { try { workspace = await initializeWorkspace(); } catch (e) { error = String(e); } }
  async function reset() { try { workspace = await resetDemo(); error = ''; notice = 'Демоданные сброшены'; } catch (e) { error = String(e); } }
  async function exportApi() {
    try {
      const { data } = await supabase!.auth.getSession();
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'}/api/export`, { headers: { Authorization: `Bearer ${data.session?.access_token}` }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`API: ${response.status}`);
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = 'saq-workspace.json'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { error = String(e); }
  }
</script>
<svelte:window onkeydown={e => { if (e.key === 'Escape') { authOpen = false; menu = false; } }}/>
<header class="topbar no-print"><a class="brand" href="#/home"><span class="brand-symbol">S</span><span>SAQ QURYLYS<small>САҚ · МОНИТОРИНГ РИСКОВ</small></span></a><button class="mobile-menu" aria-expanded={menu} aria-controls="navigation" onclick={() => menu = !menu}>Меню</button><nav id="navigation" class:open={menu} aria-label="Основная навигация">{#each ['home','overview','ads','analyze','registries'] as key}<a href="#/{key}" class:active={page === key} aria-current={page === key ? 'page' : undefined}>{titles[key]}</a>{/each}</nav><div class="account"><span class="mode-dot"></span><button class="small" onclick={() => authOpen = !authOpen}>{reviewer || 'Войти'}</button></div></header>
<div class="status-strip no-print"><span>{demoMode ? 'ДЕМО · данные хранятся в этом браузере' : 'SUPABASE · персональное рабочее пространство'}</span><span>Өскемен / Усть-Каменогорск</span></div>
{#if authOpen}<section class="auth-panel no-print"><h2>{demoMode ? 'Демонстрационный сеанс' : 'Supabase Auth'}</h2>{#if demoMode}<p>Демо-аналитик. Для серверного входа задайте Supabase URL и публичный ключ в .env.</p><button onclick={reset}>Сбросить демо</button>{:else if reviewer}<p>{reviewer}</p><div class="actions"><button onclick={async () => { await supabase!.auth.signOut(); authOpen = false; }}>Выйти</button><button onclick={exportApi}>Экспорт через API</button></div>{:else}<form onsubmit={e => { e.preventDefault(); void auth(false); }} class="space-y-3"><label>Email<input type="email" autocomplete="username" required bind:value={email}/></label><label>Пароль<input type="password" autocomplete="current-password" minlength="8" required bind:value={password}/></label><div class="actions"><button class="primary" disabled={authBusy}>Войти</button><button type="button" disabled={authBusy || !email || password.length < 8} onclick={() => auth(true)}>Зарегистрироваться</button></div></form>{/if}<button class="small mt-3" onclick={() => authOpen = false}>Закрыть</button></section>{/if}
<main>
  {#if error}<div class="error mb-5" role="alert">{error}<button class="small ml-3" onclick={reload}>Повторить загрузку</button></div>{/if}
  {#if notice}<div class="notice no-print mb-5" role="status">{notice}<button class="small ml-3" onclick={() => notice = ''}>Закрыть</button></div>{/if}
  {#if loading}<p role="status">Загрузка рабочего пространства…</p>
  {:else if !demoMode && !reviewer}<section class="panel"><h1>Рабочее пространство аналитика</h1><p class="muted my-4">Войдите, чтобы загрузить объекты и решения из Supabase.</p><button class="primary" onclick={() => authOpen = true}>Войти в систему</button></section>
  {:else if !demoMode && !workspace.complexes.length}<section class="panel"><h1>Начните работу</h1><p class="my-4">Создайте объект или загрузите демонстрационные сценарии в своё пространство.</p><div class="actions"><button onclick={initialize}>Загрузить демоданные</button><button onclick={() => creating = true}>Создать объект</button></div>{#if creating}<ComplexForm onsave={async z => { await commit({ type: 'complex', complex: z }); creating = false; }} oncancel={() => creating = false}/>{/if}</section>
  {:else if page === 'home'}
    <section class="hero"><div><p class="eyebrow">АНАЛИТИЧЕСКАЯ СИСТЕМА / ӨСКЕМЕН</p><h1>Видеть риски.<br/><em>Действовать вовремя.</em></h1><p class="hero-copy">От публикации о продаже квартиры — к проверяемому сигналу. Источники, факты и решения в одном рабочем пространстве.</p><div class="actions"><a class="button primary" href="#/overview">Открыть мониторинг ↗</a><a class="button" href="#/analyze">Проверить объявление</a></div><p class="muted text-xs mt-6">Решение принимает человек. Система не устанавливает факт правонарушения.</p></div><aside class="hero-summary"><p class="eyebrow">СВОДКА РИСКОВ</p><div class="summary-total">{workspace.complexes.length}<span>объектов<br/>в мониторинге</span></div>{#each ['red', 'yellow', 'green'] as color}{@const c = color as Zone}<div class="zone-stat"><span class="dot {c}"></span><span>{zoneLabel(c)} зона</span><b>{counts[c]}</b></div>{/each}<p class="text-xs muted mt-5">Нулевой балл означает отсутствие подтверждённых факторов, а не доказанную безопасность.</p></aside></section>
    <div class="workflow"><span><b>01</b> Публикация</span><i>→</i><span><b>02</b> Анализ и источники</span><i>→</i><span><b>03</b> Решение аналитика</span><i>→</i><span><b>04</b> Сигнал</span></div>
    <form class="panel mt-8 space-y-4" onsubmit={e => { e.preventDefault(); quickResult = parseAdText(quick).payment.flagged ? 'Найден платёжный признак — нужна проверка аналитика.' : 'Платёжный признак не обнаружен. Это не подтверждает безопасность.'; }}><h2>Попробуйте прямо сейчас</h2><label>Быстрая проверка фразы<input required maxlength="20000" bind:value={quick} placeholder="Бронь квартиры — 500 000 тенге"/></label><div class="actions"><button>Проверить фразу</button><a class="button" href="#/analyze?text={encodeURIComponent(quick)}">К полной проверке ↗</a></div>{#if quickResult}<p role="status">{quickResult}</p>{/if}</form>
    <div class="page-heading mt-12"><div><p class="eyebrow">ПРИОРИТЕТ ПРОВЕРКИ</p><h2>Объекты, требующие внимания</h2></div><a href="#/overview">Все объекты ↗</a></div><div class="cards">{#each shown.slice(0,3) as z}{@const s = computeScore(z.factors)}<a class="panel complex-card" href="#/detail/{z.id}"><span class="badge {s.zone}">{s.score} · {zoneLabel(s.zone)}</span><h3>{z.name}</h3><p class="muted">{z.address}</p><p class="text-xs mt-4">{z.demo ? 'DEMO · вымышленный объект' : 'Публичный снимок · 15.10.2026'}</p></a>{/each}</div>
    <div class="two-col mt-8"><section class="panel"><h2>Объяснимый скоринг</h2>{#each codes as c}<div class="factor-row"><span><b>{c}</b> {FACTOR_META[c].title}</span><b>+{WEIGHTS[c]}</b></div>{/each}<p class="muted text-xs mt-4">Красная зона: ≥60 и одновременно подтверждены R1 + R2. Гипотезы баллов не дают.</p></section><section class="panel"><h2>Контрольные сценарии</h2>{#each [{id:'SQ-001',label:'A',value:35},{id:'SQ-002',label:'B',value:70},{id:'SQ-003',label:'C',value:10}] as example}{@const z = workspace.complexes.find(z => z.id === example.id)}{#if z}<a class="scenario" href="#/detail/{z.id}"><b>{example.label}</b><span>{z.name}<small>Исходный балл: {example.value}</small></span><strong>{computeScore(z.factors).score}</strong></a>{/if}{/each}<details class="mt-6"><summary>Как работать с системой?</summary><p class="muted mt-3">Сверьте основание в реестрах, проанализируйте публикацию, проверьте цитаты и подтвердите факторы. Затем сформируйте сигнальную карточку и распечатайте её.</p></details></section></div>
    <section class="panel mt-8"><h2>Последние решения</h2>{#if !workspace.audit.length}<p class="muted">Новых решений в этом пространстве пока нет.</p>{/if}{#each workspace.audit.slice(0,5) as event}<div class="timeline-row"><span>{new Date(event.at).toLocaleDateString('ru-RU')}</span><a href="#/detail/{event.zkId}">{event.zkId} · {event.action} · {event.reviewer}</a></div>{/each}</section>
  {:else if page === 'overview'}
    <div class="page-heading"><div><p class="eyebrow">ТЕРРИТОРИАЛЬНЫЙ МОНИТОРИНГ</p><h1>Объекты строительства</h1></div><button class="primary" onclick={() => creating = !creating}>Добавить объект</button></div>
    {#if creating}<ComplexForm onsave={async z => { await commit({ type: 'complex', complex: z }); creating = false; }} oncancel={() => creating = false}/>{/if}
    <div class="filters"><label class="grow">Поиск<input type="search" placeholder="Название, адрес, застройщик, БИН" bind:value={query}/></label><label>Зона риска<select bind:value={zone}><option value="all">Все зоны</option><option value="red">Красная</option><option value="yellow">Жёлтая</option><option value="green">Зелёная</option></select></label><span class="muted">Найдено: {shown.length}</span></div>
    <RiskMap complexes={shown}/><div class="table-scroll panel mt-6"><table><thead><tr><th>Объект / адрес</th><th>Застройщик</th><th>Риск</th><th>Основание</th></tr></thead><tbody>{#each shown as z}{@const s = computeScore(z.factors)}<tr><td><a href="#/detail/{z.id}"><b>{z.name}</b></a><small>{z.id} · {z.demo ? 'DEMO' : z.origin === 'manual' ? 'Ручной ввод' : 'Публичный снимок'}</small><small>{z.address}</small></td><td>{z.developer}</td><td><span class="badge {s.zone}">{s.score} · {zoneLabel(s.zone)}</span></td><td>{z.legalBasis.status === 'verified' ? 'Подтверждено' : z.legalBasis.status === 'absent-verified' ? 'Отсутствие проверено' : 'Нужна проверка'}</td></tr>{/each}</tbody></table>{#if !shown.length}<p class="p-6 muted">Объекты не найдены.</p>{/if}</div>
  {:else if page === 'analyze'}{#key route}<Analyze {workspace} {zkId} {commit} initialText={new URLSearchParams(route.split('?')[1] || '').get('text') || ''}/>{/key}
  {:else if page === 'detail' || page === 'signal'}{#if selected}{#key route}<Detail {workspace} complex={selected} {commit} signal={page === 'signal'}/>{/key}{:else}<h1>Объект не найден</h1><a href="#/overview">Вернуться к объектам</a>{/if}
  {:else if page === 'ads'}
    <div class="page-heading"><div><p class="eyebrow">РУЧНОЙ СБОР · ПРОВЕРЯЕМЫЕ ИСТОЧНИКИ</p><h1>Публикации</h1></div><a class="button primary" href="#/analyze">Добавить публикацию</a></div><label class="mb-6 max-w-sm">Площадка<select bind:value={platform}><option value="all">Все площадки</option>{#each [...new Set(workspace.ads.map(a => detectPlatform(a).label))] as p}<option>{p}</option>{/each}</select></label>
    <div class="cards">{#each workspace.ads.filter(a => platform === 'all' || detectPlatform(a).label === platform) as ad}<article class="panel"><p class="eyebrow">{detectPlatform(ad).label} · {ad.date}</p><p class="my-4">{ad.text}</p><a href="#/detail/{ad.zkId}">{workspace.complexes.find(z => z.id === ad.zkId)?.name || ad.zkId} ↗</a><p class="muted text-xs mt-3">{ad.id} · {ad.account} · {ad.decision || 'Исходный снимок'}</p>{#if safeUrl(ad.url)}<a class="text-xs" href={safeUrl(ad.url)} target="_blank" rel="noopener noreferrer">Источник ↗</a>{/if}{#each relatedAds(ad, workspace.ads).slice(0,3) as related}<p class="text-xs mt-2">Связь: {related.id} · {related.via}</p>{/each}</article>{/each}</div>
  {:else if page === 'registries'}
    <div class="page-heading"><div><p class="eyebrow">ПЕРВОИСТОЧНИКИ / РЕСПУБЛИКА КАЗАХСТАН</p><h1>Реестры и источники</h1></div></div><p class="muted mb-6">Ручная сверка. Ссылки не означают автоматическую интеграцию. Дата последней исходной проверки — 15.10.2026.</p><div class="cards">{#each seed.REGISTRIES as registry}<a class="panel registry" href={safeUrl(registry.url)} target="_blank" rel="noopener noreferrer"><span>↗</span><h3>{registry.name}</h3><p class="muted text-sm mt-3">{registry.note}</p></a>{/each}</div>
  {:else}<section class="panel"><h1>Страница не найдена</h1><a href="#/home">На главную</a></section>{/if}
</main>
<footer class="no-print"><b>SAQ QURYLYS</b><p>Признаки → доказательства → решение человека</p><span>Codemasters 8.0 · {demoMode ? 'DEMO' : 'Supabase'}</span></footer>
