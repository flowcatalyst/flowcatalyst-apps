/**
 * Picker-facing station auth (fulfil-go-issued session tokens, NOT platform
 * OIDC). Slice scope: PIN login + a store-scoped `me` echo that proves the
 * session token threads storeRef/clientId onto the request Scope.
 *
 * On a shared station the device is store-bound, so the full design derives
 * `storeRef` from the device credential. Until device enrollment lands, the
 * login request carries `storeRef` explicitly.
 *
 * NOTE: `/pick-auth/*` should be rate-limited before prod — deferred with the
 * rest of Phase 3; PIN attempt-lockout is the interim brute-force guard.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore } from '@fulfil-go/framework';
import { PICKER_SESSION_PERMISSIONS, PickerTokenResponseSchema } from '@fulfil-go/shared';
import type { AppContext } from '../../../app-context.js';
import { isPickerUserId, asPickerUserId } from '../../../domain/pick-identity/ids.js';
import { PickerTokenError } from '../../../auth/picker-token.js';
import { BadRequestSchema, ErrorResponseSchema, UnauthorizedSchema } from '../../schemas/common.js';

const PinLoginBodySchema = Type.Object(
  {
    storeRef: Type.String({ minLength: 1, maxLength: 64 }),
    staffCode: Type.String({ minLength: 1, maxLength: 32 }),
    pin: Type.String({ pattern: '^\\d{4,8}$' }),
  },
  { additionalProperties: false },
);

const MeResponseSchema = Type.Object({
  pickerId: Type.String(),
  clientId: Type.String(),
  storeRef: Type.String(),
  permissions: Type.Array(Type.String()),
});

export function registerPickAuthRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.post(
    '/clients/:clientId/pick-auth/login/pin',
    {
      schema: {
        tags: ['PickAuth'],
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

      const outcome = await appContext.pickAuth.loginWithPin({
        clientId,
        storeRef: body.storeRef,
        staffCode: body.staffCode,
        pin: body.pin,
      });

      if (!outcome.ok) {
        return reply.code(outcome.status).send({
          error: outcome.code === 'PICKER_LOCKED' ? 'locked' : 'unauthorized',
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

  // Exchange a picker refresh token for a fresh session. This is also where
  // revocation bites: the picker is re-loaded and must still be active, so a
  // suspension takes effect within one access-token TTL.
  fastify.post(
    '/clients/:clientId/pick-auth/refresh',
    {
      schema: {
        tags: ['PickAuth'],
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
          message: 'Refresh token is invalid or the picker is no longer active.',
          details: null,
        });

      let claims;
      try {
        claims = await appContext.auth.pickerTokenService.verifyRefresh(refreshToken);
      } catch (err) {
        if (err instanceof PickerTokenError) return invalid();
        throw err;
      }
      if (claims.clientId !== clientId || !isPickerUserId(claims.pickerId)) return invalid();

      const picker = await appContext.repositories.pickerUsers.findById(
        clientId,
        asPickerUserId(claims.pickerId),
      );
      // Re-check liveness AND the store binding — a picker moved to another
      // store must not keep refreshing a session scoped to the old one.
      if (!picker || picker.status !== 'active' || picker.storeRef !== claims.storeRef) {
        return invalid();
      }

      const session = await appContext.auth.pickerTokenService.issueSession({
        pickerId: picker.id,
        clientId: picker.clientId,
        storeRef: picker.storeRef,
        permissions: [...PICKER_SESSION_PERMISSIONS],
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

  // Store-scoped echo — the request Scope is populated from the picker session
  // token by extractRequestToken. Rejects a token used against another client.
  fastify.get(
    '/clients/:clientId/pick-auth/me',
    {
      schema: {
        tags: ['PickAuth'],
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
      if (!storeRef || !tokenClientId) {
        return reply.code(403).send({
          error: 'forbidden',
          code: 'NOT_A_PICKER_SESSION',
          message: 'This endpoint requires a picker session token.',
          details: null,
        });
      }
      const { clientId } = request.params as { clientId: string };
      if (tokenClientId !== clientId) {
        return reply.code(403).send({
          error: 'forbidden',
          code: 'CLIENT_SCOPE_MISMATCH',
          message: 'Picker session is not scoped to this client.',
          details: null,
        });
      }

      return reply.code(200).send({
        pickerId: scope.principalId,
        clientId: tokenClientId,
        storeRef,
        permissions: [...scope.permissions],
      });
    },
  );
}
