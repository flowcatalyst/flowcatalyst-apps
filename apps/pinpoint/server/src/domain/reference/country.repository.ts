import { Context, Effect, Layer } from 'effect';
import { InfrastructureError } from '@pinpoint/framework';
import type { Country } from './country.js';

export interface CountryRepository {
  listAll(): Promise<readonly Country[]>;
  findByIsoA2(isoA2: string): Promise<Country | null>;
  findByIsoA3(isoA3: string): Promise<Country | null>;
}

export interface CountriesService {
  readonly listAll: () => Effect.Effect<readonly Country[], InfrastructureError>;
  readonly findByIsoA2: (isoA2: string) => Effect.Effect<Country | null, InfrastructureError>;
  readonly findByIsoA3: (isoA3: string) => Effect.Effect<Country | null, InfrastructureError>;
}

export class Countries extends Context.Service<Countries, CountriesService>()(
  '@pinpoint/server/Countries',
) {
  static layer(port: CountryRepository): Layer.Layer<Countries> {
    const wrap =
      <Args extends readonly unknown[], A>(op: string, fn: (...args: Args) => Promise<A>) =>
      (...args: Args): Effect.Effect<A, InfrastructureError> =>
        Effect.tryPromise({
          try: () => fn(...args),
          catch: (cause) =>
            new InfrastructureError({
              code: `COUNTRY_REPO_${op}_FAILED`,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

    return Layer.succeed(Countries, {
      listAll: wrap('LIST', port.listAll.bind(port)),
      findByIsoA2: wrap('READ', port.findByIsoA2.bind(port)),
      findByIsoA3: wrap('READ', port.findByIsoA3.bind(port)),
    });
  }
}
