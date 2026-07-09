import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { ScopeStore, isFailure } from '@fulfil-go/framework';
import {
  AcceptJobCommandSchema,
  AssignJobCommandSchema,
  CompleteJobCommandSchema,
  CreateJobCommandSchema,
  JobDtoSchema,
} from '@fulfil-go/shared';
import type { AppContext } from '../../../app-context.js';
import { toJobDto } from '../../../domain/jobs/job-dto.js';
import { sendUseCaseError, useCaseErrorOutcome } from '../../plugins/error-mapper.js';
import { withIdempotency } from '../../plugins/idempotency.js';
import { UnauthorizedSchema, WRITE_RESPONSES } from '../../schemas/common.js';

export function registerJobRoutes(fastify: FastifyInstance, appContext: AppContext): void {
  fastify.post(
    '/jobs',
    {
      schema: {
        tags: ['Jobs'],
        body: Type.Object({ title: Type.String(), details: Type.Optional(Type.String()) }),
        response: {
          201: Type.Object({ jobId: Type.String(), createdAt: Type.String() }),
          ...WRITE_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      const parsed = CreateJobCommandSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.createJob.execute(parsed.data),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);
      appContext.sseBroker.nudge();

      const data = result.value.getData();
      return reply
        .code(201)
        .send({ jobId: data.jobId, createdAt: result.value.time.toISOString() });
    },
  );

  fastify.post(
    '/jobs/:jobId/assign',
    {
      schema: {
        tags: ['Jobs'],
        params: Type.Object({ jobId: Type.String() }),
        body: Type.Object({ assigneeId: Type.String() }),
        response: {
          200: Type.Object({ jobId: Type.String(), assigneeId: Type.String() }),
          ...WRITE_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      const parsed = AssignJobCommandSchema.safeParse({
        jobId: (request.params as { jobId: string }).jobId,
        ...(request.body as object),
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      const result = await appContext.runWrite(() =>
        appContext.useCases.assignJob.execute(parsed.data),
      );
      if (isFailure(result)) return sendUseCaseError(reply, result.error);
      appContext.sseBroker.nudge();

      const data = result.value.getData();
      return reply.code(200).send({ jobId: data.jobId, assigneeId: data.assigneeId });
    },
  );

  // accept + complete are issued from the mobile offline queue and carry an
  // Idempotency-Key header — wrapped in withIdempotency so replayed keys
  // return the stored response instead of re-executing. The use cases also
  // re-execute idempotently, covering the store-after-commit crash window.
  fastify.post(
    '/jobs/:jobId/accept',
    {
      schema: {
        tags: ['Jobs'],
        params: Type.Object({ jobId: Type.String() }),
        response: {
          200: Type.Object({ jobId: Type.String(), status: Type.String() }),
          ...WRITE_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      const parsed = AcceptJobCommandSchema.safeParse({
        jobId: (request.params as { jobId: string }).jobId,
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      return withIdempotency(appContext.repositories.idempotency, request, reply, async () => {
        const result = await appContext.runWrite(() =>
          appContext.useCases.acceptJob.execute(parsed.data),
        );
        if (isFailure(result)) return useCaseErrorOutcome(result.error);
        appContext.sseBroker.nudge();
        return {
          status: 200,
          body: { jobId: result.value.getData().jobId, status: 'accepted' },
        };
      });
    },
  );

  fastify.post(
    '/jobs/:jobId/complete',
    {
      schema: {
        tags: ['Jobs'],
        params: Type.Object({ jobId: Type.String() }),
        body: Type.Optional(Type.Object({ note: Type.Optional(Type.String()) })),
        response: {
          200: Type.Object({ jobId: Type.String(), status: Type.String() }),
          ...WRITE_RESPONSES,
        },
      },
    },
    async (request, reply) => {
      const parsed = CompleteJobCommandSchema.safeParse({
        jobId: (request.params as { jobId: string }).jobId,
        ...(request.body as object | null),
      });
      if (!parsed.success) {
        return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
      }
      if (!ScopeStore.get()) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }

      return withIdempotency(appContext.repositories.idempotency, request, reply, async () => {
        const result = await appContext.runWrite(() =>
          appContext.useCases.completeJob.execute(parsed.data),
        );
        if (isFailure(result)) return useCaseErrorOutcome(result.error);
        appContext.sseBroker.nudge();
        return {
          status: 200,
          body: { jobId: result.value.getData().jobId, status: 'completed' },
        };
      });
    },
  );

  // The mobile working set: jobs assigned to the calling principal.
  fastify.get(
    '/jobs',
    {
      schema: {
        tags: ['Jobs'],
        response: {
          200: Type.Object({ jobs: Type.Array(JobDtoSchema) }),
          401: UnauthorizedSchema,
        },
      },
    },
    async (_request, reply) => {
      const scope = ScopeStore.get();
      if (!scope) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required.' });
      }
      const jobs = await appContext.repositories.jobs.listByAssignee(scope.principalId);
      return reply.code(200).send({ jobs: jobs.map(toJobDto) });
    },
  );
}
