import { z } from 'zod';

/**
 * Store-bound label printers (docs/bag-label-printing.md) — base equipment
 * reference data, managed under Stores. The server renders ZPL sized to the
 * printer's label; the PICKING APP delivers it to `host:port` on the store
 * LAN (the cloud server can't reach store networks).
 */
const printerFields = {
  storeRef: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  /** LAN hostname or IP the station can reach. */
  host: z.string().min(1).max(255),
  /** Raw-socket printer port — 9100 on effectively every ZPL printer. */
  port: z.number().int().min(1).max(65535).default(9100),
  dpi: z.union([z.literal(203), z.literal(300), z.literal(600)]).default(203),
  labelWidthMm: z.number().int().min(25).max(210).default(100),
  labelHeightMm: z.number().int().min(25).max(297).default(75),
  active: z.boolean().default(true),
};

export const CreatePrinterCommandSchema = z
  .object({ clientId: z.string().min(1).max(64), ...printerFields })
  .strict();
export type CreatePrinterCommand = z.infer<typeof CreatePrinterCommandSchema>;

/** Partial update; storeRef is immutable (equipment moves = new record). */
export const UpdatePrinterCommandSchema = z
  .object({
    clientId: z.string().min(1).max(64),
    printerId: z.string().min(1).max(64),
    name: printerFields.name.optional(),
    host: printerFields.host.optional(),
    port: z.number().int().min(1).max(65535).optional(),
    dpi: z.union([z.literal(203), z.literal(300), z.literal(600)]).optional(),
    labelWidthMm: z.number().int().min(25).max(210).optional(),
    labelHeightMm: z.number().int().min(25).max(297).optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type UpdatePrinterCommand = z.infer<typeof UpdatePrinterCommandSchema>;
