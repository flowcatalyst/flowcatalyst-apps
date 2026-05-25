/**
 * Redis testcontainer fixture. Lazy + shared across the integration
 * run, same pattern as `../db-fixture.ts`. Only used by the Redis
 * SessionStore tests today; safe to extend if more Redis-backed code
 * lands.
 */
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';

interface RedisFixtureState {
  readonly container: StartedRedisContainer;
  readonly client: Redis;
  readonly url: string;
}

let state: RedisFixtureState | null = null;
let startPromise: Promise<RedisFixtureState> | null = null;

async function bootstrap(): Promise<RedisFixtureState> {
  const container = await new RedisContainer('redis:7-alpine').start();
  const url = container.getConnectionUrl();
  const client = new Redis(url);
  return { container, client, url };
}

export async function getRedisFixture(): Promise<{ client: Redis; url: string }> {
  if (state) return { client: state.client, url: state.url };
  if (!startPromise) startPromise = bootstrap();
  state = await startPromise;
  return { client: state.client, url: state.url };
}

export async function flushRedis(): Promise<void> {
  if (!state) return;
  await state.client.flushdb();
}

export async function teardownRedisFixture(): Promise<void> {
  if (!state) return;
  state.client.disconnect();
  await state.container.stop();
  state = null;
  startPromise = null;
}
