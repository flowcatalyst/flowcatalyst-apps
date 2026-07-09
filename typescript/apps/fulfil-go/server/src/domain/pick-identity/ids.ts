import { asTsid, brandedTsid, isTsid, type Tsid } from '@fulfil-go/framework';

/**
 * Branded TSIDs for the pick-identity subdomain (picker users, and later
 * devices + enrollment tokens). `pkr` registers with the AggregateRegistry
 * prefix map so `commitAggregate` resolves the picker repository at persist
 * time.
 */
export const PICKER_USER_ID_PREFIX = 'pkr' as const;

export type PickerUserId = Tsid<typeof PICKER_USER_ID_PREFIX>;

export const newPickerUserId = (): PickerUserId => brandedTsid(PICKER_USER_ID_PREFIX);

/** Checked cast for trusted values (DB rows). For user input use `isPickerUserId`. */
export const asPickerUserId = (value: string): PickerUserId =>
  asTsid(PICKER_USER_ID_PREFIX, value);

export const isPickerUserId = (value: string): value is PickerUserId =>
  isTsid(PICKER_USER_ID_PREFIX, value);
