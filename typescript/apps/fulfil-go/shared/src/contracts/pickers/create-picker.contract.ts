import { z } from 'zod';

/**
 * Provision a picker (pick-context local identity) bound to a store.
 * `clientId` is injected by the route from the /clients/:clientId path.
 *
 * This slice supports PIN-primary only: `pin` is required and `primaryAuthMethod`
 * defaults to `'pin'`. QR-primary + break-glass land in a later phase.
 */
export const CreatePickerCommandSchema = z
  .object({
    clientId: z.string().min(1).max(64),
    storeRef: z.string().min(1).max(64),
    displayName: z.string().min(1).max(200),
    /** Unique within a store; the identifier a picker types before their PIN. */
    staffCode: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9._-]+$/, 'staffCode may contain only letters, digits, and . _ -'),
    primaryAuthMethod: z.enum(['pin', 'qr']).default('pin'),
    /** 4–8 digit PIN (required for pin-primary). */
    pin: z
      .string()
      .regex(/^\d{4,8}$/, 'pin must be 4–8 digits')
      .optional(),
  })
  .strict();

export type CreatePickerCommand = z.infer<typeof CreatePickerCommandSchema>;
