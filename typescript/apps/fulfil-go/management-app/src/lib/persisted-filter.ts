import { ref, watch, type Ref } from 'vue';
import { clientId } from '../context.js';

/**
 * A filter ref that survives page reloads — the management-app STANDARD for
 * every list filter/selector (Andrew, 2026-07-15). The value mirrors to
 * localStorage, keyed per page + filter + CLIENT: switching clients in the
 * profile popover loads that client's remembered filters instead of leaking
 * store/depot refs across tenants. Corrupt or absent entries fall back to
 * the initial value.
 *
 * Use for filter state only — never for form drafts or server data.
 */
export function persistedFilter<T>(
  /** Static page slug, or a getter when the page is reused across routes (e.g. per-domain). */
  page: string | (() => string),
  name: string,
  initial: T,
): Ref<T> {
  const pageKey = typeof page === 'function' ? page : () => page;
  const storageKey = () => `fulfilgo.mgmt.filter.${pageKey()}.${name}.${clientId.value}`;
  const load = (): T => {
    try {
      const raw = localStorage.getItem(storageKey());
      return raw === null ? structuredClone(initial) : (JSON.parse(raw) as T);
    } catch {
      return structuredClone(initial);
    }
  };
  const value = ref(load()) as Ref<T>;
  watch(value, (v) => localStorage.setItem(storageKey(), JSON.stringify(v)), { deep: true });
  // Client or page-key switch: swap to that scope's remembered filter (the
  // write watch then re-persists the loaded value to its own key — harmless).
  watch([clientId, pageKey], () => {
    value.value = load();
  });
  return value;
}
