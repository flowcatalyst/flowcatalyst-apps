import { z } from 'zod';

export const CreateClientCommandSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
});
export type CreateClientCommand = z.infer<typeof CreateClientCommandSchema>;
