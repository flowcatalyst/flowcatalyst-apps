import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent, eventGroup } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

export const JobAcceptedDataSchema = Type.Object({
  jobId: Type.String(),
  assigneeId: Type.String(),
});

export type JobAcceptedData = Static<typeof JobAcceptedDataSchema>;

export class JobAccepted extends BaseDomainEvent<JobAcceptedData> {
  constructor(scope: Scope, data: JobAcceptedData) {
    super(
      {
        eventType: DomainEvent.eventType('fulfil-go', 'jobs', 'job', 'accepted'),
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

export const JobAcceptedEventType = {
  code: 'fulfil-go:jobs:job:accepted',
  name: 'Job Accepted',
  description: 'A fulfil-go job was accepted by its assignee.',
  payloadSchema: JobAcceptedDataSchema,
} as const;
