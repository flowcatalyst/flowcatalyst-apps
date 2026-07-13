/**
 * Admin routes for transport-context driver users (platform-OIDC authed —
 * managed by dispatchers/admins, NOT by drivers). Driver-facing auth lives
 * under /driver-auth. The picker admin surface, mirrored.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ScopeStore, isFailure } from '@fulfil-go/framework';
import { FulfilGoPermission } from '@fulfil-go/shared';
import type { AppContext } from '../../../app-context.js';
import { seedDrivers } from '../../../infrastructure/driver-seeder.js';
import { sendUseCaseError } from '../../plugins/error-mapper.js';
import { ErrorResponseSchema, UnauthorizedSchema, WRITE_RESPONSES } from '../../schemas/common.js';

const CreateDriverBodySchema = Type.Object(
  {
    storeRef: Type.String({ minLength: 1, maxLength: 64 }),
    displayName: Type.String({ minLength: 1, maxLength: 120 }),
    staffCode: Type.String({ minLength: 1, maxLength: 32 }),
    pin: Type.String({ pattern: '^\\d{4,8}$' }),
    defaultVehicleReg: Type.Optional(Type.String({ maxLength: 32 })),
  },
  { additionalProperties: false },
);

const CreateDriverResponseSchema = Type.Object({
  driverId: Type.String(),
  createdAt: Type.String(),
});

const DriverSummarySchema = Type.Object({
  id: Type.String(),
  storeRef: Type.String(),
  displayName: Type.String(),
  staffCode: Type.String(),
  status: Type.String(),
  defaultVehicleReg: Type.Union([Type.String(), Type.Null()]),
});

/** Route-level admin gate for the non-use-case endpoints (list, seed). */
function requireManageDrivers(reply: FastifyReply): boolean {
  const scope = ScopeStore.get();
  if (!scope) {
    void reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
    return false;
  }
  if (!scope.permissions.has(FulfilGoPermission.ManageDrivers)) {
    void reply.code(403).send({
      error: 'forbidden',
      code: 'PERMISSION_DENIED',
      message: `Missing permission ${FulfilGoPermission.ManageDrivers}.`,
      details: null,
    });
    return false;
  }
  return true;
}

