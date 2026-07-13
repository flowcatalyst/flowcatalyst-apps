import { registerPlugin } from '@capacitor/core';

/**
 * Minimal IN-REPO Capacitor plugin (docs/bag-label-printing.md): one raw TCP
 * write to the printer's :9100 — small enough that owning the ~50 lines of
 * Java beats taking a third-party socket plugin onto the npm supply-chain
 * surface. ANDROID ONLY (picking stations are Android or browser; there is
 * no iOS app) — no web implementation either (browser dev uses Zebra
 * Browser Print — see print.ts).
 */
export interface TcpPrintPlugin {
  send(options: { host: string; port: number; dataBase64: string }): Promise<void>;
}

export const TcpPrint = registerPlugin<TcpPrintPlugin>('TcpPrint');
