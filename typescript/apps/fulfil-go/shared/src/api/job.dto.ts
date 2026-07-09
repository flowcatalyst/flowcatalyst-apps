import { type Static, Type } from '@sinclair/typebox';

/** Wire representation of a job — API responses, delta sync and SSE payloads. */
export const JobDtoSchema = Type.Object(
  {
    id: Type.String(),
    status: Type.Union([
      Type.Literal('created'),
      Type.Literal('assigned'),
      Type.Literal('accepted'),
      Type.Literal('completed'),
    ]),
    title: Type.String(),
    details: Type.Optional(Type.String()),
    assigneeId: Type.Optional(Type.String()),
    assignedAt: Type.Optional(Type.String({ format: 'date-time' })),
    acceptedAt: Type.Optional(Type.String({ format: 'date-time' })),
    completedAt: Type.Optional(Type.String({ format: 'date-time' })),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'JobDto' },
);

export type JobDto = Static<typeof JobDtoSchema>;
