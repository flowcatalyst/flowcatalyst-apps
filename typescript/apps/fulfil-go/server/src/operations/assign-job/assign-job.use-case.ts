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
import { JobAssigned } from '../../domain/jobs/events/job-assigned.event.js';
import type { JobRepository } from '../../domain/jobs/job.repository.js';
import {
  userChannel,
  type SyncEventRepository,
} from '../../infrastructure/sync-event-repository.js';
import type { AssignJobCommand } from './assign-job.command.js';

export class AssignJobUseCase {
  static readonly requiredPermission = FulfilGoPermission.AssignJob;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly registry: AggregateRegistryImpl,
    private readonly jobs: JobRepository,
    private readonly syncEvents: SyncEventRepository,
  ) {}

  async execute(command: AssignJobCommand): Promise<Result<JobAssigned>> {
    const scope = ScopeStore.require();

    if (!this.authorize(scope)) {
      return Result.failure(
        UseCaseError.authorization(
          'PERMISSION_DENIED',
          `Missing permission ${FulfilGoPermission.AssignJob}.`,
        ),
      );
    }

    const prior = await this.jobs.findById(asJobId(command.jobId));
    if (!prior) {
      return Result.failure(
        UseCaseError.notFound('JOB_NOT_FOUND', `Job '${command.jobId}' does not exist.`),
      );
    }
    if (prior.status !== 'created') {
      return Result.failure(
        UseCaseError.businessRule(
          'JOB_NOT_ASSIGNABLE',
          `Job '${prior.id}' is '${prior.status}' — only 'created' jobs can be assigned.`,
          { status: prior.status },
        ),
      );
    }

    const job = Job.assign(prior, command.assigneeId, new Date());
    const event = new JobAssigned(scope, { jobId: job.id, assigneeId: command.assigneeId });

    // Same ALS-bound tx as the aggregate write — rolls back with the commit,
    // so a failed command never leaks a phantom SSE event.
    await this.syncEvents.append(userChannel(command.assigneeId), SyncEventType.JobAssigned, {
      job: toJobDto(job),
    });

    return commitAggregate(this.uow, this.registry, job, event, command);
  }

  private authorize(scope: Scope): boolean {
    return scope.permissions.has(AssignJobUseCase.requiredPermission);
  }
}