export function registerDriverAdminRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.post(
    '/clients/:clientId/drivers',
    {
      schema: {
        tags: ['Drivers'],
        params: Type.Object({ clientId: Type.String() }),
        body: CreateDriverBodySchema,
        response: {
          201: CreateDriverResponseSchema,
          ...WRITE_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId } = request.params as { clientId: string };
      const body = request.body as {
        storeRef: string;
        displayName: string;
        staffCode: string;
        pin: string;
        defaultVehicleReg?: string;
      };
      const result = await appContext.runWrite(() =>
        appContext.useCases.createDriver.execute({
          clientId,
          storeRef: body.storeRef,
          displayName: body.displayName,
          staffCode: body.staffCode,
          pin: body.pin,
          defaultVehicleReg: body.defaultVehicleReg ?? null,
        }),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);

      return reply.code(201).send({
        driverId: result.value.getData().driverId,
        createdAt: result.value.time.toISOString(),
      });
    },
  );

  fastify.get(
    '/clients/:clientId/drivers',
    {
      schema: {
        tags: ['Drivers'],
        params: Type.Object({ clientId: Type.String() }),
        querystring: Type.Object({ store: Type.Optional(Type.String()) }),
        response: {
          200: Type.Object({ drivers: Type.Array(DriverSummarySchema) }),
          401: UnauthorizedSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requireManageDrivers(reply)) return reply;
      const { clientId } = request.params as { clientId: string };
      const { store } = request.query as { store?: string };
      const rows = await appContext.repositories.driverUsers.listByClient(clientId, store);
      return reply.code(200).send({
        drivers: rows.map((d) => ({
          id: d.id,
          storeRef: d.storeRef,
          displayName: d.displayName,
          staffCode: d.staffCode,
          status: d.status,
          defaultVehicleReg: d.defaultVehicleReg,
        })),
      });
    },
  );

  // Lifecycle actions — thin shells over the manage-driver use cases (which
  // carry the ManageDrivers check).
  const actionSchema = {
    tags: ['Drivers'],
    params: Type.Object({ clientId: Type.String(), driverId: Type.String() }),
    response: {
      200: Type.Object({ driverId: Type.String(), status: Type.String() }),
      ...WRITE_RESPONSES,
    },
  };
  const lifecycle = [
    { path: 'suspend', run: appContext.useCases.suspendDriver, status: 'suspended' },
    { path: 'reactivate', run: appContext.useCases.reactivateDriver, status: 'active' },
  ] as const;
  for (const action of lifecycle) {
    fastify.post(
      `/clients/:clientId/drivers/:driverId/${action.path}`,
      { schema: actionSchema },
      async (request, reply) => {
        if (!ScopeStore.get()) {
          return reply
            .code(401)
            .send({ error: 'Unauthorized', message: 'Authentication required.' });
        }
        const { clientId, driverId } = request.params as { clientId: string; driverId: string };
        const result = await appContext.runWrite(() => action.run.execute({ clientId, driverId }));
        if (isFailure(result)) return sendUseCaseError(reply, result.error);
        return reply.code(200).send({ driverId, status: action.status });
      },
    );
  }

  fastify.post(
    '/clients/:clientId/drivers/:driverId/reassign',
    {
      schema: {
        tags: ['Drivers'],
        params: Type.Object({ clientId: Type.String(), driverId: Type.String() }),
        body: Type.Object({ storeRef: Type.String({ minLength: 1, maxLength: 64 }) }),
        response: {
          200: Type.Object({ driverId: Type.String(), storeRef: Type.String() }),
          ...WRITE_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId, driverId } = request.params as { clientId: string; driverId: string };
      const { storeRef } = request.body as { storeRef: string };
      const result = await appContext.runWrite(() =>
        appContext.useCases.reassignDriver.execute({ clientId, driverId, storeRef }),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);
      return reply.code(200).send({ driverId, storeRef });
    },
  );

  fastify.delete(
    '/clients/:clientId/drivers/:driverId',
    {
      schema: {
        tags: ['Drivers'],
        params: Type.Object({ clientId: Type.String(), driverId: Type.String() }),
        response: {
          200: Type.Object({ driverId: Type.String(), deleted: Type.Boolean() }),
          ...WRITE_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId, driverId } = request.params as { clientId: string; driverId: string };
      const result = await appContext.runWrite(() =>
        appContext.useCases.deleteDriver.execute({ clientId, driverId }),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);
      return reply.code(200).send({ driverId, deleted: true });
    },
  );

  // Dev/test bulk seeding — N drivers per registry store (home depot) with
  // one shared PIN + deterministic vehicle regs. Idempotent (existing staff
  // codes skipped); see driver-seeder.ts.
  fastify.post(
    '/clients/:clientId/drivers/seed',
    {
      schema: {
        tags: ['Drivers'],
        params: Type.Object({ clientId: Type.String() }),
        body: Type.Object({
          perStore: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
          pin: Type.Optional(Type.String({ pattern: '^\\d{4,8}$' })),
          /** Also rotate EXISTING seeded drivers (D<nn>) onto this PIN. */
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
      if (!requireManageDrivers(reply)) return reply;
      const { clientId } = request.params as { clientId: string };
      const body = request.body as { perStore?: number; pin?: string; resetPins?: boolean };
      // '374837' = DRIVER on a phone keypad — same convention as the picker
      // seeder's FULFIL PIN, and not in breached-password corpora.
      const pin = body.pin ?? '374837';
      const result = await seedDrivers(
        appContext.repositories.stores,
        appContext.repositories.driverUsers,
        { clientId, perStore: body.perStore ?? 3, pin, resetPins: body.resetPins ?? false },
      );
      // Echo the PIN so the admin UI can show how to log the test drivers in.
      return reply.code(200).send({ ...result, pin });
    },
  );
}
