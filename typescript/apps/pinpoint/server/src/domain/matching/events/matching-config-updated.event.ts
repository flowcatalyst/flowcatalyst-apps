import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const MatchingConfigUpdatedDataSchema = Type.Object({
  configId: Type.String(),
  clientId: Type.Union([Type.String(), Type.Null()]),
  partitionId: Type.Union([Type.String(), Type.Null()]),
});

export type MatchingConfigUpdatedData = Static<typeof MatchingConfigUpdatedDataSchema>;

export class MatchingConfigUpdated extends BaseDomainEvent<MatchingConfigUpdatedData> {
  constructor(scope: Scope, data: MatchingConfigUpdatedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'matching', 'config', 'updated'),
        specVersion: '1.0',
        source: 'pinpoint:matching',
        subject: DomainEvent.subject('matching', 'config', data.configId),
        messageGroup: DomainEvent.messageGroup('matching', 'config', data.configId),
      },
      scope as never,
      data,
    );
  }
}

export const MatchingConfigUpdatedEventType = {
  code: 'pinpoint:matching:config:updated',
  name: 'Matching Config Updated',
  description: 'A scoped matching config (client / partition) had its thresholds updated.',
  payloadSchema: MatchingConfigUpdatedDataSchema,
} as const;
