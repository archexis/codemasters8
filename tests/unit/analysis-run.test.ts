/**
 * S4.1 (C5). Жизненный цикл analysis run: started → succeeded/failed,
 * inputHash по фиксированному порядку полей, заземление цитат, ссылки
 * runId/hypothesisId в decision, replay без второго provider-вызова,
 * 409 при чужом input, DEMO local-parser и imported provenance.
 */
import { describe, expect, it } from 'vitest';
import {
  AI_MAX_HYPOTHESES,
  AI_PROMPT_VERSION,
  assertRunLinkPair,
  canonicalRunInput,
  demoRunFor,
  failAnalysisRun,
  inputHashFor,
  markRunImported,
  newRunId,
  resolveDecisionProvenance,
  runAnalysisOnce,
  startAnalysisRun,
  succeedAnalysisRun,
  type AiRunHypothesis,
  type AiRunInput,
  type AnalysisRun,
  type AnalysisRunStore,
} from '../../src/lib/analysis';
import { assertAnalysisLink } from '../../src/lib/validation';

const base: AiRunInput = {
  text: 'Депозит 500 000 тенге обязателен. Подробности предложения.',
  zkId: 'SQ-001',
  url: 'https://example.test/ad/1',
  account: 'test-account',
  date: '2026-10-01',
  platform: 'Krisha.kz',
};

const mem = (): AnalysisRunStore & { size: number } => {
  const m = new Map<string, AnalysisRun>();
  return {
    get: (id) => m.get(id),
    set: (r) => { m.set(r.id, r); },
    get size() { return m.size; },
  };
};

const counter = (hyps: AiRunHypothesis[]) => {
  let calls = 0;
  return { calls: () => calls, fn: () => { calls += 1; return hyps; } };
};

const goodHyps = (runId: string): AiRunHypothesis[] => [
  { id: `${runId}-h1`, code: 'R2', quote: 'Депозит 500 000 тенге обязателен.', reason: 'Прямое предложение оплаты.' },
];

describe('S4.1 inputHash: точный snapshot, фиксированный порядок полей', () => {
  it('тот же input даёт тот же хеш; порядок ключей объекта не влияет', () => {
    const shuffled: AiRunInput = {
      platform: base.platform, date: base.date, account: base.account,
      url: base.url, zkId: base.zkId, text: base.text,
    };
    expect(inputHashFor(shuffled)).toBe(inputHashFor(base));
    expect(canonicalRunInput(base)).toBe(canonicalRunInput(shuffled));
    expect(canonicalRunInput(base).startsWith('{"text":')).toBe(true);
  });

  it('смена текста/ЖК/даты меняет хеш', () => {
    expect(inputHashFor({ ...base, text: base.text + '!' })).not.toBe(inputHashFor(base));
    expect(inputHashFor({ ...base, zkId: 'SQ-002' })).not.toBe(inputHashFor(base));
    expect(inputHashFor({ ...base, date: null })).not.toBe(inputHashFor(base));
  });

  it('start фиксирует snapshot и хеш, статус started', () => {
    const run = startAnalysisRun(base, { runId: 'run-1' });
    expect(run.id).toBe('run-1');
    expect(run.status).toBe('started');
    expect(run.inputHash).toBe(inputHashFor(base));
    expect(run.hypotheses).toEqual([]);
    expect(run.promptVersion).toBe(AI_PROMPT_VERSION);
    expect(run.finishedAt).toBeNull();
    expect(run.errorCode).toBeNull();
  });

  it('невалидный вход: слишком длинный текст, плохой zkId/runId', () => {
    expect(() => startAnalysisRun({ ...base, text: 'x'.repeat(20001) })).toThrow(/20 000/);
    expect(() => startAnalysisRun({ ...base, zkId: 'плохой id!' })).toThrow(/zkId/);
    expect(() => startAnalysisRun(base, { runId: 'плохой id!' })).toThrow(/runId/);
    expect(newRunId()).toMatch(/^[A-Za-z0-9-]{1,80}$/);
  });
});

