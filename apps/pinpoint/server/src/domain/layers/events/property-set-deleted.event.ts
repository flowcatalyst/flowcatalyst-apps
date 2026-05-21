import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const PropertySetDeletedDataSchema = Type.Object({
  propertySetId: Type.String(),
  layerId: Type.String(),
});

export type PropertySetDeletedData = Static<typeof PropertySetDeletedDataSchema>;

export class PropertySetDeleted extends BaseDomainEvent<PropertySetDeletedData> {
  constructor(scope: Scope, data: PropertySetDeletedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'layers', 'property-set', 'deleted'),
        specVersion: '1.0',
        source: 'pinpoint:layers',
        subject: DomainEvent.subject('layers', 'property-set', data.propertySetId),
        messageGroup: DomainEvent.messageGroup('layers', 'property-set', data.propertySetId),
      },
      scope as never,
      data,
    );
  }
}

export const PropertySetDeletedEventType = {
  code: 'pinpoint:layers:property-set:deleted',
  name: 'Property Set Deleted',
  description: 'A property set (and its properties) was deleted.',
  payloadSchema: PropertySetDeletedDataSchema,
} as const;
