<script lang="ts">
  import { trackAuthSession, getSessionUser } from './lib/repository';
  import { onMount } from 'svelte';
  import type { AppState } from './lib/types';
  import type { Command } from './lib/domain';
  import { initialState } from './lib/domain';
  import { computeScore } from './lib/scoring';
  import { supabase, demoMode } from './lib/supabase';
  import { loadState, saveCommand, resetDemo, initializeWorkspace, StaleConflictError } from './lib/repository';
  import {parseSignalRevision, signalRevisionError} from './lib/signal-revision';
  import { buildExport, exportFilename } from './lib/export';
  import RiskMap from './components/RiskMap.svelte';
  import Detail from './components/Detail.svelte';
  import ComplexForm from './components/ComplexForm.svelte';
  import BackupPanel from './components/BackupPanel.svelte';
  import Publications from './components/Publications.svelte';
  import RegistryCatalog from './components/RegistryCatalog.svelte';
  import ComplexDossier from './components/ComplexDossier.svelte';
  import {normalizedRoute, dossierTabs, type DossierTab} from './lib/navigation';
  import {dossierReadModel} from './lib/read-models';
  let workspace = $state<AppState>(initialState());
  const readRoute = () => normalizedRoute(location.hash);
  let route = $state(readRoute());
  let loading = $state(true); let error = $state(''); let notice = $state('');
  let menu = $state(false); let authOpen = $state(false); let email = $state(''); let password = $state(''); let reviewer = $state('Демо-аналитик'); let authBusy = $state(false);
  let creating = $state(false);
  const baseRoute = $derived(route.split('?')[0]);
  const page = $derived(/^[a-z]+(?:\/[A-Za-z0-9-]+)?$/.test(baseRoute) ? baseRoute.split('/')[0] : 'missing');
  const routeId = $derived(baseRoute.split('/')[1] || '');
  const selectedCase = $derived(page==='cases' ? workspace.cases?.find(c=>c.id===routeId) : undefined);
  const zkId = $derived(selectedCase?.complexId ?? routeId);
  const params = $derived(new URLSearchParams(route.split('?')[1] || ''));
  const phaseId = $derived(page==='cases' ? selectedCase?.phaseId : params.get('phase') ?? undefined);
  const activeTab = $derived((dossierTabs.some(t=>t.id===params.get('tab')) ? params.get('tab') : 'overview') as DossierTab);
  const plainWorkspace = $derived($state.snapshot(workspace));
  const scopedWorkspace = $derived({...plainWorkspace,complexes:plainWorkspace.complexes.map(z=>({...z,factors:dossierReadModel(plainWorkspace,z.id).factors}))});
  const exportRevision = $derived(parseSignalRevision(route.split('?')[1] || '') ?? undefined);
  const exportRevisionError = $derived(signalRevisionError(workspace,zkId,exportRevision ?? null));
  const selected = $derived(workspace.complexes.find(z => z.id === zkId));
  const titles: Record<string,string> = { map:'Карта',publications:'Публикации',complexes:'Досье',cases:'Расследование',home: 'Главная', overview: 'Объекты', ads: 'Публикации', analyze: 'Проверка', registries: 'Реестры', detail: 'Карточка объекта', signal: 'Сигнал', backup: 'Резервная копия', export: 'Экспорт' };
  const shown = $derived([...scopedWorkspace.complexes].sort((a,b) => computeScore(b.factors).score - computeScore(a.factors).score));
  $effect(() => { document.title = `${titles[page] || 'Страница не найдена'} · SAQ QURYLYS`; });
  let reloadGeneration = 0;
  async function reload() { const generation = ++reloadGeneration; loading = true; error = ''; try { const state = await loadState(); if (generation === reloadGeneration) workspace = state; } catch (e) { if (generation === reloadGeneration) error = e instanceof Error ? e.message : String(e); } finally { if (generation === reloadGeneration) loading = false; } }
  onMount(() => {
    const update = () => { route = readRoute(); menu = false; creating = false; window.scrollTo(0,0); };
    window.addEventListener('hashchange', update);
    void reload();
    const listener = supabase?.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user.id ?? null;
      const changedUser = getSessionUser() !== nextUser;
      trackAuthSession(nextUser);
      if (_event === 'TOKEN_REFRESHED' && !changedUser) {
        reviewer = session?.user.email || 'Демо-аналитик';
        return;
      }
      reloadGeneration++;
      if (changedUser) {
        workspace = { schemaVersion: 3, complexes: [], ads: [], media: [], signals: {}, signalVersions: {}, audit: [] };
        error = ''; notice = '';
      }
      reviewer = session?.user.email || 'Демо-аналитик';
      // Defer network calls outside the auth callback to avoid the SDK lock.
      // Без сессии — DEMO-конверт (loadState), рабочее место не блокируется.
      setTimeout(() => { void reload(); }, 0);
    });
    return () => { window.removeEventListener('hashchange', update); listener?.data.subscription.unsubscribe(); };
  });
  async function commit(command: Command) {
    try { workspace = await saveCommand($state.snapshot(workspace), $state.snapshot(command), reviewer); notice = 'Изменения сохранены'; }
    catch (e) { if (e instanceof StaleConflictError) workspace = e.serverState; throw e; }
  }
  // Регистрации нет: вход только по выданной оператору учётной записи
  // (временные аккаунты connected-режима). По умолчанию — DEMO без логина.
  async function auth() {
    if (!supabase) return; authBusy = true; error = ''; notice = '';
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) throw err;
      authOpen = false; password = '';
    } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { authBusy = false; }
  }
  async function initialize() { try { workspace = await initializeWorkspace(); } catch (e) { error = String(e); } }
  async function reset() { try { workspace = await resetDemo(); error = ''; notice = 'Демоданные сброшены'; } catch (e) { error = String(e); } }
  // S4.4. Скачивание сигнальной карточки (signal-card/v1): только
  // confirmed+grounded evidence, reason отдельно, без signed URL.
  function downloadSignalExport() {
    if (!selected) return;
    try {
      const exp = buildExport($state.snapshot(workspace), selected.id, exportRevision);
      const blob = new Blob([JSON.stringify(exp, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = exportFilename(selected.id, exp.kind); a.click();
      URL.revokeObjectURL(url); notice = 'Сигнальная карточка скачана';
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
  }
  async function exportApi() {
    try {
      const { data } = await supabase!.auth.getSession();
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'}/api/export`, { headers: { Authorization: `Bearer ${data.session?.access_token}` }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`API: ${response.status}`);
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = 'saq-workspace.json'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { error = String(e); }
  }
</script>
<svelte:window onkeydown={e => { if (e.key === 'Escape') { authOpen = false; menu = false; } }}/><a class="skip-link" href="#main">К содержанию</a>
<header class="topbar no-print"><a class="brand" href="#/map"><span class="brand-symbol">S</span><span>SAQ QURYLYS<small>реестр рисков долевого строительства · демо</small></span></a><button class="mobile-menu" aria-expanded={menu} aria-controls="navigation" onclick={() => menu = !menu}>Меню</button><nav id="navigation" class:open={menu} aria-label="Основная навигация"><a href="#/map" class:active={page === 'map'} aria-current={page==='map'?'page':undefined}><span class="sec-no">01</span>Карта</a><a href="#/publications" class:active={page === 'publications' || page === 'analyze'} aria-current={page==='publications'?'page':undefined}><span class="sec-no">02</span>Публикации</a><a href="#/registries" class:active={page === 'registries'} aria-current={page==='registries'?'page':undefined}><span class="sec-no">03</span>Реестры</a></nav><div class="account"><span class="mode-dot"></span><button class="small" onclick={() => authOpen = !authOpen}>{reviewer || 'Войти'}</button></div></header>
<div class="status-strip no-print"><span>{demoMode ? 'Демо-данные · хранятся в этом браузере' : 'Вы вошли · ваше рабочее место'}</span><span>Өскемен — Усть-Каменогорск</span></div>
{#if authOpen}<section class="auth-panel no-print"><h2>{demoMode ? 'Демонстрационный сеанс' : 'Вход оператора'}</h2>{#if demoMode}<p>Демо-аналитик. Данные хранятся в этом браузере.</p><button onclick={reset}>Сбросить демо</button>{:else if reviewer !== 'Демо-аналитик'}<p>{reviewer}</p><div class="actions"><button onclick={async () => { await supabase!.auth.signOut(); authOpen = false; }}>Выйти</button><button onclick={exportApi}>Экспорт через API</button></div>{:else}<form onsubmit={e => { e.preventDefault(); void auth(); }} class="space-y-3"><label>Email<input type="email" autocomplete="username" required bind:value={email}/></label><label>Пароль<input type="password" autocomplete="current-password" minlength="8" required bind:value={password}/></label><button class="primary" disabled={authBusy}>Войти</button></form>{/if}<div class="actions mt-4"><a class="button small" href="#/backup" onclick={()=>authOpen=false}>Резервная копия</a><button class="small" onclick={() => authOpen = false}>Закрыть</button></div></section>{/if}
<main id="main">
{#if error}<div class="error mb-5" role="alert">{error}<button class="small ml-3" onclick={reload}>Повторить загрузку</button></div>{/if}
{#if notice}<div class="notice no-print mb-5" role="status">{notice}<button class="small ml-3" onclick={() => notice = ''}>Закрыть</button></div>{/if}
{#if loading}<p role="status">Загрузка рабочего пространства…</p>
{:else if page==='map'}
<div class="map-page"><RiskMap complexes={shown} ads={workspace.ads} geometry={workspace.geometries??[]} relations={(workspace.relations??[]).filter(r=>r.fromId.startsWith('complex:')&&r.toId.startsWith('complex:')).map(r=>({fromId:r.fromId.slice(8),toId:r.toId.slice(8),verified:r.verificationStatus==='verified'}))}/></div>
{:else if page==='publications'||page==='analyze'}
<div class="pub-page"><Publications {workspace} {commit} adding={page==='analyze'||params.has('add')} initialText={params.get('text')||''} complexId={page==='analyze'?zkId:params.get('complex')||''}/></div>
{:else if page==='registries'}<RegistryCatalog workspace={scopedWorkspace} {commit}/>
{:else if page==='complexes'||page==='cases'}
{#if selected&&(page!=='cases'||selectedCase)&&(!phaseId||workspace.phases?.some(p=>p.id===phaseId&&p.complexId===zkId))}
{#key `${zkId}-${phaseId??''}-${selectedCase?.id??''}`}<ComplexDossier {workspace} complexId={zkId} {phaseId} caseId={selectedCase?.id} tab={activeTab} evidenceId={params.get('evidence')||''} {commit}/>{/key}
{:else}<section class="panel"><h1>Досье не найдено</h1><p>Объект, очередь или дело недоступны в текущем рабочем пространстве.</p><a class="button mt-4" href="#/registries">К реестрам</a></section>{/if}
{:else if page==='signal'}{#if selected}<Detail {workspace} complex={selected} {commit} signal/>{/if}
{:else if page==='backup'}<h1 class="mb-5">Резервная копия</h1><BackupPanel {workspace} onRestoreDone={s=>{workspace=s;notice='Данные восстановлены. Решения требуют повторной проверки.';}}/>
{:else if page==='export'}{#if selected}<section class="panel"><h1>Экспорт исторического сигнала</h1>{#if exportRevisionError}<p role="alert">{exportRevisionError}</p>{:else}<button class="mt-5" onclick={downloadSignalExport}>Скачать JSON</button>{/if}</section>{/if}
{:else}<section class="panel"><h1>Страница не найдена</h1><a href="#/map">Открыть карту</a></section>{/if}
{#if !loading&&!workspace.complexes.length}<section class="panel mt-5"><h2>Начните работу</h2><div class="actions"><button onclick={initialize}>Загрузить демоданные</button><button onclick={()=>creating=true}>Создать объект</button></div>{#if creating}<ComplexForm onsave={async complex=>{await commit({type:'complex',complex});creating=false;}} oncancel={()=>creating=false}/>{/if}</section>{/if}
</main>
<footer class="no-print"><b>SAQ QURYLYS</b><span>Решение принимает человек. Система не устанавливает факт правонарушения.</span></footer>
