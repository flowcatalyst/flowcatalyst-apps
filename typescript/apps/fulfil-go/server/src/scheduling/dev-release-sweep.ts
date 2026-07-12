import { Cron } from 'croner';
import { runJob } from '@fulfil-go/framework';
import type { AppContext } from '../app-context.js';
import { runReleasePicksSweep } from './release-picks.js';

/**
 * Distinct from SystemIdentity.SCHEDULER on purpose: processing-log entries
 * carry the actor, so releases attribute to the platform cron
 * (fulfil-go:system:scheduler, via the webhook) vs this local fallback —
 * queryable proof of which path did the work.
 */
const DEV_SWEEP_IDENTITY = { principalId: 'fulfil-go:system:dev-sweep' } as const;

interface SweepLogger {
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

/**
 * DEV-ONLY fallback for the platform scheduled job `fulfil-go-release-picks`
 * (gated on FULFILGO_DEV_RELEASE_SWEEP=true; NEVER enable in prod — release
 * scheduling is platform-driven by design).
 *
 * Deliberately LOUD: part of running fulfil-go locally is proving the
 * FlowCatalyst platform loop, so whenever this fallback actually releases
 * anything it WARNS — a healthy platform cron leaves it nothing to do (the
 * sweep is idempotent, so the two coexist safely). A quiet log means the
 * platform is doing its job; warnings mean go look at fc-dev's scheduler.
 */
export function scheduleDevReleaseSweep(appContext: AppContext, log: SweepLogger): Cron {
  return new Cron('* * * * *', async () => {
    try {
      const result = await runJob({ name: 'dev-release-sweep', identity: DEV_SWEEP_IDENTITY }, () =>
        runReleasePicksSweep(appContext),
      );
      if (result.released > 0 || result.failed > 0) {
        log.warn(
          result,
          '[dev-release-sweep] FALLBACK released parts — the platform scheduled job ' +
            'fulfil-go-release-picks should have done this; check the fc-dev scheduler.',
        );
      }
    } catch (err) {
      log.error({ err }, '[dev-release-sweep] fallback sweep failed');
    }
  });
}
