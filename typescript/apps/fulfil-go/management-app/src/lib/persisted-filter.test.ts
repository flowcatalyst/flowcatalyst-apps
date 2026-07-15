import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nextTick, type Ref } from 'vue';

// Node test environment: stub localStorage BEFORE importing context.ts
// (it reads the persisted clientId at module load). Dynamic imports keep
// the ordering explicit.
const store = new Map<string, string>();
let clientId: Ref<string>;
let persistedFilter: <T>(page: string | (() => string), name: string, initial: T) => Ref<T>;

beforeAll(async () => {
  (globalThis as Record<string, unknown>)['localStorage'] = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  ({ clientId } = await import('../context.js'));
  ({ persistedFilter } = await import('./persisted-filter.js'));
});

describe('persistedFilter', () => {
  beforeEach(async () => {
    store.clear();
    clientId.value = 'clt_A';
    await nextTick();
  });

  it('starts from the initial value and persists changes', async () => {
    const filter = persistedFilter<string[]>('test-page', 'stores', []);
    expect(filter.value).toEqual([]);
    filter.value = ['store-1', 'store-2'];
    await nextTick();
    expect(store.get('fulfilgo.mgmt.filter.test-page.stores.clt_A')).toBe(
      JSON.stringify(['store-1', 'store-2']),
    );
  });

  it('restores a persisted value (the reload survival)', () => {
    store.set('fulfilgo.mgmt.filter.test-page.type.clt_A', JSON.stringify('delivery'));
    expect(persistedFilter('test-page', 'type', 'all').value).toBe('delivery');
  });

  it('falls back to the initial value on corrupt storage', () => {
    store.set('fulfilgo.mgmt.filter.test-page.type.clt_A', '{not json');
    expect(persistedFilter('test-page', 'type', 'all').value).toBe('all');
  });

  it('is scoped per client and swaps on client switch', async () => {
    store.set('fulfilgo.mgmt.filter.test-page.store.clt_B', JSON.stringify('store-9'));
    const filter = persistedFilter('test-page', 'store', '');
    filter.value = 'store-1';
    await nextTick();
    clientId.value = 'clt_B';
    await nextTick();
    expect(filter.value).toBe('store-9');
    clientId.value = 'clt_A';
    await nextTick();
    expect(filter.value).toBe('store-1');
  });

  it('mutating an array does not bleed into the shared initial value', async () => {
    const first = persistedFilter<string[]>('test-page', 'multi', []);
    first.value.push('x');
    await nextTick();
    clientId.value = 'clt_C';
    await nextTick();
    expect(first.value).toEqual([]);
  });

  it('deep mutation of an array filter persists (multi-select push)', async () => {
    const filter = persistedFilter<string[]>('test-page', 'deep', []);
    filter.value.push('store-3');
    await nextTick();
    expect(store.get('fulfilgo.mgmt.filter.test-page.deep.clt_A')).toBe(
      JSON.stringify(['store-3']),
    );
  });

  it('a function page key scopes storage per computed page', async () => {
    const filter = persistedFilter(() => 'profiles-pick', 'profile', 'default');
    filter.value = 'dark-store';
    await nextTick();
    expect(store.get('fulfilgo.mgmt.filter.profiles-pick.profile.clt_A')).toBe(
      JSON.stringify('dark-store'),
    );
    const transport = persistedFilter(() => 'profiles-transport', 'profile', 'default');
    expect(transport.value).toBe('default');
  });
});
