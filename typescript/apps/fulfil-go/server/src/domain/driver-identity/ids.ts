import { asTsid, brandedTsid, isTsid, type Tsid } from '@fulfil-go/framework';

/** Branded TSIDs for the transport-context driver identity plane. */
export const DRIVER_USER_ID_PREFIX = 'drv' as const;

export type DriverUserId = Tsid<typeof DRIVER_USER_ID_PREFIX>;

export const newDriverUserId = (): DriverUserId => brandedTsid(DRIVER_USER_ID_PREFIX);

/** Checked cast for trusted values (DB rows). For user input use `isDriverUserId`. */
export const asDriverUserId = (value: string): DriverUserId => asTsid(DRIVER_USER_ID_PREFIX, value);

export const isDriverUserId = (value: string): value is DriverUserId =>
  isTsid(DRIVER_USER_ID_PREFIX, value);
