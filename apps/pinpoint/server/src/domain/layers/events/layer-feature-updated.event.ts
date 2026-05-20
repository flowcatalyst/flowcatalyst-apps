import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export interface LayerFeatureUpdatedData {
  readonly featureId: string;
  readonly layerId: string;
  readonly label: string;
}

export class LayerFeatureUpdated extends BaseDomainEvent<LayerFeatureUpdatedData> {
  constructor(scope: Scope, data: LayerFeatureUpdatedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'layers', 'feature', 'updated'),
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