describe('S4.1 succeed: только R2/R3, ≤6, точные цитаты, устойчивые ID', () => {
  it('валидные R2+R3 переходят в succeeded со стабильными ID', () => {
    const run = startAnalysisRun(base, { runId: 'run-ok' });
    const done = succeedAnalysisRun(run, [
      { code: 'R2', quote: 'Депозит 500 000 тенге обязателен.', reason: 'Оплата.' },
      { code: 'R3', quote: 'Подробности предложения.', reason: 'Стройка.' },
    ]);
    expect(done.status).toBe('succeeded');
    expect(done.hypotheses.map((h) => h.id)).toEqual(['run-ok-h1', 'run-ok-h2']);
    expect(done.finishedAt).not.toBeNull();
  });

  it('отвергает: R1, >6 гипотез, пустую/выдуманную цитату, пустой reason, дубли ID', () => {
    const run = startAnalysisRun(base, { runId: 'run-bad' });
    const q = 'Депозит 500 000 тенге обязателен.';
    expect(() => succeedAnalysisRun(run, [{ code: 'R1', quote: q, reason: 'x' }])).toThrow(/только R2\/R3/);
    expect(() => succeedAnalysisRun(run, [{ code: 'R9', quote: q, reason: 'x' }])).toThrow(/только R2\/R3/);
    const many = Array.from({ length: AI_MAX_HYPOTHESES + 1 }, () => ({ code: 'R2', quote: q, reason: 'x' }));
    expect(() => succeedAnalysisRun(run, many)).toThrow(/максимум 6/);
    expect(() => succeedAnalysisRun(run, [{ code: 'R2', quote: '   ', reason: 'x' }])).toThrow(/цитата/);
    expect(() => succeedAnalysisRun(run, [{ code: 'R2', quote: 'выдуманная цитата', reason: 'x' }])).toThrow(/отсутствует в исходном тексте/);
    expect(() => succeedAnalysisRun(run, [{ code: 'R2', quote: q, reason: '  ' }])).toThrow(/reason/);
    expect(() => succeedAnalysisRun(run, [
      { id: 'dup', code: 'R2', quote: q, reason: 'x' },
      { id: 'dup', code: 'R3', quote: 'Подробности предложения.', reason: 'y' },
    ])).toThrow(/повтор hypothesisId/);
  });

  it('успеха из терминального статуса нет (crash до записи succeeded)', () => {
    const run = startAnalysisRun(base, { runId: 'run-term' });
    const failed = failAnalysisRun(run, 'TIMEOUT');
    expect(failed.status).toBe('failed');
    expect(failed.errorCode).toBe('TIMEOUT');
    expect(() => succeedAnalysisRun(failed, [])).toThrow(/только из started/);
    expect(() => failAnalysisRun(failed, 'X')).toThrow(/только из started/);
    expect(() => failAnalysisRun(startAnalysisRun(base, { runId: 'run-e' }), '  ')).toThrow(/errorCode/);
  });
});

describe('S4.1 runAnalysisOnce: replay без второго вызова, 409, failed', () => {
  it('повтор runId с тем же input возвращает сохранённое без нового вызова', async () => {
    const store = mem();
    const p = counter(goodHyps('run-dup'));
    const first = await runAnalysisOnce(store, base, p.fn, { runId: 'run-dup' });
    expect(first.replayed).toBe(false);
    expect(first.run.status).toBe('succeeded');
    const second = await runAnalysisOnce(store, base, p.fn, { runId: 'run-dup' });
    expect(second.replayed).toBe(true);
    expect(second.run.inputHash).toBe(first.run.inputHash);
    expect(p.calls()).toBe(1);
  });

  it('тот же ID с другим input — 409, квота/провайдер не тратятся', async () => {
    const store = mem();
    const p = counter(goodHyps('run-conflict'));
    await runAnalysisOnce(store, base, p.fn, { runId: 'run-conflict' });
    await expect(runAnalysisOnce(store, { ...base, text: 'Другой текст.' }, p.fn, { runId: 'run-conflict' }))
      .rejects.toThrow(/409/);
    expect(p.calls()).toBe(1);
  });

  it('ошибка провайдера фиксирует failed и пробрасывается', async () => {
    const store = mem();
    let calls = 0;
    await expect(runAnalysisOnce(store, base, () => { calls += 1; throw new Error('socket hang up'); }, { runId: 'run-fail' }))
      .rejects.toThrow(/socket hang up/);
    expect(calls).toBe(1);
    const saved = store.get('run-fail');
    expect(saved?.status).toBe('failed');
    expect(saved?.errorCode).toBe('PROVIDER_ERROR');
  });

  it('невалидный ответ модели — failed с PROVIDER_BAD_RESPONSE', async () => {
    const store = mem();
    const bad = [{ code: 'R2', quote: 'выдуманная цитата', reason: 'x' }] as unknown as AiRunHypothesis[];
    await expect(runAnalysisOnce(store, base, () => bad, { runId: 'run-badresp' })).rejects.toThrow(/отсутствует в исходном тексте/);
    expect(store.get('run-badresp')?.errorCode).toBe('PROVIDER_BAD_RESPONSE');
  });
});

