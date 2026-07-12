import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent, eventGroup } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

export const JobAssignedDataSchema = Type.Object({
  jobId: Type.String(),
  assigneeId: Type.String(),
});

export type JobAssignedData = Static<typeof JobAssignedDataSchema>;

export class JobAssigned extends BaseDomainEvent<JobAssignedData> {
  constructor(scope: Scope, data: JobAssignedData) {
    super(
      {
        eventType: DomainEvent.eventType('fulfil-go', 'jobs', 'job', 'assigned'),
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

export const JobAssignedEventType = {
  code: 'fulfil-go:jobs:job:assigned',
  name: 'Job Assigned',
  description: 'A fulfil-go job was assigned to a field worker.',
  payloadSchema: JobAssignedDataSchema,
} as const;
