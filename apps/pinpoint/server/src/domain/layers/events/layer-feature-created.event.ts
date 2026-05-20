import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export interface LayerFeatureCreatedData {
  readonly featureId: string;
  readonly layerId: string;
  readonly label: string;
}

export class LayerFeatureCreated extends BaseDomainEvent<LayerFeatureCreatedData> {
  constructor(scope: Scope, data: LayerFeatureCreatedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'layers', 'feature', 'created'),
        specVersion: '1.0',
        source: 'pinpoint:layers',
        subject: DomainEvent.subject('layers', 'feature', data.featureId),
        // Group by parent layer so all events for a layer's features
        // serialize together — matches the Rust message_group choice.
        messageGroup: DomainEvent.messageGroup('layers', 'layer', data.layerId),
      },
      scope as never,
      data,
    );
  }
}
