import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const LayerFeatureDeletedDataSchema = Type.Object({
  featureId: Type.String(),
  layerId: Type.String(),
});

export type LayerFeatureDeletedData = Static<typeof LayerFeatureDeletedDataSchema>;

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

export const LayerFeatureDeletedEventType = {
  code: 'pinpoint:layers:feature:deleted',
  name: 'Layer Feature Deleted',
  description: 'A feature was removed from a layer.',
  payloadSchema: LayerFeatureDeletedDataSchema,
} as const;
