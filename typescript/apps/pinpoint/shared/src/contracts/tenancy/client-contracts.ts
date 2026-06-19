import { z } from 'zod';

export const CreateClientCommandSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
});
export type CreateClientCommand = z.infer<typeof CreateClientCommandSchema>;

/**
 * Update a client's name. `code` is immutable — re-issuing a code is a
 * delete + create. `status` lifecycle (ACTIVE / SUSPENDED) is reserved
 * for a future suspend/reactivate use case, not this one.
 */
export const UpdateClientCommandSchema = z.object({
  clientId: z.string().trim().min(1),
  name: z.string().trim().min(1),
});
export type UpdateClientCommand = z.infer<typeof UpdateClientCommandSchema>;

export const DeleteClientCommandSchema = z.object({
  clientId: z.string().trim().min(1),
});
export type DeleteClientCommand = z.infer<typeof DeleteClientCommandSchema>;
