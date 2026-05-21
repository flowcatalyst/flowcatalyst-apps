import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const LayerUpdatedDataSchema = Type.Object({
  layerId: Type.String(),
  clientId: Type.String(),
  name: Type.String(),
});

export type LayerUpdatedData = Static<typeof LayerUpdatedDataSchema>;

export class LayerUpdated extends BaseDomainEvent<LayerUpdatedData> {
  constructor(scope: Scope, data: LayerUpdatedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'layers', 'layer', 'updated'),
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

export const LayerUpdatedEventType = {
  code: 'pinpoint:layers:layer:updated',
  name: 'Layer Updated',
  description: 'A layer had its name, description, geometry, or status updated.',
  payloadSchema: LayerUpdatedDataSchema,
} as const;
