import { asTsid, brandedTsid, isTsid, type Tsid } from '@fulfil-go/framework';

/**
 * Branded TSIDs for the pick subdomain. `pic` registers with the
 * AggregateRegistry prefix map.
 */
export const PICK_ID_PREFIX = 'pic' as const;

export type PickId = Tsid<typeof PICK_ID_PREFIX>;

export const newPickId = (): PickId => brandedTsid(PICK_ID_PREFIX);

/** Checked cast for trusted values (DB rows). For user input use `isPickId`. */
export const asPickId = (value: string): PickId => asTsid(PICK_ID_PREFIX, value);

export const isPickId = (value: string): value is PickId => isTsid(PICK_ID_PREFIX, value);
