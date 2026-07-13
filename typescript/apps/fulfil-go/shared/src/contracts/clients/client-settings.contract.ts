import { z } from 'zod';

/**
 * CLIENT-level operational settings (docs/process-definitions.md) — the
 * per-tenant knobs that don't belong to any store. One row per client,
 * every field optional: an absent field means the code default.
 *
 * First resident: `processDefinition` — which CORE PROCESS DEFINITION
 * (registry code) coordinates this client's fulfilments. The resolved code
 * is STAMPED onto each fulfilment at creation; changing it here migrates
 * NEW fulfilments only — in-flight ones finish on their stamped definition
 * (no cutover flag-day).
 */
export const ClientSettingsSchema = z
  .object({
    /** Core process definition code (registry key, kebab-case). */
    processDefinition: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
      .optional(),
  })
  .strict();

export type ClientSettings = z.infer<typeof ClientSettingsSchema>;

export type ResolvedClientSettings = {
  [K in keyof ClientSettings]-?: NonNullable<ClientSettings[K]>;
};

/** The registry code every client coordinates with unless configured otherwise. */
export const STANDARD_PROCESS_DEFINITION = 'standard';

export const CLIENT_SETTINGS_DEFAULTS: ResolvedClientSettings = {
  processDefinition: STANDARD_PROCESS_DEFINITION,
};

/** Collapse the client's row (if any) onto the code defaults. */
export function resolveClientSettings(
  settings: ClientSettings | null | undefined,
): ResolvedClientSettings {
  const resolved: ResolvedClientSettings = { ...CLIENT_SETTINGS_DEFAULTS };
  if (settings) {
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined) {
        (resolved as Record<string, unknown>)[key] = value;
      }
    }
  }
  return resolved;
}
