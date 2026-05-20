import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';
import type { LayerKind } from '../layer.js';

export interface LayerCreatedData {
  readonly layerId: string;
  readonly clientId: string;
  readonly code: string;
  readonly name: string;
  readonly layerType: LayerKind;
}

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
