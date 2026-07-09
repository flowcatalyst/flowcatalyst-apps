import { z } from 'zod';

/** Command for creating a new job in the `created` state. */
export const CreateJobCommandSchema = z
  .object({
    title: z.string().min(1).max(200),
    details: z.string().max(4000).optional(),
  })
  .strict();

export type CreateJobCommand = z.infer<typeof CreateJobCommandSchema>;
