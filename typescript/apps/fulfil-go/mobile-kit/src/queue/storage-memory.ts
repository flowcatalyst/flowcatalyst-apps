import type { QueueCounts, QueueItem, QueueStorage } from './queue-storage.js';

/**
 * In-memory queue storage with best-effort localStorage persistence —
 * browser dev mode's storage (dodges the jeep-sqlite wasm setup). On-device
 * builds use the SQLite storage instead.
 */
export function createMemoryQueueStorage(persistKey?: string): QueueStorage {
  let items: QueueItem[] = load();

  function load(): QueueItem[] {
    if (!persistKey || typeof localStorage === 'undefined') return [];
    try {
      return JSON.parse(localStorage.getItem(persistKey) ?? '[]') as QueueItem[];
    } catch {
      return [];
    }
  }

  function persist(): void {
    if (!persistKey || typeof localStorage === 'undefined') return;
    localStorage.setItem(persistKey, JSON.stringify(items));
  }

  return {
    async insert(item): Promise<void> {
      items.push(item);
      persist();
    },
    async update(item): Promise<void> {
      items = items.map((i) => (i.id === item.id ? item : i));
      persist();
    },
    async remove(id): Promise<void> {
      items = items.filter((i) => i.id !== id);
      persist();
    },
    async listDue(now, limit): Promise<readonly QueueItem[]> {
      return items
        .filter((i) => i.status === 'pending' && i.nextAttemptAt <= now)
        .toSorted((a, b) => a.createdAt - b.createdAt)
        .slice(0, limit);
    },
    async listDead(): Promise<readonly QueueItem[]> {
      return items.filter((i) => i.status === 'dead');
    },
    async counts(): Promise<QueueCounts> {
      return {
        pending: items.filter((i) => i.status === 'pending').length,
        dead: items.filter((i) => i.status === 'dead').length,
      };
    },
  };
}
