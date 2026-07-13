import { asTsid, brandedTsid, isTsid, type Tsid } from '@fulfil-go/framework';

/** Branded TSIDs for the transport subdomain. */
export const TRANSPORT_ORDER_ID_PREFIX = 'tro' as const;

export type TransportOrderId = Tsid<typeof TRANSPORT_ORDER_ID_PREFIX>;

export const newTransportOrderId = (): TransportOrderId => brandedTsid(TRANSPORT_ORDER_ID_PREFIX);

/** Checked cast for trusted values (DB rows). For user input use `isTransportOrderId`. */
export const asTransportOrderId = (value: string): TransportOrderId =>
  asTsid(TRANSPORT_ORDER_ID_PREFIX, value);

export const isTransportOrderId = (value: string): value is TransportOrderId =>
  isTsid(TRANSPORT_ORDER_ID_PREFIX, value);
