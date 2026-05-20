import { z } from 'zod';

export const CreatePartitionCommandSchema = z.object({
  clientId: z.string().trim().min(1),
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().optional().nullable(),
});
export type CreatePartitionCommand = z.infer<typeof CreatePartitionCommandSchema>;
