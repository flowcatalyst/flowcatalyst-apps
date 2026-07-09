import {
  Result,
  ScopeStore,
  UseCaseError,
  commitAggregate,
  type AggregateRegistryImpl,
  type Scope,
  type UnitOfWork,
} from '@fulfil-go/framework';
import { FulfilGoPermission, SyncEventType } from '@fulfil-go/shared';
import { Job } from '../../domain/jobs/job.js';
import { asJobId } from '../../domain/jobs/ids.js';
import { toJobDto } from '../../domain/jobs/job-dto.js';
import { JobCompleted } from '../../domain/jobs/events/job-completed.event.js';
import type { JobRepository } from '../../domain/jobs/job.repository.js';
import {
  userChannel,
  type SyncEventRepository,
} from '../../infrastructure/sync-event-repository.js';
import type { CompleteJobCommand } from './complete-job.command.js';

/** Offline-queued like accept-job — same idempotent re-execution stance. */
export class CompleteJobUseCase {
  static readonly requiredPermission = FulfilGoPermission.CompleteJob;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly jobs: JobRepository,
    private readonly syncEvents: SyncEventRepository,
  ) {}

  async execute(command: CompleteJobCommand): Promise<Result<JobCompleted>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${FulfilGoPermission.CompleteJob}.`,
        ),
      );
    }

    const prior = await this.jobs.findById(asJobId(command.jobId));
    if (!prior) {
      return Result.failure(
        UseCaseError.notFound('JOB_NOT_FOUND', `Job '${command.jobId}' does not exist.`),
      );
    }
    if (prior.assigneeId !== scope.principalId) {
      return Result.failure(
        UseCaseError.businessRule(
          'JOB_NOT_YOURS',
          `Job '${prior.id}' is not assigned to the calling principal.`,
        ),
      );
    }
    if (prior.status !== 'accepted' && prior.status !== 'completed') {
      return Result.failure(
        UseCaseError.businessRule(
          'JOB_NOT_ACCEPTED',
          `Job '${prior.id}' is '${prior.status}' — accept it before completing.`,
          { status: prior.status },
        ),
      );
    }

    // Idempotent re-execution: an already-completed job re-commits unchanged.
    const job = prior.status === 'completed' ? prior : Job.complete(prior, new Date());
    const event = new JobCompleted(scope, {
      jobId: job.id,
      assigneeId: scope.principalId,
      ...(command.note ? { note: command.note } : {}),
    });

    await this.syncEvents.append(userChannel(scope.principalId), SyncEventType.JobCompleted, {
      job: toJobDto(job),
    });

    return commitAggregate(this.uow, this.registry, job, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(CompleteJobUseCase.requiredPermission);
  }
}
