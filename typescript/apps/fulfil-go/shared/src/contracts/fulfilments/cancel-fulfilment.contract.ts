import { z } from 'zod';

/**
 * Command for cancelling a fulfilment — the ONLY mutation after creation.
 * `clientId`/`fulfilmentId` are injected by the route from the path.
 */
export const CancelFulfilmentCommandSchema = z
  .object({
    clientId: z.string().min(1).max(64),
    fulfilmentId: z.string().min(1).max(40),
    reason: z.string().max(500).optional(),
  })
  .strict();

export type CancelFulfilmentCommand = z.infer<typeof CancelFulfilmentCommandSchema>;
