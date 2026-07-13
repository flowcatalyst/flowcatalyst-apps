/**
 * Store-bound printer registry (docs/bag-label-printing.md) — reference-data
 * CRUD like stores/config: routes drive the repository directly, Zod is the
 * write validator, platform-OIDC `ManageStores` gates writes. The GET also
 * answers PICKER SESSIONS (scoped to the token's store) — that's how the
 * picking station's Settings page lists candidates for its printer binding.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@fulfil-go/framework';
import {
  CreatePrinterCommandSchema,
  FulfilGoPermission,
  PrinterDtoSchema,
  UpdatePrinterCommandSchema,
} from '@fulfil-go/shared';
import type { AppContext } from '../../../app-context.js';
import type { PrinterRow } from '../../../infrastructure/schema/printers.js';
import { ErrorResponseSchema, UnauthorizedSchema } from '../../schemas/common.js';

function isUniqueNameViolation(err: unknown): boolean {
  for (let e = err; e instanceof Error; e = e.cause) {
    if (/uq_printers_client_store_name/.test(e.message)) return true;
  }
  return false;
}

function toDto(row: PrinterRow) {
  return {
    id: row.id,
    clientId: row.clientId,
    storeRef: row.storeRef,
    name: row.name,
    host: row.host,
    port: row.port,
    dpi: row.dpi,
    labelWidthMm: row.labelWidthMm,
    labelHeightMm: row.labelHeightMm,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function registerPrinterRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  const printers = appContext.repositories.printers;

  /** Scope with ManageStores, or null after replying 401/403 — write gate. */
  const requireManageStores = (reply: {
    code: (status: 401 | 403) => { send: (body: unknown) => unknown };
  }) => {
    const scope = ScopeStore.get();
    if (!scope) {
      reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      return null;
    }
    if (!scope.permissions.has(FulfilGoPermission.ManageStores)) {
      reply.code(403).send({
        error: 'forbidden',
        code: 'PERMISSION_DENIED',
        message: `Missing permission ${FulfilGoPermission.ManageStores}.`,
        details: null,
      });
      return null;
    }
    return scope;
  };

  fastify.get(
    '/clients/:clientId/printers',
    {
      schema: {
        tags: ['Printers'],
        params: Type.Object({ clientId: Type.String() }),
        querystring: Type.Object({ storeRef: Type.Optional(Type.String()) }),
        response: {
          200: Type.Object({ printers: Type.Array(PrinterDtoSchema) }),
          401: UnauthorizedSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId } = request.params as { clientId: string };
      const { storeRef } = request.query as { storeRef?: string };

      if (scope.permissions.has(FulfilGoPermission.ManageStores)) {
        const rows = await printers.listByClient(clientId, storeRef);
        return reply.code(200).send({ printers: rows.map(toDto) });
      }
      // Picker session: the station only ever sees ITS store's printers.
      const sessionStore = scope.attributes['storeRef'];
      const scopeClientId = scope.attributes['clientId'];
      if (
        !sessionStore ||
        scopeClientId !== clientId ||
        !scope.permissions.has(FulfilGoPermission.ViewStorePicks) ||
        (storeRef !== undefined && storeRef !== sessionStore)
      ) {
        return reply.code(403).send({
          error: 'forbidden',
          code: 'PERMISSION_DENIED',
          message: 'Listing printers requires store management or a picker session for the store.',
          details: null,
        });
      }
      const rows = await printers.listByClient(clientId, sessionStore);
      return reply.code(200).send({ printers: rows.map(toDto) });
    },
  );

  fastify.post(
    '/clients/:clientId/printers',
    {
      schema: {
        tags: ['Printers'],
        params: Type.Object({ clientId: Type.String() }),
        body: Type.Any(),
        response: {
          200: Type.Object({ printer: PrinterDtoSchema }),
          400: ErrorResponseSchema,
          401: UnauthorizedSchema,
          403: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requireManageStores(reply)) return reply;
      const { clientId } = request.params as { clientId: string };
      const parsed = CreatePrinterCommandSchema.safeParse({
        ...(request.body as object | null),
        clientId,
      });
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation',
          code: 'PRINTER_INVALID',
          message: 'Printer payload failed validation.',
          details: parsed.error.issues,
        });
      }
      const store = await appContext.repositories.stores.findByRef(clientId, parsed.data.storeRef);
      if (!store) {
        return reply.code(400).send({
          error: 'validation',
          code: 'STORE_NOT_FOUND',
          message: `Store '${parsed.data.storeRef}' does not exist.`,
          details: null,
        });
      }
      const { clientId: _c, ...fields } = parsed.data;
      try {
        const row = await printers.create({ clientId, ...fields });
        return reply.code(200).send({ printer: toDto(row) });
      } catch (err) {
        // Unique (client, store, name) — a duplicate name at the store.
        // Drizzle 1.0 wraps the pg error, so the constraint name is on the
        // CAUSE's message, not the wrapper's.
        if (isUniqueNameViolation(err)) {
          return reply.code(409).send({
            error: 'conflict',
            code: 'PRINTER_NAME_TAKEN',
            message: `A printer named '${fields.name}' already exists at '${fields.storeRef}'.`,
            details: null,
          });
        }
        throw err;
      }
    },
  );

  fastify.patch(
    '/clients/:clientId/printers/:printerId',
    {
      schema: {
        tags: ['Printers'],
        params: Type.Object({ clientId: Type.String(), printerId: Type.String() }),
        body: Type.Any(),
        response: {
          200: Type.Object({ printer: PrinterDtoSchema }),
          400: ErrorResponseSchema,
          401: UnauthorizedSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requireManageStores(reply)) return reply;
      const { clientId, printerId } = request.params as { clientId: string; printerId: string };
      const parsed = UpdatePrinterCommandSchema.safeParse({
        ...(request.body as object | null),
        clientId,
        printerId,
      });
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation',
          code: 'PRINTER_INVALID',
          message: 'Printer payload failed validation.',
          details: parsed.error.issues,
        });
      }
      const { clientId: _c, printerId: _p, ...rest } = parsed.data;
      // Zod optionals arrive as explicit undefined — strip them for the
      // repo's exactOptionalPropertyTypes-safe Partial patch.
      const patch = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      ) as Parameters<typeof printers.update>[2];
      const row = await printers.update(clientId, printerId, patch);
      if (!row) {
        return reply.code(404).send({
          error: 'not_found',
          code: 'PRINTER_NOT_FOUND',
          message: `Printer '${printerId}' does not exist.`,
          details: null,
        });
      }
      return reply.code(200).send({ printer: toDto(row) });
    },
  );

  fastify.delete(
    '/clients/:clientId/printers/:printerId',
    {
      schema: {
        tags: ['Printers'],
        params: Type.Object({ clientId: Type.String(), printerId: Type.String() }),
        response: {
          200: Type.Object({ deleted: Type.Boolean() }),
          401: UnauthorizedSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!requireManageStores(reply)) return reply;
      const { clientId, printerId } = request.params as { clientId: string; printerId: string };
      const deleted = await printers.delete(clientId, printerId);
      if (!deleted) {
        return reply.code(404).send({
          error: 'not_found',
          code: 'PRINTER_NOT_FOUND',
          message: `Printer '${printerId}' does not exist.`,
          details: null,
        });
      }
      return reply.code(200).send({ deleted: true });
    },
  );
}
