/**
 * Bag-label ZPL rendering (docs/bag-label-printing.md). Pure: pick + label +
 * printer dimensions → plain ZPL II (no vendor extensions), sized in dots
 * computed from the printer's label size and dpi so one template serves
 * 203/300/600 dpi equipment.
 *
 * Layout (top → bottom): part short id + store ref header, the big "n / X"
 * bag number, a Code 128 barcode of the pre-allocated package ref with the
 * ref spelled out beneath it, and the slot date footer.
 */
export interface LabelDimensions {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly dpi: number;
}

/** Fallback when the station prints without a registered printer selected. */
export const DEFAULT_LABEL_DIMENSIONS: LabelDimensions = { widthMm: 100, heightMm: 75, dpi: 203 };

const mmToDots = (mm: number, dpi: number): number => Math.round((mm / 25.4) * dpi);

/** ^FD payload escaping: back-slash, caret and tilde are ZPL control chars. */
const escapeZpl = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/\^/g, '\\^').replace(/~/g, '\\~');

export interface BagLabelInput {
  readonly shortId: string;
  readonly storeRef: string;
  readonly slotStart: Date;
  readonly timezone: string;
  readonly ref: string;
  readonly seq: number;
  readonly count: number;
}

export function renderBagLabelZpl(input: BagLabelInput, dims: LabelDimensions): string {
  const { dpi } = dims;
  const width = mmToDots(dims.widthMm, dpi);
  const height = mmToDots(dims.heightMm, dpi);
  const margin = mmToDots(4, dpi);
  const usable = width - margin * 2;

  const headerPt = mmToDots(6, dpi);
  const bagNoPt = mmToDots(14, dpi);
  const smallPt = mmToDots(3.5, dpi);
  const barcodeHeight = mmToDots(18, dpi);
  // Code 128 module width: ~0.25mm keeps a pkg_… ref comfortably inside a
  // 100mm label and scales with dpi (2 dots @203, 3 @300, 6 @600).
  const module = Math.max(2, mmToDots(0.25, dpi));

  const headerY = margin;
  const bagNoY = headerY + headerPt + mmToDots(3, dpi);
  const barcodeY = bagNoY + bagNoPt + mmToDots(5, dpi);
  const refY = barcodeY + barcodeHeight + mmToDots(2, dpi);
  const footerY = height - margin - smallPt;

  const slotDate = new Intl.DateTimeFormat('en-GB', {
    timeZone: input.timezone,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(input.slotStart);

  return [
    '^XA',
    '^CI28',
    `^PW${width}`,
    `^LL${height}`,
    '^LH0,0',
    // Header: part short id (left) + store ref (right-aligned block).
    `^FO${margin},${headerY}^A0N,${headerPt},${headerPt}^FD#${escapeZpl(input.shortId)}^FS`,
    `^FO${margin},${headerY}^A0N,${headerPt},${headerPt}^FB${usable},1,0,R,0^FD${escapeZpl(input.storeRef)}^FS`,
    // The bag number — the label's reason to exist, so it dominates.
    `^FO${margin},${bagNoY}^A0N,${bagNoPt},${bagNoPt}^FB${usable},1,0,C,0^FD${input.seq} / ${input.count}^FS`,
    // Code 128 of the pre-allocated package ref; our own readable line below
    // (ZPL's built-in interpretation line has no font/position control).
    `^FO${margin},${barcodeY}^BY${module},2,${barcodeHeight}`,
    `^BCN,${barcodeHeight},N,N,N^FD${escapeZpl(input.ref)}^FS`,
    `^FO${margin},${refY}^A0N,${smallPt},${smallPt}^FB${usable},1,0,C,0^FD${escapeZpl(input.ref)}^FS`,
    `^FO${margin},${footerY}^A0N,${smallPt},${smallPt}^FDSlot ${slotDate}^FS`,
    '^XZ',
  ].join('\n');
}
