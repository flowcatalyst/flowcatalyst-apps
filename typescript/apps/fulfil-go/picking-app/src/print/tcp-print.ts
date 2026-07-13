import { registerPlugin } from '@capacitor/core';

/**
 * Minimal IN-REPO Capacitor plugin (docs/bag-label-printing.md): one raw TCP
 * write to the printer's :9100 — small enough that owning the ~40 lines of
 * Kotlin/Swift beats taking a third-party socket plugin onto the npm
 * supply-chain surface. Native implementations live in the android/ and
 * ios/ projects; there is deliberately NO web implementation (browser dev
 * uses Zebra Browser Print — see print.ts).
 */
export interface TcpPrintPlugin {
  send(options: { host: string; port: number; dataBase64: string }): Promise<void>;
}

export const TcpPrint = registerPlugin<TcpPrintPlugin>('TcpPrint');
