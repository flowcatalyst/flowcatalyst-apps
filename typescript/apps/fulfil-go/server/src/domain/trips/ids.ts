import { asTsid, brandedTsid, isTsid, type Tsid } from '@fulfil-go/framework';

/** Branded TSIDs for the transport PLANNING subdomain. */
export const TRIP_ID_PREFIX = 'trp' as const;

export type TripId = Tsid<typeof TRIP_ID_PREFIX>;

export const newTripId = (): TripId => brandedTsid(TRIP_ID_PREFIX);

/** Checked cast for trusted values (DB rows). For user input use `isTripId`. */
export const asTripId = (value: string): TripId => asTsid(TRIP_ID_PREFIX, value);

export const isTripId = (value: string): value is TripId => isTsid(TRIP_ID_PREFIX, value);
