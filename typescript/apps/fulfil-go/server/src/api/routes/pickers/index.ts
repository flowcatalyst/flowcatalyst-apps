/**
 * Admin routes for pick-context picker users (platform-OIDC authed — managed
 * by dispatchers/admins, NOT by pickers). Picker-facing auth lives under
 * /pick-auth. See docs/pick-context-auth.md.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ScopeStore, isFailure } from '@fulfil-go/framework';
import { CreatePickerCommandSchema, FulfilGoPermission } from '@fulfil-go/shared';
import type { AppContext } from '../../../app-context.js';
import { seedPickers } from '../../../infrastructure/picker-seeder.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { ErrorResponseSchema, UnauthorizedSchema, WRITE_RESPONSES } from '../../schemas/common.js';

const CreatePickerResponseSchema = Type.Object({
  pickerId: Type.String(),
  createdAt: Type.String(),
});

const PickerSummarySchema = Type.Object({
  id: Type.String(),
  storeRef: Type.String(),
  displayName: Type.String(),
  staffCode: Type.String(),
  primaryAuthMethod: Type.String(),
  status: Type.String(),
});

/** Route-level admin gate for the non-use-case endpoints (list, seed). */
function requireManagePickers(reply: FastifyReply): boolean {
  const scope = ScopeStore.get();
  if (!scope) {
    void reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
    return false;
  }
  if (!scope.permissions.has(FulfilGoPermission.ManagePickers)) {
    void reply.code(403).send({
      error: 'forbidden',
      code: 'PERMISSION_DENIED',
      message: `Missing permission ${FulfilGoPermission.ManagePickers}.`,
      details: null,
    });
    return false;
  }
  return true;
}

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

  fastify.get(
    '/clients/:clientId/pickers',
    {
      schema: {
        tags: ['Pickers'],
        params: Type.Object({ clientId: Type.String() }),
        querystring: Type.Object({ store: Type.Optional(Type.String()) }),
        response: {
          200: Type.Object({ pickers: Type.Array(PickerSummarySchema) }),
          401: UnauthorizedSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requireManagePickers(reply)) return reply;
      const { clientId } = request.params as { clientId: string };
      const { store } = request.query as { store?: string };
      const rows = await appContext.repositories.pickerUsers.listByClient(clientId, store);
      return reply.code(200).send({
        pickers: rows.map((p) => ({
          id: p.id,
          storeRef: p.storeRef,
          displayName: p.displayName,
          staffCode: p.staffCode,
          primaryAuthMethod: p.primaryAuthMethod,
          status: p.status,
        })),
      });
    },
  );

  // Lifecycle actions — thin shells over the manage-picker use cases (which
  // carry the ManagePickers check).
  const actionSchema = {
    tags: ['Pickers'],
    params: Type.Object({ clientId: Type.String(), pickerId: Type.String() }),
    response: {
      200: Type.Object({ pickerId: Type.String(), status: Type.String() }),
      ...WRITE_RESPONSES,
    },
  };
  const lifecycle = [
    { path: 'suspend', run: appContext.useCases.suspendPicker, status: 'suspended' },
    { path: 'reactivate', run: appContext.useCases.reactivatePicker, status: 'active' },
  ] as const;
  for (const action of lifecycle) {
    fastify.post(
      `/clients/:clientId/pickers/:pickerId/${action.path}`,
      { schema: actionSchema },
      async (request, reply) => {
        if (!ScopeStore.get()) {
          return reply
            .code(401)
            .send({ error: 'Unauthorized', message: 'Authentication required.' });
        }
        const { clientId, pickerId } = request.params as { clientId: string; pickerId: string };
        const result = await appContext.runWrite(() => action.run.execute({ clientId, pickerId }));
        if (isFailure(result)) return sendUseCaseError(reply, result.error);
        return reply.code(200).send({ pickerId, status: action.status });
      },
    );
  }

  fastify.post(
    '/clients/:clientId/pickers/:pickerId/reassign',
    {
      schema: {
        tags: ['Pickers'],
        params: Type.Object({ clientId: Type.String(), pickerId: Type.String() }),
        body: Type.Object({ storeRef: Type.String({ minLength: 1, maxLength: 64 }) }),
        response: {
          200: Type.Object({ pickerId: Type.String(), storeRef: Type.String() }),
          ...WRITE_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId, pickerId } = request.params as { clientId: string; pickerId: string };
      const { storeRef } = request.body as { storeRef: string };
      const result = await appContext.runWrite(() =>
        appContext.useCases.reassignPicker.execute({ clientId, pickerId, storeRef }),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);
      return reply.code(200).send({ pickerId, storeRef });
    },
  );

  fastify.delete(
    '/clients/:clientId/pickers/:pickerId',
    {
      schema: {
        tags: ['Pickers'],
        params: Type.Object({ clientId: Type.String(), pickerId: Type.String() }),
        response: {
          200: Type.Object({ pickerId: Type.String(), deleted: Type.Boolean() }),
          ...WRITE_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId, pickerId } = request.params as { clientId: string; pickerId: string };
      const result = await appContext.runWrite(() =>
        appContext.useCases.deletePicker.execute({ clientId, pickerId }),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);
      return reply.code(200).send({ pickerId, deleted: true });
    },
  );

  // Dev/test bulk seeding — N pickers per registry store with one shared PIN.
  // Idempotent (existing staff codes skipped); see picker-seeder.ts.
  fastify.post(
    '/clients/:clientId/pickers/seed',
    {
      schema: {
        tags: ['Pickers'],
        params: Type.Object({ clientId: Type.String() }),
        body: Type.Object({
          perStore: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
          pin: Type.Optional(Type.String({ pattern: '^\\d{4,8}$' })),
          /** Also rotate EXISTING seeded pickers (P<nn>) onto this PIN. */
          resetPins: Type.Optional(Type.Boolean()),
        }),
        response: {
          200: Type.Object({
            stores: Type.Integer(),
            created: Type.Integer(),
            skipped: Type.Integer(),
            pinsReset: Type.Integer(),
            pin: Type.String(),
          }),
          400: ErrorResponseSchema,
          401: UnauthorizedSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requireManagePickers(reply)) return reply;
      const { clientId } = request.params as { clientId: string };
      const body = request.body as { perStore?: number; pin?: string; resetPins?: boolean };
      // '385345' = FULFIL on a phone keypad — memorable, and unlike 123456
      // not in breached-password corpora (Chrome flags those on PIN inputs).
      const pin = body.pin ?? '385345';
      const result = await seedPickers(
        appContext.repositories.stores,
        appContext.repositories.pickerUsers,
        { clientId, perStore: body.perStore ?? 10, pin, resetPins: body.resetPins ?? false },
      );
      // Echo the PIN so the admin UI can show how to log the test pickers in.
      return reply.code(200).send({ ...result, pin });
    },
  );
}
