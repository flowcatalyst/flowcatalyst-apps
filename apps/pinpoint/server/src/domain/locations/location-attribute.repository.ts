import { Context, Effect, Layer } from 'effect';
import type { TransactionContext } from '@flowcatalyst-apps/app-framework';
import { InfrastructureError } from '@pinpoint/framework';
import type { LocationId } from './ids.js';
import type { LocationAttribute } from './location-attribute.js';

export interface LocationAttributeRepository {
  insertMany(
    attributes: readonly LocationAttribute[],
    tx?: TransactionContext,
  ): Promise<void>;
  listByLocation(locationId: LocationId): Promise<readonly LocationAttribute[]>;
}

export interface LocationAttributesService {
  readonly insertMany: (
    attributes: readonly LocationAttribute[],
    tx?: TransactionContext,
  ) => Effect.Effect<void, InfrastructureError>;
  readonly listByLocation: (
    locationId: LocationId,
  ) => Effect.Effect<readonly LocationAttribute[], InfrastructureError>;
}

export class LocationAttributes extends Context.Service<
  LocationAttributes,
  LocationAttributesService
>()('@pinpoint/server/LocationAttributes') {
  static layer(port: LocationAttributeRepository): Layer.Layer<LocationAttributes> {
    const wrap =
      <Args extends readonly unknown[], A>(op: string, fn: (...args: Args) => Promise<A>) =>
      (...args: Args): Effect.Effect<A, InfrastructureError> =>
        Effect.tryPromise({
          try: () => fn(...args),
          catch: (cause) =>
            new InfrastructureError({
              code: `LOCATION_ATTRIBUTE_REPO_${op}_FAILED`,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

    return Layer.succeed(LocationAttributes, {
      insertMany: wrap('INSERT', port.insertMany.bind(port)),
      listByLocation: wrap('LIST', port.listByLocation.bind(port)),
    });
  }
}
