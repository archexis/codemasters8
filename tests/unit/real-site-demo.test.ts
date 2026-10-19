import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialState } from '../../src/lib/domain';
import locations from '../../tools/real-site-locations.json';
import { loadState } from '../../src/lib/repository';

vi.mock('../../src/lib/supabase', () => ({ supabase: null, demoMode: true }));

afterEach(() => vi.unstubAllGlobals());

function storage() {
  const items = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  });
  return items;
}

describe('replacement real-location demo', () => {
  it('uses every sourced location once, with no invented coordinates or public legal records', () => {
    const state = initialState();
    expect(state.complexes.map(z => ({ id: z.id, lat: z.lat, lng: z.lng })))
      .toEqual(locations.map(({ id, lat, lng }) => ({ id, lat, lng })));
    expect(new Set(state.complexes.map(z => `${z.lat},${z.lng}`)).size).toBe(8);
    expect(state.complexes.every(z => z.demo && z.origin === 'scenario' && z.bin === null)).toBe(true);
    expect(state.ads.every(ad => ad.text.includes('ВЫМЫШЛЕННЫЙ МАТЕРИАЛ') && ad.url.startsWith('https://example.invalid/'))).toBe(true);
  });

  it.each([false, true])('removes the retired dataset and pending data (envelope=%s)', async envelope => {
    const saved = storage();
    const old = initialState();
    old.complexes[0].name = 'Ертіс Толқыны';
    saved.set('sq_svelte_demo_v2', JSON.stringify(envelope ? { envelope: 1, state: old, version: 7 } : old));
    for (const key of ['sq_pending_command_v1', 'sq_staged_files_v1', 'sq_cleanup_retry_v1', 'sq_svelte_demo_v2_raw_backup', 'sq_state_v1']) saved.set(key, 'retired');
    const state = await loadState();
    expect(state).toEqual(initialState());
    expect(saved.size).toBe(0);
  });

  it('keeps edits made after replacement on repeated loads', async () => {
    const saved = storage();
    const state = initialState();
    state.complexes[0].note = 'Комментарий пользователя';
    saved.set('sq_svelte_demo_v2', JSON.stringify({ envelope: 1, state, version: 4, receipts: {} }));
    expect((await loadState()).complexes[0].note).toBe('Комментарий пользователя');
    expect((await loadState()).complexes[0].note).toBe('Комментарий пользователя');
    expect(saved.has('sq_svelte_demo_v2')).toBe(true);
  });
});
