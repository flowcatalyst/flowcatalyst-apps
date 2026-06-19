import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const LayerFeatureUpdatedDataSchema = Type.Object({
  featureId: Type.String(),
  layerId: Type.String(),
  label: Type.String(),
});

export type LayerFeatureUpdatedData = Static<typeof LayerFeatureUpdatedDataSchema>;

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

export const LayerFeatureUpdatedEventType = {
  code: 'pinpoint:layers:feature:updated',
  name: 'Layer Feature Updated',
  description: 'A feature on a layer was updated (label / geometry / property values).',
  payloadSchema: LayerFeatureUpdatedDataSchema,
} as const;