describe('S4.1 decision-ссылки: сирота отвергается, успех только по run', () => {
  const linkOf = (run: AnalysisRun) => ({
    runId: run.id, hypothesisId: run.hypotheses[0].id, code: 'R2' as const, quote: 'Депозит 500 000 тенге обязателен.',
  });

  it('сирота (hypothesisId без runId) отвергается', () => {
    expect(() => assertRunLinkPair({ hypothesisId: 'h1' }, 'decision.hypothesis')).toThrow(/runId/);
    expect(() => resolveDecisionProvenance(
      { hypothesisId: 'h1', code: 'R2', quote: 'x' }, null, base,
    )).toThrow(/runId/);
  });

  it('ручное решение без runId — null (AI-provenance нет)', () => {
    expect(resolveDecisionProvenance({ code: 'R2', quote: 'x' }, null, base)).toBeNull();
  });

  it('успешная ссылка даёт provenance; несовпадения отвергаются', () => {
    const run = succeedAnalysisRun(startAnalysisRun(base, { runId: 'run-dec' }), goodHyps('run-dec'));
    const prov = resolveDecisionProvenance(linkOf(run), run, base);
    expect(prov).toMatchObject({ runId: 'run-dec', hypothesisId: 'run-dec-h1', code: 'R2' });
    // Ссылка без hypothesisId: совпадение по code+quote.
    expect(resolveDecisionProvenance({ runId: run.id, code: 'R2', quote: linkOf(run).quote }, run, base)?.runId).toBe('run-dec');
    expect(() => resolveDecisionProvenance(linkOf(run), null, base)).toThrow(/не найден/);
    expect(() => resolveDecisionProvenance(linkOf(run), run, { ...base, text: 'Депозит 500 000 тенге обязателен!' }))
      .toThrow(/inputHash/);
    expect(() => resolveDecisionProvenance({ ...linkOf(run), hypothesisId: 'run-dec-h9' }, run, base)).toThrow(/hypothesisId/);
    expect(() => resolveDecisionProvenance({ ...linkOf(run), quote: 'Депозит 500 000 тенге.' }, run, base)).toThrow(/code\/quote/);
  });

  it('failed/pending run решений не даёт', () => {
    const started = startAnalysisRun(base, { runId: 'run-pend' });
    const link = { runId: 'run-pend', code: 'R2' as const, quote: 'Депозит 500 000 тенге обязателен.' };
    expect(() => resolveDecisionProvenance(link, started, base)).toThrow(/статусе started/);
    expect(() => resolveDecisionProvenance(link, failAnalysisRun(started, 'TIMEOUT'), base)).toThrow(/статусе failed/);
  });
});

describe('S4.1 provenance: DEMO local-parser и imported', () => {
  it('DEMO-прогон — succeeded с origin local-parser, цитаты заземлены', () => {
    const run = demoRunFor(base);
    expect(run.status).toBe('succeeded');
    expect(run.origin).toBe('local-parser');
    for (const h of run.hypotheses) expect(base.text.includes(h.quote)).toBe(true);
    expect(run.hypotheses.some((h) => h.code === 'R2')).toBe(true);
  });

  it('нейтральный текст — succeeded без гипотез (не подделывает AI)', () => {
    const run = demoRunFor({ ...base, text: 'Продаётся квартира. Подробности предложения.' });
    expect(run.status).toBe('succeeded');
    expect(run.origin).toBe('local-parser');
    expect(run.hypotheses).toEqual([]);
  });

  it('пустой текст — failed LOCAL_PARSER_ERROR, не успех', () => {
    const run = demoRunFor({ ...base, text: '' });
    expect(run.status).toBe('failed');
    expect(run.errorCode).toBe('LOCAL_PARSER_ERROR');
  });

  it('markRunImported ставит origin imported, сохраняя id/хеш', () => {
    const run = succeedAnalysisRun(startAnalysisRun(base, { runId: 'run-imp' }), goodHyps('run-imp'));
    const imported = markRunImported(run);
    expect(imported.origin).toBe('imported');
    expect(imported.id).toBe('run-imp');
    expect(imported.inputHash).toBe(run.inputHash);
  });
});

describe('S4.1 задел validateLoadedState: парность ссылок', () => {
  it('evidence с runId/hypothesisId проходит структурную проверку, сирота — нет', () => {
    const run = succeedAnalysisRun(startAnalysisRun(base, { runId: 'run-val' }), goodHyps('run-val'));
    const prov = resolveDecisionProvenance(
      { runId: run.id, hypothesisId: run.hypotheses[0].id, code: 'R2', quote: run.hypotheses[0].quote },
      run, base,
    );
    expect(prov).not.toBeNull();
    expect(() => assertAnalysisLink(
      { runId: prov!.runId, hypothesisId: prov!.hypothesisId }, 'evidence',
    )).not.toThrow();
    expect(() => assertAnalysisLink({ hypothesisId: 'orphan' }, 'evidence')).toThrow(/hypothesisId/);
  });
});
