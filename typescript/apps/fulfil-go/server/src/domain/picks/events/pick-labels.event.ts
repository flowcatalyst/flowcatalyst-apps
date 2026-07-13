import { Type, type Static } from '@sinclair/typebox';
import { BaseDomainEvent, DomainEvent, eventGroup } from '@fulfil-go/framework';
import type { Scope } from '@fulfil-go/framework';

/**
 * The pick's bag-label set changed (docs/bag-label-printing.md):
 * `allocated` (first print), `replaced` (count changed — kept seqs keep
 * their refs), or `reprinted` (one damaged label, or the whole set on a
 * same-count re-render; `seq` present for the single-label case).
 */
export const PickLabelsUpdatedDataSchema = Type.Object({
  pickId: Type.String(),
  clientId: Type.String(),
  storeRef: Type.String(),
  fulfilmentId: Type.String(),
  partId: Type.String(),
  shortId: Type.String(),
  pickerId: Type.String(),
  action: Type.Union([
    Type.Literal('allocated'),
    Type.Literal('replaced'),
    Type.Literal('reprinted'),
  ]),
  count: Type.Integer(),
  labels: Type.Array(
    Type.Object({
      seq: Type.Integer(),
      ref: Type.String(),
      reprints: Type.Integer(),
    }),
  ),
  voidedRefs: Type.Array(Type.String()),
  seq: Type.Optional(Type.Integer()),
});

export type PickLabelsUpdatedData = Static<typeof PickLabelsUpdatedDataSchema>;

export class PickLabelsUpdated extends BaseDomainEvent<PickLabelsUpdatedData> {
  constructor(scope: Scope, data: PickLabelsUpdatedData) {
    super(
      {
        eventType: DomainEvent.eventType('fulfil-go', 'pick', 'pick', 'labels-updated'),
        specVersion: '1.0',
        source: 'fulfil-go:pick',
        subject: DomainEvent.subject('pick', 'pick', data.pickId),
        messageGroup: eventGroup('pick', data.pickId),
      },
      scope as never,
      data,
    );
  }
}

export const PickLabelsUpdatedEventType = {
  code: 'fulfil-go:pick:pick:labels-updated',
  name: 'Pick Bag Labels Updated',
  description: 'The bag-label set of a pick was allocated, replaced, or reprinted.',
  payloadSchema: PickLabelsUpdatedDataSchema,
} as const;
