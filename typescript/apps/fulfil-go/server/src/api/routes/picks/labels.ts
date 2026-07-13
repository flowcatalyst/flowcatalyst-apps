/**
 * Bag-label endpoints on the pick (docs/bag-label-printing.md) — picker-
 * session only, claimer-only (the use cases share report-pick-outcome's
 * guard). The server allocates refs + renders ZPL; the picking app delivers
 * to the LAN printer.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@fulfil-go/framework';
import {
  AllocatePickLabelsCommandSchema,
  FulfilGoPermission,
  PickLabelAllocationDtoSchema,
  PickLabelDocumentSchema,
  ReprintPickLabelCommandSchema,
} from '@fulfil-go/shared';
import type { AppContext } from '../../../app-context.js';
import { asPickId, isPickId } from '../../../domain/picks/ids.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { ErrorResponseSchema, UnauthorizedSchema, WRITE_RESPONSES } from '../../schemas/common.js';

const LabelsResponseSchema = Type.Object({
  pickId: Type.String(),
  allocation: PickLabelAllocationDtoSchema,
  documents: Type.Array(PickLabelDocumentSchema),
});

export function registerPickLabelRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  // Allocate (first print) / replace (new count) / re-render (same count)
  // the pick's bag-label set. Responds with ZPL for every active label.
  fastify.put(
    '/clients/:clientId/picks/:pickId/labels',
    {
      schema: {
        tags: ['Picks'],
        params: Type.Object({ clientId: Type.String(), pickId: Type.String() }),
        body: Type.Any(),
        response: { 200: LabelsResponseSchema, ...WRITE_RESPONSES },
      },
    },
    async (request, reply) => {
      const params = request.params as { clientId: string; pickId: string };
      const parsed = AllocatePickLabelsCommandSchema.safeParse({
        ...(request.body as object | null),
        clientId: params.clientId,
        pickId: params.pickId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const result = await appContext.runWrite(() =>
        appContext.useCases.allocatePickLabels.execute(parsed.data),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);
      return reply.code(200).send(result.value);
    },
  );

  // Reprint ONE damaged label — same ref, same barcode, reprint recorded.
  fastify.post(
    '/clients/:clientId/picks/:pickId/labels/:seq/reprint',
    {
      schema: {
        tags: ['Picks'],
        params: Type.Object({
          clientId: Type.String(),
          pickId: Type.String(),
          seq: Type.Integer({ minimum: 1 }),
        }),
        body: Type.Any(),
        response: { 200: LabelsResponseSchema, ...WRITE_RESPONSES },
      },
    },
    async (request, reply) => {
      const params = request.params as { clientId: string; pickId: string; seq: number };
      const parsed = ReprintPickLabelCommandSchema.safeParse({
        ...(request.body as object | null),
        clientId: params.clientId,
        pickId: params.pickId,
        seq: Number(params.seq),
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const result = await appContext.runWrite(() =>
        appContext.useCases.reprintPickLabel.execute(parsed.data),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);
      return reply.code(200).send(result.value);
    },
  );

  // Recovery read: the label set survives station restarts / station swaps
  // (the WIP trolley is device-local, the allocation is not).
  fastify.get(
    '/clients/:clientId/picks/:pickId/labels',
    {
      schema: {
        tags: ['Picks'],
        params: Type.Object({ clientId: Type.String(), pickId: Type.String() }),
        response: {
          200: Type.Object({
            pickId: Type.String(),
            allocation: Type.Union([PickLabelAllocationDtoSchema, Type.Null()]),
          }),
          401: UnauthorizedSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId, pickId } = request.params as { clientId: string; pickId: string };
      const storeRef = scope.attributes['storeRef'];
      const scopeClientId = scope.attributes['clientId'];
      if (
        !storeRef ||
        scopeClientId !== clientId ||
        !scope.permissions.has(FulfilGoPermission.ViewStorePicks)
      ) {
        return reply.code(403).send({
          error: 'forbidden',
          code: 'NOT_A_PICKER_SESSION',
          message: 'Reading bag labels requires a picker session scoped to this client.',
          details: null,
        });
      }
      const notFound = () =>
        reply.code(404).send({
          error: 'not_found',
          code: 'PICK_NOT_FOUND',
          message: `Pick '${pickId}' does not exist.`,
          details: null,
        });
      if (!isPickId(pickId)) return notFound();
      const pick = await appContext.repositories.picks.findById(clientId, asPickId(pickId));
      if (!pick || pick.storeRef !== storeRef) return notFound();
      return reply.code(200).send({
        pickId: pick.id,
        allocation: pick.labels
          ? {
              count: pick.labels.count,
              labels: pick.labels.labels.map((l) => ({ ...l })),
              voidedRefs: [...pick.labels.voidedRefs],
            }
          : null,
      });
    },
  );
}
