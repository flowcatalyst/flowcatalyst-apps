import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const PropertySetCreatedDataSchema = Type.Object({
  propertySetId: Type.String(),
  layerId: Type.String(),
  name: Type.String(),
});

export type PropertySetCreatedData = Static<typeof PropertySetCreatedDataSchema>;

export class PropertySetCreated extends BaseDomainEvent<PropertySetCreatedData> {
  constructor(scope: Scope, data: PropertySetCreatedData) {
    super(
      {
        eventType: DomainEvent.eventType('pinpoint', 'layers', 'property-set', 'created'),
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

export const PropertySetCreatedEventType = {
  code: 'pinpoint:layers:property-set:created',
  name: 'Property Set Created',
  description: 'A new property set was created for a layer.',
  payloadSchema: PropertySetCreatedDataSchema,
} as const;
