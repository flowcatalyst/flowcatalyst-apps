import { Effect } from 'effect';
import { generateTsid } from '@flowcatalyst/sdk';
import {
  AggregateRegistry,
  AuthorizationError,
  BusinessRuleViolation,
  commitAggregate,
  InfrastructureError,
  NotFoundError,
  ScopeStore,
  ValidationError,
  type Sealed,
  type UnitOfWork,
  type UseCaseError,
} from '@pinpoint/framework';
import { PinpointPermission } from '@pinpoint/shared';

import { Location } from '../../domain/locations/location.js';
import { asLocationId, LOCATION_ID_PREFIX } from '../../domain/locations/ids.js';
import { LocationCreated } from '../../domain/locations/events/location-created.event.js';
import { asClientId, asPartitionId } from '../../domain/tenancy/ids.js';
import type { ClientRepository } from '../../domain/tenancy/client.repository.js';
import type { PartitionRepository } from '../../domain/tenancy/partition.repository.js';
import type { LocationRepository } from '../../domain/locations/location.repository.js';
import type { CreateLocationCommand } from './create-location.command.js';

/**
 * Slice 3 minimal create: persists the raw address fields verbatim with
 * `status='PENDING'` and no master/match info. The richer matching
 * pipeline (libpostal normalization → hash + fuzzy candidate search →
 * LLM verification → master_location association → status transitions)
 * lands in slices 5-8 as separate use cases that mutate this aggregate.
 */
export class CreateLocationUseCase {
  static readonly requiredPermission = PinpointPermission.LocationsLocationCreate;

  constructor(
    private readonly clients: ClientRepository,
    private readonly partitions: PartitionRepository,
    private readonly locations: LocationRepository,
  ) {}

  execute = (
    command: CreateLocationCommand,
  ): Effect.Effect<Sealed<LocationCreated>, UseCaseError, UnitOfWork | AggregateRegistry> => {
    const clients = this.clients;
    const partitions = this.partitions;
    const locations = this.locations;
    const authorize = (): boolean => this.authorize();

    return Effect.gen(function* () {
      const scope = ScopeStore.require();

      if (!authorize()) {
        return yield* Effect.fail(
          new AuthorizationError({
            code: 'PERMISSION_DENIED',
            message: `Missing permission ${PinpointPermission.LocationsLocationCreate}.`,
          }),
        );
      }

      const clientId = asClientId(command.clientId.trim());
      const partitionId =
        command.partitionId && command.partitionId.trim().length > 0
          ? asPartitionId(command.partitionId.trim())
          : null;
      const externalId = command.externalId?.trim() || null;
      const name = command.name?.trim() || null;
      const rawAddressLine1 = command.rawAddressLine1.trim();
      const rawCity = command.rawCity.trim();
      const rawCountry = command.rawCountry.trim();

      if (rawAddressLine1.length === 0) {
        return yield* Effect.fail(
          new ValidationError({
            code: 'ADDRESS_LINE1_REQUIRED',
            message: 'Address line 1 must not be empty.',
          }),
        );
      }
      if (rawCity.length === 0) {
        return yield* Effect.fail(
          new ValidationError({
            code: 'CITY_REQUIRED',
            message: 'City must not be empty.',
          }),
        );
      }
      if (rawCountry.length === 0) {
        return yield* Effect.fail(
          new ValidationError({
            code: 'COUNTRY_REQUIRED',
            message: 'Country must not be empty.',
          }),
        );
      }

      const client = yield* Effect.tryPromise({
        try: () => clients.findById(clientId),
        catch: (cause) =>
          new InfrastructureError({
            code: 'CLIENT_REPO_READ_FAILED',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });
      if (!client) {
        return yield* Effect.fail(
          new NotFoundError({
            code: 'CLIENT_NOT_FOUND',
            message: `Client '${clientId}' not found.`,
          }),
        );
      }

      if (partitionId) {
        const partition = yield* Effect.tryPromise({
          try: () => partitions.findById(partitionId),
          catch: (cause) =>
            new InfrastructureError({
              code: 'PARTITION_REPO_READ_FAILED',
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
        if (!partition) {
          return yield* Effect.fail(
            new NotFoundError({
              code: 'PARTITION_NOT_FOUND',
              message: `Partition '${partitionId}' not found.`,
            }),
          );
        }
      }

      // Idempotent dedup: if an externalId was supplied and we already have a
      // location for (clientId, partitionId, externalId), surface a 409 with
      // the existing id rather than silently re-creating.
      if (externalId) {
        const existing = yield* Effect.tryPromise({
          try: () => locations.findByExternalId(clientId, partitionId, externalId),
          catch: (cause) =>
            new InfrastructureError({
              code: 'LOCATION_REPO_READ_FAILED',
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
        if (existing) {
          return yield* Effect.fail(
            new BusinessRuleViolation({
              code: 'LOCATION_EXTERNAL_ID_EXISTS',
              message: `A location with externalId '${externalId}' already exists in this partition.`,
              details: { existingLocationId: existing.id },
            }),
          );
        }
      }

      const id = asLocationId(`${LOCATION_ID_PREFIX}_${generateTsid()}`);
      const location = Location.create({
        id,
        clientId,
        partitionId,
        externalId,
        name,
        rawAddressLine1,
        rawAddressLine2: command.rawAddressLine2?.trim() || null,
        rawSuburb: command.rawSuburb?.trim() || null,
        rawCity,
        rawState: command.rawState?.trim() || null,
        rawPostalCode: command.rawPostalCode?.trim() || null,
        rawCountry,
        now: new Date(),
      });

      const event = new LocationCreated(scope, {
        locationId: id,
        clientId,
        partitionId,
        externalId,
        rawCity,
        rawCountry,
      });

      return yield* commitAggregate(location, event, command);
    });
  };

  private authorize(): boolean {
    // TODO(auth): real permission check once tokens carry roles.
    return true;
  }
}
