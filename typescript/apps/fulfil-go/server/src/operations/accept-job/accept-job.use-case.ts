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
import { JobAccepted } from '../../domain/jobs/events/job-accepted.event.js';
import type { JobRepository } from '../../domain/jobs/job.repository.js';
import {
  userChannel,
  type SyncEventRepository,
} from '../../infrastructure/sync-event-repository.js';
import type { AcceptJobCommand } from './accept-job.command.js';

/**
 * Issued from the mobile offline queue, so re-execution must be graceful:
 * the primary dedupe is the Idempotency-Key plugin at the route, but if a
 * duplicate slips through (crash between business tx and key insert), an
 * already-accepted job re-commits as a no-op transition rather than failing.
 */
export class AcceptJobUseCase {
  static readonly requiredPermission = FulfilGoPermission.AcceptJob;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly jobs: JobRepository,
    private readonly syncEvents: SyncEventRepository,
  ) {}

  async execute(command: AcceptJobCommand): Promise<Result<JobAccepted>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${FulfilGoPermission.AcceptJob}.`,
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
    if (prior.status === 'completed') {
      return Result.failure(
        UseCaseError.businessRule(
          'JOB_ALREADY_COMPLETED',
          `Job '${prior.id}' is already completed.`,
        ),
      );
    }
    if (prior.status !== 'assigned' && prior.status !== 'accepted') {
      return Result.failure(
        UseCaseError.businessRule(
          'JOB_NOT_ASSIGNED',
          `Job '${prior.id}' is '${prior.status}' — only 'assigned' jobs can be accepted.`,
          { status: prior.status },
        ),
      );
    }

    // Idempotent re-execution: an already-accepted job re-commits unchanged.
    const job = prior.status === 'accepted' ? prior : Job.accept(prior, new Date());
    const event = new JobAccepted(scope, { jobId: job.id, assigneeId: scope.principalId });

    await this.syncEvents.append(userChannel(scope.principalId), SyncEventType.JobAccepted, {
      job: toJobDto(job),
    });

    return commitAggregate(this.uow, this.registry, job, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(AcceptJobUseCase.requiredPermission);
  }
}
