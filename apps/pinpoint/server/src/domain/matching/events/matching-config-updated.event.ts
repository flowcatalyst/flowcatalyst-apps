import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export interface MatchingConfigUpdatedData {
  readonly configId: string;
  readonly clientId: string | null;
  readonly partitionId: string | null;
}

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
