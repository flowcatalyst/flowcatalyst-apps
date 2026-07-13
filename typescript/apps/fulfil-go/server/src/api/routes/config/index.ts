import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ScopeStore } from '@fulfil-go/framework';
import {
  CLIENT_SETTINGS_DEFAULTS,
  ClientSettingsSchema,
  DEFAULT_STORE_PROFILE_CODE,
  PICK_SETTINGS_DEFAULTS,
  PickStoreSettingsSchema,
  TRANSPORT_SETTINGS_DEFAULTS,
  TransportStoreSettingsSchema,
  type StoreSettingsDomain,
} from '@fulfil-go/shared';
import type { AppContext } from '../../../app-context.js';
import { createDrizzleStoreProfileRepository } from '../../../infrastructure/store-profile-repository.js';

/**
 * Store-profile configuration, per OWNING DOMAIN ('pick' | 'transport' —
 * each context manages its profiles under its own management-app section).
 * Profiles are named settings bundles; each domain's 'default' profile is
 * that domain's global config — it exists virtually (code defaults) until
 * first saved, so nothing needs seeding and every store auto-links to it
 * via the stores.<domain>_profile_code default.
 */
const ErrorSchema = Type.Object({ error: Type.String() }, { additionalProperties: true });

// Settings values are heterogeneous (numbers + string[] + objects) — the
// response/request schema is deliberately loose here; the domain's zod
// schema is the real validator on writes.
const ProfileSchema = Type.Object({
  code: Type.String(),
  name: Type.String(),
  settings: Type.Record(Type.String(), Type.Unknown()),
});

const DOMAINS = {
  pick: { schema: PickStoreSettingsSchema, defaults: PICK_SETTINGS_DEFAULTS },
  transport: { schema: TransportStoreSettingsSchema, defaults: TRANSPORT_SETTINGS_DEFAULTS },
} as const;

function parseDomain(value: string): StoreSettingsDomain | null {
  return value === 'pick' || value === 'transport' ? value : null;
}

