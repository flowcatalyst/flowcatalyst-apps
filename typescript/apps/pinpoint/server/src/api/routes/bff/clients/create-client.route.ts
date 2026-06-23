/**
 * BFF client create. The Vue SPA's "New Client" form posts `{ name }` to
 * `/bff/clients` (the canonical surface lives at POST `/clients` and requires
 * an explicit `code`). The BFF derives a `code` from the name when one isn't
 * supplied so the UI can stay name-only, then delegates to the same
 * `createClient` use case — which enforces the `TenancyClientCreate`
 * permission and the unique-code business rule.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@pinpoint/framework';
import type { AppContext } from '../../../../app-context.js';
import { sendUseCaseError } from '../../../plugins/error-mapper.js';

const CreateClientBodySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  code: Type.Optional(Type.String()),
});

const CreateClientResponseSchema = Type.Object({
  id: Type.String(),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
});

/**
 * Derive a client code from its display name: uppercase, non-alphanumerics
 * collapsed to underscores, trimmed, capped at 32 chars. Falls back to
 * `CLIENT` if the name has no usable characters. Collisions surface as the
 * use case's `CLIENT_CODE_EXISTS` business-rule failure (HTTP 409).
 */
function deriveCode(name: string): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return slug.length > 0 ? slug : 'CLIENT';
}

export function registerBffCreateClientRoute(
  fastify: FastifyInstance,
  appContext: AppContext,
): void {
  fastify.post(
    '/bff/clients',
    {
      schema: {
        tags: ['BFF'],
        body: CreateClientBodySchema,
        response: {
          201: CreateClientResponseSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          409: ErrorSchema,
          500: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const body = request.body as { name: string; code?: string };
      const name = body.name.trim();
      if (name.length === 0) {
        return reply.code(400).send({ error: 'ValidationError', message: 'name is required.' });
      }
      const code = (body.code ?? '').trim() || deriveCode(name);

      const result = await appContext.runWrite(() =>
        appContext.useCases.createClient.execute({ name, code }),
      );

      if (isFailure(result)) {
        return sendUseCaseError(reply, result.error);
      }

      return reply.code(201).send({ id: result.value.getData().clientId });
    },
  );
}
