import { z } from 'zod';

export const CreatePartitionCommandSchema = z.object({
  clientId: z.string().trim().min(1),
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().optional().nullable(),
});
export type CreatePartitionCommand = z.infer<typeof CreatePartitionCommandSchema>;

/**
 * Update partition. `code` is immutable (same reason as client).
 */
export const UpdatePartitionCommandSchema = z.object({
  clientId: z.string().trim().min(1),
  partitionId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().optional().nullable(),
});
export type UpdatePartitionCommand = z.infer<typeof UpdatePartitionCommandSchema>;

export const DeletePartitionCommandSchema = z.object({
  clientId: z.string().trim().min(1),
  partitionId: z.string().trim().min(1),
});
export type DeletePartitionCommand = z.infer<typeof DeletePartitionCommandSchema>;