export function registerConfigRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  const profileRepo = createDrizzleStoreProfileRepository(appContext.db);

  fastify.get(
    '/clients/:clientId/config/client-settings',
    {
      schema: {
        tags: ['Config'],
        summary: 'Client-level settings',
        description:
          'Per-tenant operational settings (sparse — absent fields mean the code default in ' +
          '`defaults`). First resident: `processDefinition`, the core process-definition code ' +
          'stamped onto NEW fulfilments at creation.',
        params: Type.Object({ clientId: Type.String() }),
        response: {
          200: Type.Object({
            defaults: Type.Record(Type.String(), Type.Unknown()),
            settings: Type.Record(Type.String(), Type.Unknown()),
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
      const settings = await appContext.repositories.clientSettings.get(clientId);
      return reply.send({
        defaults: CLIENT_SETTINGS_DEFAULTS as unknown as Record<string, unknown>,
        settings: (settings ?? {}) as Record<string, unknown>,
      });
    },
  );

  fastify.put(
    '/clients/:clientId/config/client-settings',
    {
      schema: {
        tags: ['Config'],
        summary: 'Update client-level settings',
        description:
          'Replaces the sparse settings row wholesale. Changing `processDefinition` affects ' +
          'NEW fulfilments only — in-flight ones finish on their stamped definition.',
        params: Type.Object({ clientId: Type.String() }),
        body: Type.Object({ settings: Type.Record(Type.String(), Type.Unknown()) }),
        response: {
          200: Type.Object({ settings: Type.Record(Type.String(), Type.Unknown()) }),
          400: ErrorSchema,
          401: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const { clientId } = request.params as { clientId: string };
      const { settings } = request.body as { settings: unknown };
      const parsed = ClientSettingsSchema.safeParse(settings);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }
      // A definition code that isn't registered would strand new fulfilments
      // at dispatch time — reject it at the edge instead.
      if (parsed.data.processDefinition !== undefined) {
        try {
          appContext.processRegistry.resolve(parsed.data.processDefinition);
        } catch {
          return reply.code(400).send({
            error: 'ValidationError',
            message: `Unknown process definition '${parsed.data.processDefinition}'.`,
          });
        }
      }
      const saved = await appContext.repositories.clientSettings.upsert(clientId, parsed.data);
      return reply.send({ settings: saved as Record<string, unknown> });
    },
  );

  fastify.get(
    '/clients/:clientId/config/:domain/store-profiles',
    {
      schema: {
        tags: ['Config'],
        summary: 'List store profiles for a domain (pick | transport)',
        description:
          "Named operational-settings bundles per owning context. The reserved 'default' " +
          'profile is that domain\'s global config; it is synthesized (empty settings) until ' +
          'first saved. `defaults` carries the code-level fallback values the UI shows as ' +
          'placeholders.',
        params: Type.Object({ clientId: Type.String(), domain: Type.String() }),
        response: {
          200: Type.Object({
            defaults: Type.Record(Type.String(), Type.Unknown()),
            profiles: Type.Array(ProfileSchema),
          }),
          400: ErrorSchema,
          401: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const params = request.params as { clientId: string; domain: string };
      const domain = parseDomain(params.domain);
      if (!domain) {
        return reply
          .code(400)
          .send({ error: 'ValidationError', message: "domain must be 'pick' or 'transport'." });
      }
      const profiles = await profileRepo.listByClient(params.clientId, domain);
      return reply.send({
        defaults: DOMAINS[domain].defaults as unknown as Record<string, unknown>,
        profiles: profiles.map((p) => ({ code: p.code, name: p.name, settings: p.settings })),
      });
    },
  );

  fastify.put(
    '/clients/:clientId/config/:domain/store-profiles/:code',
    {
      schema: {
        tags: ['Config'],
        summary: 'Create or update a store profile (per domain)',
        params: Type.Object({
          clientId: Type.String(),
          domain: Type.String(),
          code: Type.String(),
        }),
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
      const params = request.params as { clientId: string; domain: string; code: string };
      const domain = parseDomain(params.domain);
      if (!domain) {
        return reply
          .code(400)
          .send({ error: 'ValidationError', message: "domain must be 'pick' or 'transport'." });
      }
      const { name, settings } = request.body as { name?: string; settings: unknown };
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(params.code)) {
        return reply
          .code(400)
          .send({ error: 'ValidationError', message: 'code must be kebab-case.' });
      }
      const parsed = DOMAINS[domain].schema.safeParse(settings);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }
      const saved = await profileRepo.upsert(
        params.clientId,
        domain,
        params.code,
        name,
        parsed.data,
      );
      return reply.send({ code: saved.code, name: saved.name, settings: saved.settings });
    },
  );

  fastify.patch(
    '/clients/:clientId/config/:domain/stores/:storeRef',
    {
      schema: {
        tags: ['Config'],
        summary: 'Assign a store profile / set store-level overrides (per domain)',
        params: Type.Object({
          clientId: Type.String(),
          domain: Type.String(),
          storeRef: Type.String(),
        }),
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
      const params = request.params as { clientId: string; domain: string; storeRef: string };
      const domain = parseDomain(params.domain);
      if (!domain) {
        return reply
          .code(400)
          .send({ error: 'ValidationError', message: "domain must be 'pick' or 'transport'." });
      }
      const { profileCode, overrides } = request.body as {
        profileCode?: string;
        overrides?: unknown;
      };
      let parsedOverrides: object | null | undefined = undefined;
      if (overrides !== undefined) {
        if (overrides === null) {
          parsedOverrides = null;
        } else {
          const parsed = DOMAINS[domain].schema.safeParse(overrides);
          if (!parsed.success) {
            return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
          }
          parsedOverrides = parsed.data;
        }
      }
      if (profileCode && profileCode !== DEFAULT_STORE_PROFILE_CODE) {
        if (!(await profileRepo.exists(params.clientId, domain, profileCode))) {
          return reply
            .code(400)
            .send({ error: 'ValidationError', message: `Unknown profile '${profileCode}'.` });
        }
      }
      const row = await profileRepo.assignStore(params.clientId, domain, params.storeRef, {
        ...(profileCode !== undefined ? { profileCode } : {}),
        ...(parsedOverrides !== undefined ? { overrides: parsedOverrides } : {}),
      });
      if (!row) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: `Store '${params.storeRef}' not in the registry.` });
      }
      return reply.send(row);
    },
  );
}
