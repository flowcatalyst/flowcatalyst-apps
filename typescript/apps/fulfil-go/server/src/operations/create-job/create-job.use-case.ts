import { generateTsid } from '@flowcatalyst/sdk';
import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@fulfil-go/framework';
import { FulfilGoPermission } from '@fulfil-go/shared';
import { Job } from '../../domain/jobs/job.js';
import { asJobId, JOB_ID_PREFIX } from '../../domain/jobs/ids.js';
import { JobCreated } from '../../domain/jobs/events/job-created.event.js';
import type { CreateJobCommand } from './create-job.command.js';

export class CreateJobUseCase {
  static readonly requiredPermission = FulfilGoPermission.CreateJob;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
  ) {}

  async execute(command: CreateJobCommand): Promise<Result<JobCreated>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${FulfilGoPermission.CreateJob}.`,
        ),
      );
    }

    const title = command.title.trim();
    if (title.length === 0) {
      return Result.failure(
        UseCaseError.validation('JOB_TITLE_REQUIRED', 'Job title must not be empty.'),
      );
    }

    const id = asJobId(`${JOB_ID_PREFIX}_${generateTsid()}`);
    const job = Job.create({
      id,
      title,
      details: command.details?.trim() || null,
      now: new Date(),
    });
    const event = new JobCreated(scope, { jobId: id, title });

    return commitAggregate(this.uow, this.registry, job, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(CreateJobUseCase.requiredPermission);
  }
}
