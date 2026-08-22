import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const LayerPartitionsSetDataSchema = Type.Object({
  layerId: Type.String(),
  clientId: Type.String(),
  /** Partitions the layer is now restricted to; empty = visible to every partition of the client. */
  partitionIds: Type.Array(Type.String()),
});
export type LayerPartitionsSetData = Static<typeof LayerPartitionsSetDataSchema>;

export class LayerPartitionsSet extends BaseDomainEvent<LayerPartitionsSetData> {
  constructor(scope: Scope, data: LayerPartitionsSetData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'layers', 'layer', 'partitions-set'),
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

export const LayerPartitionsSetEventType = {
  code: 'pinpoint:layers:layer:partitions-set',
  name: 'Layer Partitions Set',
  description: 'The set of partitions a layer is visible to was replaced.',
  payloadSchema: LayerPartitionsSetDataSchema,
} as const;
