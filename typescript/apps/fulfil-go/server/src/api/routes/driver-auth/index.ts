/**
 * Driver-facing app auth (fulfil-go-issued session tokens, NOT platform
 * OIDC) — the picker pattern (Andrew 2026-07-13): staff code + PIN against
 * the driver's home DEPOT; no device pinning in v1 (device enrollment is
 * the shared phase-2 story).
 *
 * NOTE: `/driver-auth/*` should be rate-limited before prod (same deferral
 * as /pick-auth); PIN attempt-lockout is the interim brute-force guard.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@fulfil-go/framework';
import { DRIVER_SESSION_PERMISSIONS, PickerTokenResponseSchema } from '@fulfil-go/shared';
import type { AppContext } from '../../../app-context.js';
import { isDriverUserId, asDriverUserId } from '../../../domain/driver-identity/ids.js';
import { PickerTokenError } from '../../../auth/picker-token.js';
import { BadRequestSchema, ErrorResponseSchema, UnauthorizedSchema } from '../../schemas/common.js';

const PinLoginBodySchema = Type.Object(
  {
    /** Home depot — the driver's store registry ref. */
    storeRef: Type.String({ minLength: 1, maxLength: 64 }),
    staffCode: Type.String({ minLength: 1, maxLength: 32 }),
    pin: Type.String({ pattern: '^\\d{4,8}$' }),
  },
  { additionalProperties: false },
);

const MeResponseSchema = Type.Object({
  driverId: Type.String(),
  clientId: Type.String(),
  storeRef: Type.String(),
  displayName: Type.Union([Type.String(), Type.Null()]),
  defaultVehicleReg: Type.Union([Type.String(), Type.Null()]),
  permissions: Type.Array(Type.String()),
});

export function registerDriverAuthRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.post(
    '/clients/:clientId/driver-auth/login/pin',
    {
      schema: {
        tags: ['DriverAuth'],
        params: Type.Object({ clientId: Type.String() }),
        body: PinLoginBodySchema,
        response: {
          200: PickerTokenResponseSchema,
          400: BadRequestSchema,
          401: ErrorResponseSchema,
          423: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { clientId } = request.params as { clientId: string };
      const body = request.body as { storeRef: string; staffCode: string; pin: string };

      const outcome = await appContext.driverAuth.loginWithPin({
        clientId,
        storeRef: body.storeRef,
        staffCode: body.staffCode,
        pin: body.pin,
      });

      if (!outcome.ok) {
        return reply.code(outcome.status).send({
          error: outcome.code === 'DRIVER_LOCKED' ? 'locked' : 'unauthorized',
          code: outcome.code,
          message: outcome.message,
          details: null,
        });
      }

      return reply.code(200).send({
        tokenType: 'Bearer',
        accessToken: outcome.session.accessToken,
        refreshToken: outcome.session.refreshToken,
        expiresIn: outcome.session.expiresIn,
      });
    },
  );

  // Exchange a driver refresh token for a fresh session. Revocation bites
  // here: the driver is re-loaded and must still be active at the same
  // depot, so suspension/reassignment ends a session within one access TTL.
  fastify.post(
    '/clients/:clientId/driver-auth/refresh',
    {
      schema: {
        tags: ['DriverAuth'],
        params: Type.Object({ clientId: Type.String() }),
        body: Type.Object({ refreshToken: Type.String() }, { additionalProperties: false }),
        response: {
          200: PickerTokenResponseSchema,
          401: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { clientId } = request.params as { clientId: string };
      const { refreshToken } = request.body as { refreshToken: string };
      const invalid = () =>
        reply.code(401).send({
          error: 'unauthorized',
          code: 'INVALID_REFRESH_TOKEN',
          message: 'Refresh token is invalid or the driver is no longer active.',
          details: null,
        });

      let claims;
      try {
        claims = await appContext.auth.driverTokenService.verifyRefresh(refreshToken);
      } catch (err) {
        if (err instanceof PickerTokenError) return invalid();
        throw err;
      }
      if (claims.clientId !== clientId || !isDriverUserId(claims.pickerId)) return invalid();

      const driver = await appContext.repositories.driverUsers.findById(
        clientId,
        asDriverUserId(claims.pickerId),
      );
      if (!driver || driver.status !== 'active' || driver.storeRef !== claims.storeRef) {
        return invalid();
      }

      const session = await appContext.auth.driverTokenService.issueSession({
        pickerId: driver.id,
        clientId: driver.clientId,
        storeRef: driver.storeRef,
        permissions: [...DRIVER_SESSION_PERMISSIONS],
        deviceId: claims.deviceId ?? undefined,
      });
      return reply.code(200).send({
        tokenType: 'Bearer',
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresIn: session.expiresIn,
      });
    },
  );

  // Depot-scoped echo — the request Scope is populated from the driver
  // session token by extractRequestToken.
  fastify.get(
    '/clients/:clientId/driver-auth/me',
    {
      schema: {
        tags: ['DriverAuth'],
        params: Type.Object({ clientId: Type.String() }),
        response: {
          200: MeResponseSchema,
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
      const storeRef = scope.attributes['storeRef'];
      const tokenClientId = scope.attributes['clientId'];
      if (!storeRef || !tokenClientId || !isDriverUserId(scope.principalId)) {
        return reply.code(403).send({
          error: 'forbidden',
          code: 'NOT_A_DRIVER_SESSION',
          message: 'This endpoint requires a driver session token.',
          details: null,
        });
      }
      const { clientId } = request.params as { clientId: string };
      if (tokenClientId !== clientId) {
        return reply.code(403).send({
          error: 'forbidden',
          code: 'CLIENT_SCOPE_MISMATCH',
          message: 'Driver session is not scoped to this client.',
          details: null,
        });
      }

      const driver = await appContext.repositories.driverUsers.findById(
        clientId,
        asDriverUserId(scope.principalId),
      );
      return reply.code(200).send({
        driverId: scope.principalId,
        clientId: tokenClientId,
        storeRef,
        displayName: driver?.displayName ?? null,
        defaultVehicleReg: driver?.defaultVehicleReg ?? null,
        permissions: [...scope.permissions],
      });
    },
  );
}
