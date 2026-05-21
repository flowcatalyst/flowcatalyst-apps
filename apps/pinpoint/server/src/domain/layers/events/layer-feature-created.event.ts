import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const LayerFeatureCreatedDataSchema = Type.Object({
  featureId: Type.String(),
  layerId: Type.String(),
  label: Type.String(),
});

export type LayerFeatureCreatedData = Static<typeof LayerFeatureCreatedDataSchema>;

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

export const LayerFeatureCreatedEventType = {
  code: 'pinpoint:layers:feature:created',
  name: 'Layer Feature Created',
  description: 'A feature was added to a layer.',
  payloadSchema: LayerFeatureCreatedDataSchema,
} as const;
