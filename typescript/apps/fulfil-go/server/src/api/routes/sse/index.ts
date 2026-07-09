import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@fulfil-go/framework';
import type { AppContext } from '../../../app-context.js';
import {
  userChannel,
  type SyncEventRecord,
} from '../../../infrastructure/sync-event-repository.js';

/**
 * Heartbeat cadence: 25s sits under typical 30–60s LB idle timeouts. The
 * frame is an SSE comment, invisible to EventSource consumers.
 */
const HEARTBEAT_MS = 25_000;
/** Replay cap per reconnect — a client further behind should delta-sync first. */
const REPLAY_LIMIT = 1_000;

function frame(record: SyncEventRecord): string {
  return `id: ${record.id}\nevent: ${record.eventType}\ndata: ${JSON.stringify(record.payload)}\n\n`;
}

/**
 * GET /sse/channel — the per-principal event stream.
 *
 * Resume contract: every frame carries the sync_events id; clients reconnect
 * with `Last-Event-ID` (header, per the SSE spec — or `?lastEventId=` for
 * clients that can't set headers) and missed events replay from the table
 * before the live subscription takes over.
 */
export function registerSseRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.get('/sse/channel', { schema: { hide: true } }, async (request, reply) => {
    const scope = ScopeStore.get();
    if (!scope) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
    }
    const channel = userChannel(scope.principalId);

    const headerId = request.headers['last-event-id'];
    const queryId = (request.query as { lastEventId?: string }).lastEventId;
    const lastEventId = Number(
      (typeof headerId === 'string' ? headerId : undefined) ?? queryId ?? NaN,
    );

    // Take over the socket: Fastify serialization/hooks are done with this
    // request, the stream is ours until the client disconnects.
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      // Tell nginx-style proxies not to buffer the stream.
      'x-accel-buffering': 'no',
    });
    reply.raw.write(`retry: 3000\n\n`);

    // Replay BEFORE subscribing, then subscribe and de-dupe by id: the
    // subscriber drops anything at or below the replay high-water mark, so
    // an event landing during replay is delivered exactly once.
    let delivered = Number.isFinite(lastEventId) ? lastEventId : 0;
    if (Number.isFinite(lastEventId)) {
      const missed = await appContext.repositories.syncEvents.listAfter(
        channel,
        lastEventId,
        REPLAY_LIMIT,
      );
      for (const record of missed) {
        delivered = record.id;
        reply.raw.write(frame(record));
      }
    }

    const unsubscribe = appContext.sseBroker.subscribe(channel, (record) => {
      if (record.id <= delivered) return;
      delivered = record.id;
      reply.raw.write(frame(record));
    });

    const heartbeat = setInterval(() => {
      reply.raw.write(`: ping\n\n`);
    }, HEARTBEAT_MS);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });
  });
}
