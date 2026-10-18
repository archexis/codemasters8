/**
 * S4.5 (C5). Edge-proxy red→green: граница до платного вызова.
 * Upstream — ТОЛЬКО локальный stub (наружу не ходим, DeepSeek-ключа нет;
 * в тестах фигурирует заведомо фейковый 'stub-server-secret').
 * Кейсы: подмена origin / размер / deadline / invalid-JSON / без ключа /
 * ключ не хранится и не утекает в ответ.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_BYTES,
  handleProxy,
} from '../../supabase/functions/analyze-proxy/index';
import type { ProxyEnv } from '../../supabase/functions/analyze-proxy/index';

const ORIGIN = 'http://localhost:5173';
const STUB_URL = 'http://upstream.stub/chat';

function env(over: Partial<ProxyEnv> = {}): ProxyEnv {
  return {
    allowedOrigins: [ORIGIN],
    apiKey: 'stub-server-secret',
    model: 'stub-model',
    upstreamUrl: STUB_URL,
    timeoutMs: 30000,
    ...over,
  };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://edge.test/analyze-proxy', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-token', Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

function stubUpstream(hypotheses: unknown, seen: { calls: number; auth: string[]; url: string[] }) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    seen.calls += 1;
    seen.url.push(String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url));
    seen.auth.push(new Headers(init?.headers).get('Authorization') ?? '');
    return Response.json({ choices: [{ message: { content: JSON.stringify({ hypotheses }) } }] });
  };
}

const R2 = [{ code: 'R2', quote: 'Депозит 500 тенге', reason: 'Просьба оплаты' }];

describe('S4.5 edge-proxy: origin gate', () => {
  it('подмена Origin → 403, чужой origin эхом не возвращается', async () => {
    const seen = { calls: 0, auth: [] as string[], url: [] as string[] };
    const res = await handleProxy(
      post({ text: 'Депозит 500 тенге' }, { Origin: 'https://evil.test' }),
      env(),
      { fetchUpstream: stubUpstream(R2, seen) as typeof fetch, verifyToken: async () => true },
    );
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(seen.calls).toBe(0);
    expect((await res.json() as { error_code: string }).error_code).toBe('ORIGIN_FORBIDDEN');
  });

  it('свой Origin проходит CORS и доходит до upstream', async () => {
    const seen = { calls: 0, auth: [] as string[], url: [] as string[] };
    const res = await handleProxy(post({ text: 'Депозит 500 тенге' }), env(), {
      fetchUpstream: stubUpstream(R2, seen) as typeof fetch,
      verifyToken: async () => true,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(seen.calls).toBe(1);
  });
});

describe('S4.5 edge-proxy: auth и конфигурация', () => {
  it('без Bearer → 401, upstream не вызывается', async () => {
    const seen = { calls: 0, auth: [] as string[], url: [] as string[] };
    const req = new Request('http://edge.test/analyze-proxy', {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Депозит 500 тенге' }),
    });
    const res = await handleProxy(req, env(), { fetchUpstream: stubUpstream(R2, seen) as typeof fetch });
    expect(res.status).toBe(401);
    expect(seen.calls).toBe(0);
  });

  it('невалидный токен (verifyToken=false) → 401', async () => {
    const seen = { calls: 0, auth: [] as string[], url: [] as string[] };
    const res = await handleProxy(post({ text: 'Депозит 500 тенге' }), env(), {
      fetchUpstream: stubUpstream(R2, seen) as typeof fetch,
      verifyToken: async () => false,
    });
    expect(res.status).toBe(401);
    expect(seen.calls).toBe(0);
  });

  it('без ключа/модели → 503 и НИКАКОГО upstream-вызова (успешного run нет)', async () => {
    for (const e of [env({ apiKey: '' }), env({ model: '' })]) {
      const seen = { calls: 0, auth: [] as string[], url: [] as string[] };
      const res = await handleProxy(post({ text: 'Депозит 500 тенге' }), e, {
        fetchUpstream: stubUpstream(R2, seen) as typeof fetch,
        verifyToken: async () => true,
      });
      expect(res.status).toBe(503);
      expect(seen.calls).toBe(0);
      expect((await res.json() as { error_code: string }).error_code).toBe('LLM_NOT_CONFIGURED');
    }
  });
});

describe('S4.5 edge-proxy: размер, JSON, deadline', () => {
  it('тело сверх 100 000 байт → 413 (chunked-лимит не обойти)', async () => {
    const seen = { calls: 0, auth: [] as string[], url: [] as string[] };
    const big = JSON.stringify({ text: 'x'.repeat(MAX_BODY_BYTES + 1) });
    const res = await handleProxy(post(big), env(), {
      fetchUpstream: stubUpstream(R2, seen) as typeof fetch,
      verifyToken: async () => true,
    });
    expect(res.status).toBe(413);
    expect(seen.calls).toBe(0);
  });

  it('invalid-JSON тела → 422', async () => {
    const seen = { calls: 0, auth: [] as string[], url: [] as string[] };
    const res = await handleProxy(post('{не json'), env(), {
      fetchUpstream: stubUpstream(R2, seen) as typeof fetch,
      verifyToken: async () => true,
    });
    expect(res.status).toBe(422);
    expect(seen.calls).toBe(0);
  });

  it('пустой текст и текст сверх 20 000 символов → 422', async () => {
    const seen = { calls: 0, auth: [] as string[], url: [] as string[] };
    const deps = { fetchUpstream: stubUpstream(R2, seen) as typeof fetch, verifyToken: async () => true };
    expect((await handleProxy(post({ text: '   ' }), env(), deps)).status).toBe(422);
    expect((await handleProxy(post({ text: 'y'.repeat(20001) }), env(), deps)).status).toBe(422);
    expect(seen.calls).toBe(0);
  });

  it('висящий upstream при коротком deadline → 504, не 200', async () => {
    const hanging = ((_input: unknown, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Timeout', 'TimeoutError')));
      })) as unknown as typeof fetch;
    const res = await handleProxy(post({ text: 'Депозит 500 тенге' }), env({ timeoutMs: 50 }), {
      fetchUpstream: hanging,
      verifyToken: async () => true,
    });
    expect(res.status).toBe(504);
    expect((await res.json() as { error_code: string }).error_code).toBe('PROVIDER_TIMEOUT');
  });
});

describe('S4.5 edge-proxy: валидация ответа провайдера', () => {
  const depsFor = (seen: { calls: number; auth: string[]; url: string[] }, h: unknown) => ({
    fetchUpstream: stubUpstream(h, seen) as typeof fetch,
    verifyToken: async () => true,
  });

  it('выдуманная цитата → 502 UNGROUNDED_QUOTE', async () => {
    const seen = { calls: 0, auth: [] as string[], url: [] as string[] };
    const res = await handleProxy(
      post({ text: 'Обычное объявление без предложений.' }),
      env(),
      depsFor(seen, [{ code: 'R2', quote: 'выдуманная цитата', reason: 'x' }]),
    );
    expect(res.status).toBe(502);
    expect((await res.json() as { error_code: string }).error_code).toBe('UNGROUNDED_QUOTE');
  });

  it('чужой код (R1/R4) → 502: модель извлекает только R2/R3', async () => {
    const seen = { calls: 0, auth: [] as string[], url: [] as string[] };
    for (const code of ['R1', 'R4', 'R5']) {
      const res = await handleProxy(
        post({ text: `Депозит 500 тенге, ${code}` }),
        env(),
        depsFor(seen, [{ code, quote: 'Депозит 500 тенге', reason: 'x' }]),
      );
      expect(res.status).toBe(502);
      expect((await res.json() as { error_code: string }).error_code).toBe('HYPOTHESIS_CODE_FORBIDDEN');
    }
  });

  it('невалидный JSON провайдера и >6 гипотез → 502', async () => {
    const seen = { calls: 0, auth: [] as string[], url: [] as string[] };
    const badJson = (async () => Response.json({ choices: [{ message: { content: '{oops' } }] })) as typeof fetch;
    const r1 = await handleProxy(post({ text: 'Депозит 500 тенге' }), env(), {
      fetchUpstream: badJson,
      verifyToken: async () => true,
    });
    expect(r1.status).toBe(502);
    const many = Array.from({ length: 7 }, (_, i) => ({ code: 'R2', quote: 'Депозит 500 тенге', reason: `r${i}` }));
    const r2 = await handleProxy(post({ text: 'Депозит 500 тенге' }), env(), depsFor(seen, many));
    expect(r2.status).toBe(502);
  });

  it('успех: grounded R2 + provenance-поля, ключ в ответе отсутствует', async () => {
    const seen = { calls: 0, auth: [] as string[], url: [] as string[] };
    const res = await handleProxy(post({ text: 'Депозит 500 тенге', complexName: 'ЖК' }), env(), depsFor(seen, R2));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ realAI: true, engine: 'stub-model', prompt_version: 1, schema_version: 1 });
    expect(body.hypotheses).toEqual(R2);
    expect(typeof body.input_hash).toBe('string');
    expect((body.input_hash as string)).toMatch(/^[0-9a-f]{64}$/);
    // Ключ — только серверным Bearer к upstream, в ответе его нет.
    expect(seen.auth).toEqual(['Bearer stub-server-secret']);
    expect(JSON.stringify(body)).not.toContain('stub-server-secret');
  });

  it('ключ не хранится: модуль stateless, повтор без ключа снова 503', async () => {
    const seen = { calls: 0, auth: [] as string[], url: [] as string[] };
    const deps = depsFor(seen, R2);
    const ok = await handleProxy(post({ text: 'Депозит 500 тенге' }), env(), deps);
    expect(ok.status).toBe(200);
    const noKey = await handleProxy(post({ text: 'Депозит 500 тенге' }), env({ apiKey: '' }), deps);
    expect(noKey.status).toBe(503);
    expect(seen.calls).toBe(1);
    expect(JSON.stringify(await ok.json())).not.toContain('stub-server-secret');
  });
});
