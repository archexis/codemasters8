<script lang="ts">
  import type { AppState, Code, Complex, Factor, InvestigationCase } from '../lib/types';
  import { scoreBreakdown, FACTOR_META, RISK_DESCRIPTOR, zoneLabel } from '../lib/scoring';
  import { latestCaseAssertions } from '../lib/investigation';
  import { safeUrl } from '../lib/domain';
  import { artifactKindLabel, decisionTime, legalBasisLabel } from '../lib/presentation';
  import SourceText from './SourceText.svelte';

  let { workspace, complex, assessmentCase, selectedCode, backUrl, scoreUrl, evidenceUrl }: {
    workspace: AppState; complex: Complex; assessmentCase?: InvestigationCase; selectedCode?: Code;
    backUrl: string; scoreUrl: (code: Code | 'all') => string; evidenceUrl: (id: string) => string;
  } = $props();
  const breakdown = $derived(scoreBreakdown(complex.factors));
  const assertions = $derived(assessmentCase ? latestCaseAssertions(workspace, assessmentCase.id) : []);
  const components = $derived(breakdown.components.filter(c => !selectedCode || c.code === selectedCode));
  const statusLabel = (status: Factor['status']) => ({ confirmed: 'Факт подтверждён', hypothesis: 'Гипотеза', rejected: 'Факт отклонён', 'needs-verification': 'Требует проверки' })[status];

  function trace(factor: Factor) {
    const evidence = factor.evidence;
    const assertion = assertions.find(a => a.code === factor.code && a.evidence.id === evidence?.id);
    const claim = assertion ? workspace.claims?.find(c => c.id === assertion.claimId) : undefined;
    const artifact = claim ? workspace.artifacts?.find(a => a.id === claim.artifactId && a.complexId === complex.id && a.phaseId === assessmentCase?.phaseId) : undefined;
    const adId = evidence?.adId ?? artifact?.adId;
    const ad = adId ? workspace.ads.find(a => a.id === adId && a.zkId === complex.id) : undefined;
    return { assertion, claim, artifact, ad, url: safeUrl(artifact?.url || ad?.url || '') };
  }
</script>

