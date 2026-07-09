import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { DeltaSyncResponse, JobDto, SyncEventPayload } from '@fulfil-go/shared';
import type { ApiClient, OfflineQueue, SseEvent, SseState } from '@fulfil-go/mobile-kit';

const LAST_EVENT_KEY = 'fulfilgo.pick.lastEventId';

export interface JobsStore {
  readonly jobs: Ref<JobDto[]>;
  readonly active: ComputedRef<JobDto[]>;
  readonly lastEventId: Ref<string | null>;
  readonly sseState: Ref<SseState>;
  hydrate(): Promise<void>;
  applySse(event: SseEvent): void;
  byId(id: string): JobDto | undefined;
  /** Offline-queued transition with an optimistic local status flip. */
  accept(jobId: string): Promise<void>;
  complete(jobId: string, note?: string): Promise<void>;
}

/**
 * The app's working set. Hydrates from GET /sync/jobs, applies SSE deltas by
 * event id, and persists the SSE high-water mark so a cold start resumes
 * instead of replaying the channel.
 */
export function createJobsStore(api: ApiClient, queue: OfflineQueue): JobsStore {
  const jobs = ref<JobDto[]>([]);
  const sseState = ref<SseState>('closed');
  const lastEventId = ref<string | null>(
    typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_EVENT_KEY) : null,
  );

  function setLastEventId(id: string): void {
    lastEventId.value = id;
    if (typeof localStorage !== 'undefined') localStorage.setItem(LAST_EVENT_KEY, id);
  }

  function upsert(job: JobDto): void {
    const index = jobs.value.findIndex((j) => j.id === job.id);
    if (index === -1) jobs.value.push(job);
    else jobs.value[index] = job;
  }

  function patchStatus(jobId: string, status: JobDto['status']): void {
    const job = jobs.value.find((j) => j.id === jobId);
    if (job) upsert({ ...job, status });
  }

  return {
    jobs,
    active: computed(() => jobs.value.filter((j) => j.status !== 'completed')),
    lastEventId,
    sseState,

    async hydrate(): Promise<void> {
      const res = await api.json<DeltaSyncResponse>('/sync/jobs');
      jobs.value = [...res.jobs];
      if (res.latestEventId !== '0') setLastEventId(res.latestEventId);
    },

    applySse(event: SseEvent): void {
      try {
        const payload = JSON.parse(event.data) as SyncEventPayload;
        upsert(payload.job);
      } catch {
        return; // unknown payload shape — delta sync will reconcile
      }
      if (event.id !== null) setLastEventId(event.id);
    },

    byId: (id) => jobs.value.find((j) => j.id === id),

    async accept(jobId): Promise<void> {
      patchStatus(jobId, 'accepted');
      await queue.enqueue({ endpoint: `/jobs/${jobId}/accept`, body: {} });
    },

    async complete(jobId, note): Promise<void> {
      patchStatus(jobId, 'completed');
      await queue.enqueue({
        endpoint: `/jobs/${jobId}/complete`,
        body: note ? { note } : {},
      });
    },
  };
}
