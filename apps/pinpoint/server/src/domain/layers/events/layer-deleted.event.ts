import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const LayerDeletedDataSchema = Type.Object({
  layerId: Type.String(),
  clientId: Type.String(),
});

export type LayerDeletedData = Static<typeof LayerDeletedDataSchema>;

export class LayerDeleted extends BaseDomainEvent<LayerDeletedData> {
  constructor(scope: Scope, data: LayerDeletedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'layers', 'layer', 'deleted'),
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

export const LayerDeletedEventType = {
  code: 'pinpoint:layers:layer:deleted',
  name: 'Layer Deleted',
  description: 'A layer was deleted (cascades to features, property sets, and layer-partition rows).',
  payloadSchema: LayerDeletedDataSchema,
} as const;
