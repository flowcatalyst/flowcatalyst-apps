/**
 * Capture a DRAFT master location's address properly — it came from a
 * delivery capture with only a reverse-geocoded (or driver-typed) address.
 * DRAFT → VALIDATED: from now on incoming locations for the address match it
 * and copy its coordinates. The address hash + line are recomputed from the
 * components, like an update.
 */
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { MasterLocation } from '../../domain/locations/master-location.js';
import { asMasterLocationId } from '../../domain/locations/ids.js';
import { MasterLocationCompleted } from '../../domain/locations/events/master-location-completed.event.js';
import { addressDetailsFromMaster } from '../../domain/locations/events/address-details.js';
import type { MasterLocationRepository } from '../../domain/locations/master-location.repository.js';
import {
  ProcessingStep,
  type ProcessingLogRepository,
} from '../../domain/locations/processing-log.repository.js';
import { toAddressLine } from '../../domain/services/address-normalizer.js';
import { addressLineHash, tidyAddressLine } from '../../domain/services/address-line.js';
import { trail } from '../_shared/load-location.js';
import type { CompleteMasterLocationCommand } from './complete-master-location.command.js';

export class CompleteMasterLocationUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsMasterLocationComplete;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly masters: MasterLocationRepository,
    private readonly processingLog: ProcessingLogRepository,
  ) {}

  async execute(command: CompleteMasterLocationCommand): Promise<Result<MasterLocationCompleted>> {
    const scope = ScopeStore.require();
    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${CompleteMasterLocationUseCase.requiredPermission}.`,
        ),
      );
    }
    const id = asMasterLocationId(command.masterLocationId.trim());
    const master = await this.masters.findById(id);
    if (!master || master.clientId !== command.clientId.trim()) {
      return Result.failure(
        UseCaseError.notFound('MASTER_LOCATION_NOT_FOUND', `Master location '${id}' not found.`),
      );
    }
    if (master.status !== 'DRAFT') {
      return Result.failure(
        UseCaseError.businessRule(
          'MASTER_LOCATION_NOT_DRAFT',
          `Master location is ${master.status}; only a DRAFT is completed.`,
        ),
      );
    }

    const blank = (v: string | null | undefined) => (v && v.length > 0 ? v : null);
    const components = {
      houseNumber: blank(command.normalizedHouseNumber),
      road: blank(command.normalizedRoad),
      suburb: blank(command.normalizedSuburb),
      city: command.normalizedCity,
      state: blank(command.normalizedState),
      postalCode: blank(command.normalizedPostalCode),
      country: command.normalizedCountry,
    };
    const line = tidyAddressLine(toAddressLine(components));
    const now = new Date();
    const completed = MasterLocation.completed(master, {
      address: {
        normalizedHouseNumber: components.houseNumber,
        normalizedRoad: components.road,
        normalizedSuburb: components.suburb,
        normalizedCity: components.city,
        normalizedState: components.state,
        normalizedPostalCode: components.postalCode,
        normalizedCountry: components.country,
        addressHash: addressLineHash(line),
        normalizedAddressLine: line,
      },
      name: blank(command.name),
      now,
    });
    const committed = await commitAggregate(
      this.uow,
      this.registry,
      completed,
      new MasterLocationCompleted(scope, {
        masterLocationId: master.id,
        clientId: master.clientId,
        latitude: completed.latitude!,
        longitude: completed.longitude!,
        address: addressDetailsFromMaster(completed),
        name: completed.name,
      }),
      command,
    );
    await trail(() =>
      this.processingLog.append({ masterLocationId: master.id }, ProcessingStep.Completed, {
        address_line: line,
      }),
    );
    return committed;
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(CompleteMasterLocationUseCase.requiredPermission);
  }
}
