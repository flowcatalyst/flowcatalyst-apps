import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const PropertySetUpdatedDataSchema = Type.Object({
  propertySetId: Type.String(),
  layerId: Type.String(),
  name: Type.String(),
});

export type PropertySetUpdatedData = Static<typeof PropertySetUpdatedDataSchema>;

export class PropertySetUpdated extends BaseDomainEvent<PropertySetUpdatedData> {
  constructor(scope: Scope, data: PropertySetUpdatedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'layers', 'property-set', 'updated'),
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

export const PropertySetUpdatedEventType = {
  code: 'pinpoint:layers:property-set:updated',
  name: 'Property Set Updated',
  description: 'A property set had its name or description updated.',
  payloadSchema: PropertySetUpdatedDataSchema,
} as const;
