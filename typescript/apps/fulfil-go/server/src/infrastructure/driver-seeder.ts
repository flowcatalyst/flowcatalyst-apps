import { newDriverUserId } from '../domain/driver-identity/ids.js';
import { DriverUser } from '../domain/driver-identity/driver-user.js';
import type { DriverUserRepository } from '../domain/driver-identity/driver-user.repository.js';
import type { StoreRepository } from './store-repository.js';
import { hashSecret } from '../auth/pick-credentials.js';

/**
 * Dev/test driver seeding: N drivers per registry store (= home depot),
 * staff codes `D01…Dnn`, ONE shared PIN, and a deterministic default
 * vehicle registration per driver. Same deliberate dev-only shortcut as the
 * picker seeder: one hash reused across rows (scrypt at ~80ms/hash). Real
 * provisioning goes through CreateDriverUseCase.
 *
 * Idempotent: existing (depot, staffCode) rows are skipped by the repo's
 * conflict-free insert, so re-runs only fill gaps.
 */
const FIRST_NAMES = [
  'Sizwe',
  'Marius',
  'Ayanda',
  'Deon',
  'Nomsa',
  'Riaan',
  'Thabo',
  'Yusuf',
  'Karabo',
  'Wayne',
  'Mandla',
  'Anele',
];
const LAST_NAMES = [
  'Zulu',
  'Coetzee',
  'Maseko',
  'Adams',
  'Moyo',
  'du Plessis',
  'Radebe',
  'Hendricks',
  'Molefe',
  'Daniels',
  'Cele',
  'Vermeulen',
];

/** Deterministic SA-style plate per (store, slot) — dev fixture, not real. */
function vehicleReg(storeIndex: number, slot: number): string {
  const n = (storeIndex * 7 + slot * 137 + 111) % 1000;
  return `FG${String(storeIndex % 100).padStart(2, '0')}${String(n).padStart(3, '0')}GP`;
}

export interface SeedDriversInput {
  readonly clientId: string;
  readonly perStore: number;
  readonly pin: string;
  /** Also overwrite EXISTING seeded drivers' PINs (rotate the shared dev PIN). */
  readonly resetPins?: boolean;
}

export interface SeedDriversResult {
  readonly stores: number;
  readonly created: number;
  readonly skipped: number;
  readonly pinsReset: number;
}

export async function seedDrivers(
  storeRepo: StoreRepository,
  driverRepo: DriverUserRepository,
  input: SeedDriversInput,
): Promise<SeedDriversResult> {
  const storeList = await storeRepo.listByClient(input.clientId);
  if (storeList.length === 0) return { stores: 0, created: 0, skipped: 0, pinsReset: 0 };

  const pinHash = await hashSecret(input.pin);
  const now = new Date();

  const drivers: DriverUser[] = [];
  storeList.forEach((store, storeIndex) => {
    for (let i = 0; i < input.perStore; i += 1) {
      // Deterministic name walk so re-runs produce the same roster.
      const n = storeIndex * input.perStore + i;
      const displayName = `${FIRST_NAMES[n % FIRST_NAMES.length]} ${
        LAST_NAMES[Math.floor(n / FIRST_NAMES.length) % LAST_NAMES.length]
      }`;
      drivers.push(
        DriverUser.create({
          id: newDriverUserId(),
          clientId: input.clientId,
          storeRef: store.storeRef,
          displayName,
          staffCode: `D${String(i + 1).padStart(2, '0')}`,
          defaultVehicleReg: vehicleReg(storeIndex, i),
          pinHash,
          now,
        }),
      );
    }
  });

  const created = await driverRepo.insertManyIfAbsent(drivers);
  const pinsReset = input.resetPins ? await driverRepo.resetSeededPins(input.clientId, pinHash) : 0;
  return { stores: storeList.length, created, skipped: drivers.length - created, pinsReset };
}
