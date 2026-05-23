import { Context, Effect, Layer } from 'effect';
import { InfrastructureError } from '@pinpoint/framework';
import type { MasterLocationId } from './ids.js';

export interface ProcessingLogEntry {
  readonly id: string;
  readonly masterLocationId: MasterLocationId;
  readonly step: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

export interface ProcessingLogRepository {
  append(
    masterLocationId: MasterLocationId,
    step: string,
    data: Readonly<Record<string, unknown>>,
  ): Promise<void>;

  listByMaster(masterLocationId: MasterLocationId): Promise<readonly ProcessingLogEntry[]>;
}

export interface ProcessingLogsService {
  readonly append: (
    masterLocationId: MasterLocationId,
    step: string,
    data: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<void, InfrastructureError>;
  readonly listByMaster: (
    masterLocationId: MasterLocationId,
  ) => Effect.Effect<readonly ProcessingLogEntry[], InfrastructureError>;
}

export class ProcessingLogs extends Context.Service<
  ProcessingLogs,
  ProcessingLogsService
>()('@pinpoint/server/ProcessingLogs') {
  static layer(port: ProcessingLogRepository): Layer.Layer<ProcessingLogs> {
    const wrap =
      <Args extends readonly unknown[], A>(op: string, fn: (...args: Args) => Promise<A>) =>
      (...args: Args): Effect.Effect<A, InfrastructureError> =>
        Effect.tryPromise({
          try: () => fn(...args),
          catch: (cause) =>
            new InfrastructureError({
              code: `PROCESSING_LOG_REPO_${op}_FAILED`,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });

    return Layer.succeed(ProcessingLogs, {
      append: wrap('APPEND', port.append.bind(port)),
      listByMaster: wrap('LIST', port.listByMaster.bind(port)),
    });
  }
}
