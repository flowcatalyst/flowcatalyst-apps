import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const LayerFeatureStatusChangedDataSchema = Type.Object({
  featureId: Type.String(),
  layerId: Type.String(),
  status: Type.Union([Type.Literal('ACTIVE'), Type.Literal('INACTIVE')]),
});
export type LayerFeatureStatusChangedData = Static<typeof LayerFeatureStatusChangedDataSchema>;

export class LayerFeatureStatusChanged extends BaseDomainEvent<LayerFeatureStatusChangedData> {
  constructor(scope: Scope, data: LayerFeatureStatusChangedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'layers', 'feature', 'status-changed'),
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

export const LayerFeatureStatusChangedEventType = {
  code: 'pinpoint:layers:feature:status-changed',
  name: 'Layer Feature Status Changed',
  description: 'A layer feature was activated or deactivated.',
  payloadSchema: LayerFeatureStatusChangedDataSchema,
} as const;
