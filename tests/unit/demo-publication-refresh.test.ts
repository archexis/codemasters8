import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../src/lib/supabase', () => ({ supabase: null }));
import { initialState } from '../../src/lib/domain';
import { loadState } from '../../src/lib/repository';

afterEach(() => vi.unstubAllGlobals());

it('loads a demo with an old artifact copy without changing its text', async () => {
  const state = initialState();
  const artifact = state.artifacts!.find(item => item.adId)!;
  artifact.text += ' Историческая версия.';
  const originalText = artifact.text;
  const raw = JSON.stringify({ envelope: 1, state, version: 1, receipts: {} });
  const storage = new Map([['sq_svelte_demo_v2', raw]]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  const loaded = await loadState();
  const historical = loaded.artifacts!.find(item => item.id === artifact.id)!;
  expect(historical.text).toBe(originalText);
  expect(historical.adId).toBeUndefined();
  expect(storage.get('sq_demo_before_artifact_repair_20261020')).toBe(raw);
  await expect(loadState()).resolves.toBeDefined();
});

it('refreshes retired demo ads once, preserves custom records and keeps a recovery copy', async () => {
  const state = initialState();
  state.ads[0] = { ...state.ads[0], account: 'demo_project_1', platform: 'Демо-публикация' };
  state.artifacts = state.artifacts?.map(artifact => artifact.adId === state.ads[0].id ? { ...artifact, text: state.ads[0].text } : artifact);
  const custom = { ...state.ads[1], id: 'CUSTOM-AD', text: 'Моя публикация' };
  state.ads.push(custom);
  const raw = JSON.stringify({ envelope: 1, state, version: 3, receipts: {} });
  const storage = new Map([['sq_svelte_demo_v2', raw]]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, work: () => unknown) => work() } });
  const loaded = await loadState();
  expect(loaded.ads[0]).toEqual(initialState().ads[0]);
  expect(loaded.ads.find(ad => ad.id === custom.id)).toEqual(custom);
  expect(storage.get('sq_demo_before_publication_refresh_20261020')).toBe(raw);
  expect(JSON.parse(storage.get('sq_svelte_demo_v2')!).version).toBe(4);
  await loadState();
  expect(JSON.parse(storage.get('sq_svelte_demo_v2')!).version).toBe(4);
});
