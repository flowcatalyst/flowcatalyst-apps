import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { and, eq } from 'drizzle-orm';
import { ScopeStore, brandedTsid } from '@fulfil-go/framework';
import {
  DEFAULT_STORE_PROFILE_CODE,
  STORE_SETTINGS_DEFAULTS,
  StoreSettingsSchema,
} from '@fulfil-go/shared';
import type { AppContext } from '../../../app-context.js';
import { storeProfiles } from '../../../infrastructure/schema/store-profiles.js';
import { stores } from '../../../infrastructure/schema/stores.js';

/**
 * Store-profile configuration. Profiles are named settings bundles; the
 * 'default' profile is what "global config" edits — it exists virtually
 * (code defaults) until first saved, so nothing needs seeding and every
 * store auto-links to it via the stores.profile_code default.
 */
const ErrorSchema = Type.Object({ error: Type.String() }, { additionalProperties: true });

const ProfileSchema = Type.Object({
  code: Type.String(),
  name: Type.String(),
  settings: Type.Record(Type.String(), Type.Number()),
});

export function registerConfigRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  const db = appContext.db;

  fastify.get(
    '/clients/:clientId/config/store-profiles',
    {
      schema: {
        tags: ['Config'],
        summary: 'List store profiles',
        description:
          "Named operational-settings bundles. The reserved 'default' profile is the global " +
          'config; it is synthesized (empty settings) until first saved. `defaults` carries ' +
          'the code-level fallback values the UI shows as placeholders.',
        params: Type.Object({ clientId: Type.String() }),
        response: {
          200: Type.Object({
            defaults: Type.Record(Type.String(), Type.Number()),
            profiles: Type.Array(ProfileSchema),
          }),
          401: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId } = request.params as { clientId: string };
      const rows = await db
        .select()
        .from(storeProfiles)
        .where(eq(storeProfiles.clientId, clientId))
        .orderBy(storeProfiles.code);
      const profiles = rows.map((r) => ({
        code: r.code,
        name: r.name,
        settings: (r.settings ?? {}) as Record<string, number>,
      }));
      if (!profiles.some((p) => p.code === DEFAULT_STORE_PROFILE_CODE)) {
        profiles.unshift({ code: DEFAULT_STORE_PROFILE_CODE, name: 'Default', settings: {} });
      }
      return reply.send({
        defaults: STORE_SETTINGS_DEFAULTS as unknown as Record<string, number>,
        profiles,
      });
    },
  );

  fastify.put(
    '/clients/:clientId/config/store-profiles/:code',
    {
      schema: {
        tags: ['Config'],
        summary: 'Create or update a store profile',
        params: Type.Object({ clientId: Type.String(), code: Type.String() }),
        body: Type.Object({
          name: Type.Optional(Type.String()),
          settings: Type.Record(Type.String(), Type.Unknown()),
        }),
        response: { 200: ProfileSchema, 400: ErrorSchema, 401: ErrorSchema },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId, code } = request.params as { clientId: string; code: string };
      const { name, settings } = request.body as { name?: string; settings: unknown };
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(code)) {
        return reply
          .code(400)
          .send({ error: 'ValidationError', message: 'code must be kebab-case.' });
      }
      const parsed = StoreSettingsSchema.safeParse(settings);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }
      const [row] = await db
        .insert(storeProfiles)
        .values({
          id: brandedTsid('spr'),
          clientId,
          code,
          name: name ?? code,
          settings: parsed.data,
        })
        .onConflictDoUpdate({
          target: [storeProfiles.clientId, storeProfiles.code],
          set: {
            ...(name !== undefined ? { name } : {}),
            settings: parsed.data,
            updatedAt: new Date(),
          },
        })
        .returning();
      return reply.send({
        code: row!.code,
        name: row!.name,
        settings: (row!.settings ?? {}) as Record<string, number>,
      });
    },
  );

  fastify.patch(
    '/clients/:clientId/config/stores/:storeRef',
    {
      schema: {
        tags: ['Config'],
        summary: 'Assign a store profile / set store-level overrides',
        params: Type.Object({ clientId: Type.String(), storeRef: Type.String() }),
        body: Type.Object({
          profileCode: Type.Optional(Type.String()),
          overrides: Type.Optional(
            Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
          ),
        }),
        response: {
          200: Type.Object({ storeRef: Type.String(), profileCode: Type.String() }),
          400: ErrorSchema,
          401: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId, storeRef } = request.params as { clientId: string; storeRef: string };
      const { profileCode, overrides } = request.body as {
        profileCode?: string;
        overrides?: unknown;
      };
      let parsedOverrides: unknown = undefined;
      if (overrides !== undefined) {
        if (overrides === null) {
          parsedOverrides = null;
        } else {
          const parsed = StoreSettingsSchema.safeParse(overrides);
          if (!parsed.success) {
            return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
          }
          parsedOverrides = parsed.data;
        }
      }
      if (profileCode && profileCode !== DEFAULT_STORE_PROFILE_CODE) {
        const [profile] = await db
          .select({ code: storeProfiles.code })
          .from(storeProfiles)
          .where(and(eq(storeProfiles.clientId, clientId), eq(storeProfiles.code, profileCode)))
          .limit(1);
        if (!profile) {
          return reply
            .code(400)
            .send({ error: 'ValidationError', message: `Unknown profile '${profileCode}'.` });
        }
      }
      const [row] = await db
        .update(stores)
        .set({
          ...(profileCode !== undefined ? { profileCode } : {}),
          ...(parsedOverrides !== undefined ? { settingsOverrides: parsedOverrides } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(stores.clientId, clientId), eq(stores.storeRef, storeRef)))
        .returning({ storeRef: stores.storeRef, profileCode: stores.profileCode });
      if (!row) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: `Store '${storeRef}' not in the registry.` });
      }
      return reply.send(row);
    },
  );
}
