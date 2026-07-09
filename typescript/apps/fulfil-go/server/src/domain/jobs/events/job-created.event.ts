import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

/**
 * Source of truth for both the runtime payload type AND the JSON Schema
 * synced to FlowCatalyst. `Static<typeof Schema>` derives the TS type so
 * consumers can't drift from what's published.
 */
export const JobCreatedDataSchema = Type.Object({
  jobId: Type.String(),
  title: Type.String(),
});

export type JobCreatedData = Static<typeof JobCreatedDataSchema>;

export class JobCreated extends BaseDomainEvent<JobCreatedData> {
  constructor(scope: Scope, data: JobCreatedData) {
    super(
      {
        eventType: DomainEvent.eventType('fulfil-go', 'jobs', 'job', 'created'),
        specVersion: '1.0',
        source: 'fulfil-go:jobs',
        subject: DomainEvent.subject('jobs', 'job', data.jobId),
        messageGroup: DomainEvent.messageGroup('jobs', 'job', data.jobId),
      },
      scope as never,
      data,
    );
  }
}

export const JobCreatedEventType = {
  code: 'fulfil-go:jobs:job:created',
  name: 'Job Created',
  description: 'A fulfil-go job was created.',
  payloadSchema: JobCreatedDataSchema,
} as const;
