import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent, eventGroup } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

export const JobCompletedDataSchema = Type.Object({
  jobId: Type.String(),
  assigneeId: Type.String(),
  note: Type.Optional(Type.String()),
});

export type JobCompletedData = Static<typeof JobCompletedDataSchema>;

export class JobCompleted extends BaseDomainEvent<JobCompletedData> {
  constructor(scope: Scope, data: JobCompletedData) {
    super(
      {
        eventType: DomainEvent.eventType('fulfil-go', 'jobs', 'job', 'completed'),
        specVersion: '1.0',
        source: 'fulfil-go:jobs',
        subject: DomainEvent.subject('jobs', 'job', data.jobId),
        messageGroup: eventGroup('job', data.jobId),
      },
      scope as never,
      data,
    );
  }
}

export const JobCompletedEventType = {
  code: 'fulfil-go:jobs:job:completed',
  name: 'Job Completed',
  description: 'A fulfil-go job was completed by its assignee.',
  payloadSchema: JobCompletedDataSchema,
} as const;
