import type { FastifyReply, FastifyRequest } from 'fastify';
import { ScopeStore } from '@fulfil-go/framework';
import type { IdempotencyRepository } from '../../infrastructure/idempotency-repository.js';

export interface HandlerOutcome {
  readonly status: number;
  readonly body: unknown;
}

/**
 * Idempotency-Key handling for offline-queued mutations.
 *
 * - No key header → run the handler normally.
 * - Known key (same principal + endpoint) → replay the stored response
 *   without executing the handler.
 * - Known key, different principal/endpoint → 409 (key reuse).
 * - New key → run the handler, store the outcome (except 5xx — the queue
 *   should retry those), send it. Losing the insert race to a concurrent
 *   duplicate replays the winner's stored response.
 *
 * At-least-once caveat (documented in the plan): the store happens AFTER the
 * business tx commits, so a crash in between re-executes the command on
 * retry. The pick/trip use cases re-execute idempotently, which is why that window
 * is acceptable here. The stricter variant — inserting the key inside the
 * business tx — is a follow-up.
 */
export async function withIdempotency(
  repo: IdempotencyRepository,
  request: FastifyRequest,
  reply: FastifyReply,
  handler: () => Promise<HandlerOutcome>,
): Promise<void> {
  const header = request.headers['idempotency-key'];
  const key = typeof header === 'string' ? header.trim() : '';
  const scope = ScopeStore.get();

  if (key.length === 0 || key.length > 128 || !scope) {
    const outcome = await handler();
    return reply.code(outcome.status).send(outcome.body);
  }

  const endpoint = `${request.method} ${request.routeOptions.url ?? request.url}`;

  const existing = await repo.findByKey(key);
  if (existing) {
    if (existing.principalId !== scope.principalId || existing.endpoint !== endpoint) {
      return reply.code(409).send({
        error: 'business_rule',
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'This Idempotency-Key was already used for a different request.',
        details: null,
      });
    }
    reply.header('x-idempotent-replay', 'true');
    return reply.code(existing.responseStatus).send(existing.responseBody);
  }

  const outcome = await handler();

  if (outcome.status < 500) {
    const inserted = await repo.tryInsert({
      key,
      principalId: scope.principalId,
      endpoint,
      responseStatus: outcome.status,
      responseBody: outcome.body,
    });
    if (!inserted) {
      const winner = await repo.findByKey(key);
      if (winner) {
        reply.header('x-idempotent-replay', 'true');
        return reply.code(winner.responseStatus).send(winner.responseBody);
      }
    }
  }

  return reply.code(outcome.status).send(outcome.body);
}
