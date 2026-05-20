/**
 * POST /verify-match — debug route exposing the address verifier directly.
 *
 * The Rust pinpoint does NOT expose this — verification is internal to
 * the matching pipeline (Slice 8). Pinpoint TS adds it as a Slice 7
 * affordance so the LLM prompt can be exercised end-to-end without
 * having to drive a full master-locations flow first. Mirrors the
 * Slice 6 `POST /geocode/*` debug-route pattern.
 *
 * 200 with a verdict body when the verifier returned a result.
 * 204 (No Content) when the verifier returned null (disabled OR provider
 * failed — the route deliberately does NOT distinguish, since callers
 * should treat both as "no verification opinion").
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@pinpoint/framework';
import type { AppContext } from '../../../app-context.js';

const VerifyMatchBodySchema = Type.Object({
  inputAddress: Type.String({ minLength: 1 }),
  candidateAddress: Type.String({ minLength: 1 }),
});

const VerifyMatchResponseSchema = Type.Object({
  matchConfirmed: Type.Boolean(),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  reasoning: Type.String(),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
});

export function registerVerifyMatchRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/verify-match',
    {
      schema: {
        tags: ['Verify'],
        body: VerifyMatchBodySchema,
        response: {
          200: VerifyMatchResponseSchema,
          204: Type.Null(),
          400: ErrorSchema,
          401: ErrorSchema,
          500: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const { inputAddress, candidateAddress } = request.body as {
        inputAddress: string;
        candidateAddress: string;
      };

      const result = await appContext.services.addressVerifier.verify(
        inputAddress,
        candidateAddress,
      );

      if (result === null) {
        // Either the Noop verifier is wired in (verification disabled),
        // or the underlying provider failed and we logged + returned null.
        // Both surface as 204 No Content — see route header comment.
        return reply.code(204).send();
      }

      return reply.code(200).send({
        matchConfirmed: result.match_confirmed,
        confidence: result.confidence,
        reasoning: result.reasoning,
      });
    },
  );
}
