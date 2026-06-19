import { generateSessionId, newSession, type Session, type SessionStore } from './session-store.js';

/**
 * Minimal interface for an ioredis-compatible client. Pass an `ioredis`
 * `Redis` instance — only these calls are used. Kept narrow so tests can
 * fake the client without standing up real Redis when they're not
 * exercising the driver itself.
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  /**
   * SCAN — used by `size()` to count session keys under the prefix.
   * Returns `[nextCursor, keys]`. We only ever call the `MATCH pat COUNT n`
   * form; the type matches ioredis' canonical overload.
   */
  scan(
    cursor: string | number,
    matchToken: 'MATCH',
    pattern: string,
    countToken: 'COUNT',
    count: string | number,
  ): Promise<[cursor: string, elements: string[]]>;
}

export interface RedisSessionStoreConfig {
  readonly client: RedisClient;
  /** Key prefix for namespacing. Defaults to `'pp:session:'`. */
  readonly prefix?: string;
}

interface PersistedSession extends Omit<Session, 'createdAt' | 'updatedAt'> {
  createdAt: string;
  updatedAt: string;
}

function serialize(session: Session): string {
  const row: PersistedSession = {
    ...session,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
  return JSON.stringify(row);
}

function deserialize(raw: string): Session {
  const row = JSON.parse(raw) as PersistedSession;
  return {
    ...row,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export function createRedisSessionStore(cfg: RedisSessionStoreConfig): SessionStore {
  const prefix = cfg.prefix ?? 'pp:session:';
  const { client } = cfg;
  const k = (id: string): string => `${prefix}${id}`;

  return {
    generateId: generateSessionId,

    async create(id: string, init: Partial<Session>): Promise<Session> {
      const session = newSession(id, init);
      await client.set(k(id), serialize(session));
      return session;
    },

    async get(id: string): Promise<Session | undefined> {
      const raw = await client.get(k(id));
      return raw === null ? undefined : deserialize(raw);
    },

    async update(id: string, patch: Partial<Session>): Promise<Session | undefined> {
      const raw = await client.get(k(id));
      if (raw === null) return undefined;
      const existing = deserialize(raw);
      const updated: Session = { ...existing, ...patch, updatedAt: new Date() };
      await client.set(k(id), serialize(updated));
      return updated;
    },

    async delete(id: string): Promise<boolean> {
      const removed = await client.del(k(id));
      return removed > 0;
    },

    async size(): Promise<number> {
      // SCAN with MATCH so a co-tenanted Redis (e.g. shared with cache
      // keys) doesn't inflate the count. Iterative — safe in prod.
      let cursor: string = '0';
      let count = 0;
      do {
        const [next, keys] = await client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
        count += keys.length;
        cursor = next;
      } while (cursor !== '0');
      return count;
    },
  };
}
