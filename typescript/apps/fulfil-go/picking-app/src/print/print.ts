import { Capacitor } from '@capacitor/core';

/**
 * ZPL delivery from the station to the LAN printer (docs/bag-label-printing.md).
 * The server renders the label; getting it onto paper is OUR job because the
 * cloud server can't reach store LANs.
 *
 * - Native: in-repo TcpPrint plugin — raw TCP to the printer's :9100.
 * - Browser dev: Zebra Browser Print's local agent (plain fetch to its
 *   127.0.0.1:9100 HTTP surface — no SDK). NOTE: Browser Print prints to
 *   ITS configured default printer; the registered host/port only matter
 *   on native.
 *
 * Delivery is best-effort by design: the allocation is already committed
 * server-side, so anything that didn't come out of the printer is a reprint
 * away.
 */
export interface PrinterEndpoint {
  readonly host: string;
  readonly port: number;
}

const BROWSER_PRINT_URL = 'http://127.0.0.1:9100';

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function browserPrint(zpl: string): Promise<void> {
  let device: unknown;
  try {
    const res = await fetch(`${BROWSER_PRINT_URL}/default?type=printer`, { method: 'GET' });
    if (!res.ok) throw new Error(`Browser Print /default responded ${res.status}`);
    device = await res.json();
  } catch {
    throw new Error(
      'Zebra Browser Print is not running (browser dev prints via its local agent on 127.0.0.1:9100).',
    );
  }
  const res = await fetch(`${BROWSER_PRINT_URL}/write`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device, data: zpl }),
  });
  if (!res.ok) {
    throw new Error(`Browser Print rejected the label (${res.status}).`);
  }
}

export async function printZpl(printer: PrinterEndpoint | null, zpl: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    if (!printer) throw new Error('No station printer selected — choose one in Settings.');
    const { TcpPrint } = await import('./tcp-print.js');
    await TcpPrint.send({ host: printer.host, port: printer.port, dataBase64: toBase64(zpl) });
    return;
  }
  await browserPrint(zpl);
}
