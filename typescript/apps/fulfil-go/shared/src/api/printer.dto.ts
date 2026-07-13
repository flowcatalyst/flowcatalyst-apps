import { type Static, Type } from '@sinclair/typebox';

/** Wire shape for store-bound label printers (see printers.contract.ts). */
export const PrinterDtoSchema = Type.Object({
  id: Type.String(),
  clientId: Type.String(),
  storeRef: Type.String(),
  name: Type.String(),
  host: Type.String(),
  port: Type.Integer(),
  dpi: Type.Integer(),
  labelWidthMm: Type.Integer(),
  labelHeightMm: Type.Integer(),
  active: Type.Boolean(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type PrinterDto = Static<typeof PrinterDtoSchema>;

/** Wire shape of a pick's bag-label allocation (see pick-labels.contract.ts). */
export const PickLabelAllocationDtoSchema = Type.Object({
  count: Type.Integer(),
  labels: Type.Array(
    Type.Object({
      seq: Type.Integer(),
      ref: Type.String(),
      reprints: Type.Integer(),
    }),
  ),
  voidedRefs: Type.Array(Type.String()),
});
export type PickLabelAllocationDto = Static<typeof PickLabelAllocationDtoSchema>;

/** One rendered label document, ready for delivery to the printer. */
export const PickLabelDocumentSchema = Type.Object({
  seq: Type.Integer(),
  ref: Type.String(),
  zpl: Type.String(),
});
export type PickLabelDocument = Static<typeof PickLabelDocumentSchema>;
