/**
 * Admin routes for pick-context picker users (platform-OIDC authed — managed
 * by dispatchers/admins, NOT by pickers). Picker-facing auth lives under
 * /pick-auth. See docs/pick-context-auth.md.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@fulfil-go/framework';
import { CreatePickerCommandSchema } from '@fulfil-go/shared';
import type { AppContext } from '../../../app-context.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { WRITE_RESPONSES } from '../../schemas/common.js';

const CreatePickerResponseSchema = Type.Object({
  pickerId: Type.String(),
  createdAt: Type.String(),
});

export function registerPickerAdminRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.post(
    '/clients/:clientId/pickers',
    {
      schema: {
        tags: ['Pickers'],
        params: Type.Object({ clientId: Type.String() }),
        body: Type.Any(),
        response: {
          201: CreatePickerResponseSchema,
          ...WRITE_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      const parsed = CreatePickerCommandSchema.safeParse({
        ...(request.body as object | null),
        clientId: (request.params as { clientId: string }).clientId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.createPicker.execute(parsed.data),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);

      return reply.code(201).send({
        pickerId: result.value.getData().pickerId,
        createdAt: result.value.time.toISOString(),
      });
    },
  );
}