<section class="score-explanation" aria-label="Расшифровка баллов">
  <a class="score-back" href={backUrl}>← Вернуться к досье</a>
  <div class="score-detail-heading">
    <div><p class="eyebrow">РАСЧЁТ РИСКА · ВЕРСИЯ {breakdown.version}</p><h2>{selectedCode ? `${selectedCode} · ${FACTOR_META[selectedCode].title}` : 'Откуда взялись баллы'}</h2></div>
    <a class="button small" href={scoreUrl('all')}>Весь расчёт · {breakdown.score} / 100</a>
  </div>
  {#if complex.demo}<p class="notice mb-4">DEMO · Материалы, факты и оценки этого сценария вымышлены.</p>{/if}
  <section class="panel score-calculation" aria-label="Расчёт итогового балла">
    <p class="eyebrow">{zoneLabel(breakdown.zone)} зона</p>
    <p class="score-equation"><strong>{breakdown.score}</strong><span>= {breakdown.components.map(c => c.counted ? c.weight : 0).join(' + ')}</span></p>
    <div class="score-components">{#each breakdown.components as part}<a class:counted={part.counted} class:chosen={selectedCode === part.code} href={scoreUrl(part.code)} aria-current={selectedCode === part.code ? 'page' : undefined}>{part.code}<b>+{part.counted ? part.weight : 0}</b></a>{/each}</div>
    <p class="muted mt-4">Вес каждого подтверждённого признака учитывается один раз, даже если его подтверждают несколько материалов. Максимум — 100 баллов.</p>
    <details class="mt-4"><summary>Как определяется зона риска</summary><ul class="score-zone-rules"><li>Красная: от 60 баллов и одновременно подтверждены R1 и R2.</li><li>Жёлтая: от 25 баллов, если условия красной зоны не выполнены.</li><li>Зелёная: менее 25 баллов.</li></ul></details>
    <p class="muted mt-4">Оценка: {assessmentCase ? `дело ${assessmentCase.id}` : 'исходные факты досье'}. {assessmentCase?.period ? `Период: ${assessmentCase.period.from} — ${assessmentCase.period.to || 'открытый'}.` : 'Период применимости не установлен.'}</p>
  </section>

  {#each components as part}
    {@const factors = complex.factors.filter(f => f.code === part.code)}
    <article class="panel score-factor-detail" aria-label={`Расшифровка ${part.code}`}>
      <div class="score-factor-heading"><h3>{part.code} · {FACTOR_META[part.code].title}</h3><strong>+{part.counted ? part.weight : 0}</strong></div>
      <p class="muted">{FACTOR_META[part.code].hint}</p>
      <section class="risk-descriptor" aria-label={`Дескриптор риска ${part.code}`}>
        <p class="eyebrow">Дескриптор риска · что это значит</p>
        <dl>
          <dt>Что означает</dt><dd>{RISK_DESCRIPTOR[part.code].meaning}</dd>
          <dt>Чем опасно</dt><dd>{RISK_DESCRIPTOR[part.code].risk}</dd>
          <dt>Что проверить</dt><dd>{RISK_DESCRIPTOR[part.code].check}</dd>
          <dt>Что делать</dt><dd>{RISK_DESCRIPTOR[part.code].action}</dd>
        </dl>
      </section>
      <p class="score-rule">{part.counted ? `Начислено ${part.weight} баллов: есть подтверждённый факт.` : `Начислено 0 из ${part.weight} баллов: подтверждённого факта нет.`}</p>
      {#if !factors.length}<p class="notice">Проверка этого признака ещё не зафиксирована. Для начисления нужны первоисточник и подтверждение конкретного факта аналитиком.</p>{/if}
      {#each factors as factor}
        {@const evidence = factor.evidence}
        {@const source = trace(factor)}
        <section class="score-evidence" aria-label="Основание оценки">
          <p class="eyebrow">{statusLabel(factor.status)}{factor.status !== 'confirmed' ? ' · БАЛЛЫ НЕ НАЧИСЛЕНЫ' : ''}</p>
          <h4>1. Источник</h4>
          <dl><dt>Материал</dt><dd>{evidence?.source || 'Источник не указан'}</dd><dt>Тип</dt><dd>{evidence ? artifactKindLabel(evidence.kind) : 'Не указан'}</dd><dt>Дата доказательства</dt><dd>{evidence?.date || 'Не указана'}</dd>{#if source.ad}<dt>Публикация</dt><dd>{source.ad.platform} · {source.ad.account || 'Аккаунт неизвестен'} · {source.ad.date || 'Дата публикации неизвестна'}</dd>{/if}</dl>
          <div class="actions mt-3">{#if source.artifact}<a class="button small" href={evidenceUrl(source.artifact.id)}>Открыть материал в досье</a>{/if}{#if source.url}<a class="button small" href={source.url} target="_blank" rel="noopener noreferrer">Открыть первоисточник ↗</a>{/if}</div>
          <h4>2. Что найдено в материале</h4>
          {#if evidence?.quote || source.claim?.quote}<blockquote>{evidence?.quote || source.claim?.quote}</blockquote>{/if}
          {#if evidence?.text}<p class="score-source-text">{evidence.text}</p>{/if}
          {#if !evidence?.quote && !source.claim?.quote && !evidence?.text}<p class="muted">Цитата и содержание доказательства не сохранены.</p>{/if}
          {#if source.artifact || source.ad}<details class="mt-3"><summary>Полный сохранённый текст</summary><SourceText text={source.artifact?.text || source.ad?.text || ''} quote={evidence?.quote || source.claim?.quote || ''}/></details>{/if}
          {#if evidence?.beforeCommissioning}<div class="notice mt-3"><b>Подтверждение состояния до ввода</b><p>{evidence.beforeCommissioning.source} · {evidence.beforeCommissioning.date}</p><p>{evidence.beforeCommissioning.text}</p></div>{/if}
          {#each evidence?.mediaIds ?? [] as id}{@const media = workspace.media.find(m => m.id === id && m.zkId === complex.id)}{#if media}<p class="muted mt-2">Приложение: {media.name} · {media.date || 'Дата неизвестна'}</p>{/if}{/each}
          <h4>3. Как проверен факт</h4>
          <dl><dt>Результат</dt><dd>{statusLabel(factor.status)}</dd><dt>Проверил / зафиксировал</dt><dd>{factor.reviewer || 'Автор не указан'}</dd><dt>Дата решения</dt><dd>{decisionTime(factor.updatedAt)}</dd></dl>
          {#if source.assertion}<p class="mt-3"><b>Обоснование аналитика:</b> {source.assertion.comment}</p>{:else}<p class="muted mt-3">Отдельное обоснование проверки в исходной записи не сохранено.</p>{/if}
          {#if source.claim?.runId || evidence?.runId}<details class="mt-3"><summary>Происхождение AI-гипотезы</summary><p class="muted mt-2">AI предложил гипотезу; баллы зависят от проверки факта человеком.</p>{#if source.claim?.reason}<p>{source.claim.reason}</p>{/if}<dl><dt>Запуск</dt><dd>{source.claim?.runId || evidence?.runId}</dd><dt>Гипотеза</dt><dd>{source.claim?.hypothesisId || evidence?.hypothesisId || 'Не указана'}</dd></dl></details>{/if}
          {#if evidence?.id}<p class="muted text-xs mt-4">Запись доказательства: {evidence.id}{source.assertion ? ` · Решение: ${source.assertion.id}` : ''}</p>{/if}
        </section>
      {/each}
      {#if part.code === 'R1'}<details class="mt-4"><summary>Сведения о законном основании</summary><p class="mt-3">{legalBasisLabel(complex.legalBasis.type)} · {complex.legalBasis.source || 'Источник неизвестен'} · {complex.legalBasis.checkedAt || 'Дата неизвестна'}</p><p>{complex.legalBasis.reviewText || 'Результат сверки не записан.'}</p></details>{/if}
      {#if part.code === 'R5'}<details class="mt-4"><summary>Значения готовности и источники</summary><p class="mt-3">Заявлено: {complex.readinessClaimed == null ? 'неизвестно' : `${complex.readinessClaimed}%`}. Подтверждено: {complex.readinessConfirmed == null ? 'неизвестно' : `${complex.readinessConfirmed}%`}.</p>{#if complex.readinessClaimed != null && complex.readinessConfirmed != null}<p>Разрыв: {complex.readinessClaimed - complex.readinessConfirmed} п.п. Порог R5 — 20 п.п.; сама разница без проверки не начисляет баллы.</p>{/if}{#if complex.readinessClaimedSource}<p>Заявленная готовность: {complex.readinessClaimedSource.source} · {complex.readinessClaimedSource.date}</p>{/if}{#each complex.readinessSources as observation}<p>{observation.value}% · {observation.source} · {observation.date}</p>{/each}</details>{/if}
    </article>
  {/each}
  <p class="notice">Баллы даёт только проверка конкретного факта. Нулевой балл не доказывает безопасность. Принятие AI-гипотезы само по себе баллов не добавляет. Дескриптор объясняет риск, но не устанавливает факт правонарушения — решение принимает человек.</p>
</section>

<style>
  .score-explanation { max-width: 1000px; margin: 0 auto; }
  .score-back { display: inline-block; margin-bottom: 24px; font-size: 14px; text-decoration: underline; text-underline-offset: 4px; }
  .score-detail-heading, .score-factor-heading { display: flex; justify-content: space-between; align-items: start; gap: 24px; }
  .score-detail-heading { margin-bottom: 24px; }
  .score-detail-heading h2 { margin: 8px 0 0; font-size: 28px; }
  .score-detail-heading .button { flex-shrink: 0; }
  .score-calculation, .score-factor-detail { margin-bottom: 20px; }
  .score-equation { display: flex; flex-wrap: wrap; align-items: baseline; gap: 18px; margin: 12px 0 20px; font-variant-numeric: tabular-nums; }
  .score-equation strong { font-size: 48px; line-height: 1; }
  .score-equation span { font-size: 20px; color: var(--ink-2); }
  .score-components { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
  .score-components a { display: flex; justify-content: space-between; gap: 8px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink-2); font-size: 13px; }
  .score-components a.counted { background: #edf2e8; color: var(--forest); }
  .score-components a.chosen { outline: 2px solid var(--forest); outline-offset: 1px; }
  .score-components a:hover { background: #e3ecdc; }
  .score-zone-rules { padding-left: 20px; margin: 12px 0; list-style: disc; line-height: 1.8; }
  .score-factor-heading { margin-bottom: 12px; }
  .score-factor-heading strong { font-size: 24px; white-space: nowrap; }
  .score-rule { margin: 16px 0; font-weight: 600; }
  .score-evidence { border-top: 1px solid var(--line-soft); padding-top: 20px; margin-top: 24px; }
  .risk-descriptor { background: #f6f8f3; border: 1px solid var(--line-soft); border-radius: 10px; padding: 16px 18px; margin: 16px 0 4px; }
  .risk-descriptor dl { display: grid; grid-template-columns: 130px 1fr; gap: 8px 16px; margin: 12px 0 0; }
  .risk-descriptor dt { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-2); }
  .risk-descriptor dd { margin: 0; line-height: 1.6; }
  h4 { font-weight: 650; margin: 20px 0 12px; }
  dd, .score-source-text, .score-evidence p { overflow-wrap: anywhere; }
  .score-source-text { white-space: pre-wrap; }
  @media (max-width: 640px) { .score-detail-heading { flex-direction: column; gap: 16px; }.score-detail-heading h2 { font-size: 23px; }.score-components { grid-template-columns: repeat(3, minmax(0, 1fr)); }.score-equation span { font-size: 16px; } .risk-descriptor dl { grid-template-columns: 1fr; } }
</style>
