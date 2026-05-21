import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const LayerKindSchema = Type.Union([
  Type.Literal('RADIUS'),
  Type.Literal('POLYGON'),
  Type.Literal('POINT'),
]);

export const LayerCreatedDataSchema = Type.Object({
  layerId: Type.String(),
  clientId: Type.String(),
  code: Type.String(),
  name: Type.String(),
  layerType: LayerKindSchema,
});

export type LayerCreatedData = Static<typeof LayerCreatedDataSchema>;

export class LayerCreated extends BaseDomainEvent<LayerCreatedData> {
  constructor(scope: Scope, data: LayerCreatedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'layers', 'layer', 'created'),
        specVersion: '1.0',
        source: 'pinpoint:layers',
        subject: DomainEvent.subject('layers', 'layer', data.layerId),
        messageGroup: DomainEvent.messageGroup('layers', 'layer', data.layerId),
      },
      scope as never,
      data,
    );
  }
}

export const LayerCreatedEventType = {
  code: 'pinpoint:layers:layer:created',
  name: 'Layer Created',
  description: 'A layer (RADIUS / POLYGON / POINT) was created under a client.',
  payloadSchema: LayerCreatedDataSchema,
} as const;
