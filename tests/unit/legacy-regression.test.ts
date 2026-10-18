import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as scoring from '../../src/lib/scoring';
import * as parser from '../../src/lib/parser';
import seed from '../../src/lib/seed.json' with { type: 'json' };
// Execute the original 178 assertions against the migrated TypeScript modules.
it.each(['scoring','parser','sources'])('original %s regression suite uses the new implementation', name => {
  let assertions = 0;
  const window: Record<string, unknown> = {};
  const context = {
    global: { window, localStorage: {} },
    console: { log: (...args: unknown[]) => { if (String(args[0]).includes('ok ')) assertions++; } },
    process: { exit: (code: number) => { if (code) throw new Error('Legacy suite failed'); } },
    require: (path: string) => {
      if (path === 'node:assert') return { ok: (condition: unknown, message: string) => expect(condition, message).toBeTruthy() };
      if (path.endsWith('scoring.js')) return scoring;
      if (path.endsWith('parser.js')) return parser;
      if (path.endsWith('data.js')) { context.global.window.SQ_SEED = seed; return seed; }
      if (path.endsWith('ai.js')) {
        context.global.window.SQ_AI = { heuristicAnalyze: (text: string) => { const result = parser.parseAdText(text); return { engine:'demo-parser',realAI:false,hypotheses:result.payment.flagged ? [{exact_quote:result.payment.quotes[0]}] : [] }; } };
        return {};
      }
      throw new Error(`Unexpected legacy import ${path}`);
    },
  };
  vm.runInNewContext(readFileSync(`tests/fixtures/legacy-${name}.cjs`, 'utf8'), context);
  expect(assertions).toBeGreaterThan(25);
});
