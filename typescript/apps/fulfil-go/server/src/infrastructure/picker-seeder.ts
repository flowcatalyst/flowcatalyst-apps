import { newPickerUserId } from '../domain/pick-identity/ids.js';
import { PickerUser } from '../domain/pick-identity/picker-user.js';
import type { PickerUserRepository } from '../domain/pick-identity/picker-user.repository.js';
import type { StoreRepository } from './store-repository.js';
import { hashSecret } from '../auth/pick-credentials.js';

/**
 * Dev/test picker seeding: N pickers per registry store, staff codes
 * `P01…Pnn`, ONE shared PIN. The PIN is hashed once and the hash reused for
 * every row — a deliberate dev-only shortcut (identical salt across seeded
 * pickers): scrypt at ~80ms/hash would make 1000 rows take a minute+.
 * Real provisioning goes through CreatePickerUseCase.
 *
 * Idempotent: existing (store, staffCode) rows are skipped by the repo's
 * conflict-free insert, so re-runs only fill gaps.
 */
const FIRST_NAMES = [
  'Thandi',
  'Sipho',
  'Anika',
  'Pieter',
  'Lerato',
  'Johan',
  'Zanele',
  'Priya',
  'Kagiso',
  'Emma',
  'Bongani',
  'Chantel',
  'Tumelo',
  'Ravi',
  'Nadia',
];
const LAST_NAMES = [
  'Nkosi',
  'van der Merwe',
  'Dlamini',
  'Botha',
  'Naidoo',
  'Mokoena',
  'Smith',
  'Khumalo',
  'Pillay',
  'Fourie',
  'Sithole',
  'Jacobs',
  'Mahlangu',
  'Petersen',
  'Ngcobo',
];

export interface SeedPickersInput {
  readonly clientId: string;
  readonly perStore: number;
  readonly pin: string;
  /** Also overwrite EXISTING seeded pickers' PINs (rotate the shared dev PIN). */
  readonly resetPins?: boolean;
}

export interface SeedPickersResult {
  readonly stores: number;
  readonly created: number;
  readonly skipped: number;
  readonly pinsReset: number;
}

export async function seedPickers(
  storeRepo: StoreRepository,
  pickerRepo: PickerUserRepository,
  input: SeedPickersInput,
): Promise<SeedPickersResult> {
  const storeList = await storeRepo.listByClient(input.clientId);
  if (storeList.length === 0) return { stores: 0, created: 0, skipped: 0, pinsReset: 0 };

  const pinHash = await hashSecret(input.pin);
  const now = new Date();

  const pickers: PickerUser[] = [];
  storeList.forEach((store, storeIndex) => {
    for (let i = 0; i < input.perStore; i += 1) {
      // Deterministic name walk so re-runs produce the same roster.
      const n = storeIndex * input.perStore + i;
      const displayName = `${FIRST_NAMES[n % FIRST_NAMES.length]} ${
        LAST_NAMES[Math.floor(n / FIRST_NAMES.length) % LAST_NAMES.length]
      }`;
      pickers.push(
        PickerUser.create({
          id: newPickerUserId(),
          clientId: input.clientId,
          storeRef: store.storeRef,
          displayName,
          staffCode: `P${String(i + 1).padStart(2, '0')}`,
          primaryAuthMethod: 'pin',
          // P01 at every store is the shift SUPERVISOR (station supervisor
          // mode — car-or-larger flagging).
          role: i === 0 ? 'supervisor' : 'picker',
          pinHash,
          now,
        }),
      );
    }
  });

  const created = await pickerRepo.insertManyIfAbsent(pickers);
  // Inserts above already carry the new hash; the reset flips the SKIPPED
  // (pre-existing seeded) rows so one shared PIN rules them all.
  const pinsReset = input.resetPins ? await pickerRepo.resetSeededPins(input.clientId, pinHash) : 0;
  return { stores: storeList.length, created, skipped: pickers.length - created, pinsReset };
}
