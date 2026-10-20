import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../src/lib/supabase', () => ({ supabase: null }));
import { initialState } from '../../src/lib/domain';
import { commitCommand, loadState, readPendingCommand, StorageWriteError } from '../../src/lib/repository';

afterEach(() => vi.unstubAllGlobals());

it.each(['sq_pending_command_v1', 'sq_svelte_demo_v2'])('rejects quota failure at %s and retries without a lost version or duplicate receipt', async failingKey => {
  const state = initialState();
  const raw = JSON.stringify({ envelope: 1, state, version: 5, receipts: {} });
  const items = new Map([['sq_svelte_demo_v2', raw]]);
  let fail = true;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (fail && key === failingKey) throw new DOMException('full', 'QuotaExceededError');
      items.set(key, value);
    },
    removeItem: (key: string) => items.delete(key),
  });
  vi.stubGlobal('navigator', { locks: { request: async (_: unknown, __: unknown, work: () => unknown) => work() } });
  await loadState();
  const command = { type: 'complex' as const, complex: { ...state.complexes[0], note: 'Unsaved draft' } };
  await expect(commitCommand(state, command, 'test', { commandId: 'quota-retry' })).rejects.toMatchObject({ name: 'StorageWriteError', reason: 'quota' });
  expect(items.get('sq_svelte_demo_v2')).toBe(raw);
  expect((await loadState()).complexes[0].note).toBe(state.complexes[0].note);
  if (failingKey === 'sq_svelte_demo_v2') expect(readPendingCommand()?.commandId).toBe('quota-retry');
  fail = false;
  const saved = await commitCommand(state, command, 'test', { commandId: 'quota-retry' });
  expect(saved.version).toBe(6);
  expect((await loadState()).complexes[0].note).toBe('Unsaved draft');
  expect((await commitCommand(saved.state, command, 'test', { commandId: 'quota-retry' })).replayed).toBe(true);
  expect(Object.keys(JSON.parse(items.get('sq_svelte_demo_v2')!).receipts)).toEqual(['quota-retry']);
});

it('does not replace unavailable browser storage with successful in-memory writes', async () => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', undefined);
  await expect(commitCommand(initialState(), { type: 'complex', complex: initialState().complexes[0] }, 'test')).rejects.toBeInstanceOf(StorageWriteError);
});

it('distinguishes a storage security error from quota exhaustion', async () => {
  vi.stubGlobal('localStorage', { setItem: () => { throw new DOMException('denied', 'SecurityError'); } });
  await expect(commitCommand(initialState(), { type: 'complex', complex: initialState().complexes[0] }, 'test')).rejects.toMatchObject({ reason: 'unavailable' });
});
