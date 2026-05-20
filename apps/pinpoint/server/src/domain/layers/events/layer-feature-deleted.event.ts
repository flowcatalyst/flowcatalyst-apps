import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export interface LayerFeatureDeletedData {
  readonly featureId: string;
  readonly layerId: string;
}

export class LayerFeatureDeleted extends BaseDomainEvent<LayerFeatureDeletedData> {
  constructor(scope: Scope, data: LayerFeatureDeletedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'layers', 'feature', 'deleted'),
        specVersion: '1.0',
        source: 'pinpoint:layers',
        subject: DomainEvent.subject('layers', 'feature', data.featureId),
        messageGroup: DomainEvent.messageGroup('layers', 'layer', data.layerId),
      },
      scope as never,
      data,
    );
  }
}
