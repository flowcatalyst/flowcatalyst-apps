import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent } from '@pinpoint/framework';
import type { Scope } from '@pinpoint/framework';

export const PropertySetPropertiesReplacedDataSchema = Type.Object({
  propertySetId: Type.String(),
  layerId: Type.String(),
  properties: Type.Array(
    Type.Object({
      key: Type.String(),
      value: Type.String(),
    }),
  ),
});

export type PropertySetPropertiesReplacedData = Static<
  typeof PropertySetPropertiesReplacedDataSchema
>;

export class PropertySetPropertiesReplaced extends BaseDomainEvent<PropertySetPropertiesReplacedData> {
  constructor(scope: Scope, data: PropertySetPropertiesReplacedData) {
    super(
      {
        eventType: DomainEvent.eventType(
          'pinpoint',
          'layers',
          'property-set',
          'properties-replaced',
        ),
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

export const PropertySetPropertiesReplacedEventType = {
  code: 'pinpoint:layers:property-set:properties-replaced',
  name: 'Property Set Properties Replaced',
  description: 'A property set had its full property list replaced.',
  payloadSchema: PropertySetPropertiesReplacedDataSchema,
} as const;
