import { asTsid, brandedTsid, isTsid, type Tsid } from '@fulfil-go/framework';

/**
 * Branded TSIDs for the fulfilment subdomain (framework `Tsid` helper —
 * FlowCatalyst prefixed-TSID convention). `ful` registers with the
 * AggregateRegistry prefix map; parts (`fpt`) are NOT separate aggregates —
 * they live inside the Fulfilment boundary and persist with it.
 */
export const FULFILMENT_ID_PREFIX = 'ful' as const;
export const FULFILMENT_PART_ID_PREFIX = 'fpt' as const;

export type FulfilmentId = Tsid<typeof FULFILMENT_ID_PREFIX>;
export type FulfilmentPartId = Tsid<typeof FULFILMENT_PART_ID_PREFIX>;

export const newFulfilmentId = (): FulfilmentId => brandedTsid(FULFILMENT_ID_PREFIX);
export const newFulfilmentPartId = (): FulfilmentPartId => brandedTsid(FULFILMENT_PART_ID_PREFIX);

/** Checked casts for trusted values (DB rows). For user input use `isFulfilmentId`. */
export const asFulfilmentId = (value: string): FulfilmentId => asTsid(FULFILMENT_ID_PREFIX, value);
export const asFulfilmentPartId = (value: string): FulfilmentPartId =>
  asTsid(FULFILMENT_PART_ID_PREFIX, value);

export const isFulfilmentId = (value: string): value is FulfilmentId =>
  isTsid(FULFILMENT_ID_PREFIX, value);
