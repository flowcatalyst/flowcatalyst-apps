import { newDriverUserId } from '../domain/driver-identity/ids.js';
import { DriverUser } from '../domain/driver-identity/driver-user.js';
import type { DriverUserRepository } from '../domain/driver-identity/driver-user.repository.js';
import type { DepotRepository } from './depot-repository.js';
import { hashSecret } from '../auth/pick-credentials.js';

/**
 * Dev/test driver seeding: N drivers per registry DEPOT, staff codes
 * `D01…Dnn`, ONE shared PIN, a deterministic default vehicle registration,
 * and a class walked from the client's vehicle classes (when given). Same
 * deliberate dev-only shortcut as the picker seeder: one hash reused across
 * rows. Real provisioning goes through CreateDriverUseCase.
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

/** Deterministic SA-style plate per (depot, slot) — dev fixture, not real. */
function vehicleReg(depotIndex: number, slot: number): string {
  const n = (depotIndex * 7 + slot * 137 + 111) % 1000;
  return `FG${String(depotIndex % 100).padStart(2, '0')}${String(n).padStart(3, '0')}GP`;
}

export interface SeedDriversInput {
  readonly clientId: string;
  readonly perDepot: number;
  readonly pin: string;
  /** Vehicle class codes to walk (client settings) — empty = class-less. */
  readonly vehicleClasses?: readonly string[];
  /** Also overwrite EXISTING seeded drivers' PINs (rotate the shared dev PIN). */
  readonly resetPins?: boolean;
}

export interface SeedDriversResult {
  readonly depots: number;
  readonly created: number;
  readonly skipped: number;
  readonly pinsReset: number;
}

export async function seedDrivers(
  depotRepo: DepotRepository,
  driverRepo: DriverUserRepository,
  input: SeedDriversInput,
): Promise<SeedDriversResult> {
  const depotList = await depotRepo.listByClient(input.clientId);
  if (depotList.length === 0) return { depots: 0, created: 0, skipped: 0, pinsReset: 0 };

  const pinHash = await hashSecret(input.pin);
  const now = new Date();
  const classes = input.vehicleClasses ?? [];

  const drivers: DriverUser[] = [];
  depotList.forEach((depot, depotIndex) => {
    for (let i = 0; i < input.perDepot; i += 1) {
      // Deterministic name walk so re-runs produce the same roster.
      const n = depotIndex * input.perDepot + i;
      const displayName = `${FIRST_NAMES[n % FIRST_NAMES.length]} ${
        LAST_NAMES[Math.floor(n / FIRST_NAMES.length) % LAST_NAMES.length]
      }`;
      drivers.push(
        DriverUser.create({
          id: newDriverUserId(),
          clientId: input.clientId,
          depotRef: depot.depotRef,
          displayName,
          staffCode: `D${String(i + 1).padStart(2, '0')}`,
          defaultVehicleReg: vehicleReg(depotIndex, i),
          defaultVehicleClass: classes.length > 0 ? (classes[n % classes.length] ?? null) : null,
          pinHash,
          now,
        }),
      );
    }
  });

  const created = await driverRepo.insertManyIfAbsent(drivers);
  const pinsReset = input.resetPins ? await driverRepo.resetSeededPins(input.clientId, pinHash) : 0;
  return { depots: depotList.length, created, skipped: drivers.length - created, pinsReset };
}
