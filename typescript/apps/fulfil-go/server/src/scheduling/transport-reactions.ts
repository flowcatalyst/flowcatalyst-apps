import { isFailure } from '@fulfil-go/framework';
import type { AppContext } from '../app-context.js';
import { REQUEST_TRANSPORT_REACTION } from '../operations/request-transport/request-transport.use-cases.js';

const BATCH_LIMIT = 100;

export interface ReactionsSweepResult {
  readonly attempted: number;
  readonly executed: number;
  readonly skipped: number;
  readonly failed: number;
  readonly failures: readonly { reactionId: string; error: string }[];
}

/**
 * The timed-reactions sweep (docs/transport-context.md): release due
 * process reactions — first consumer is the STANDARD service-level
 * transport request (booked by the PM at fulfilment READY, due at
 * slotStart − transportLeadTime). Dumb reconciler like the release-picks
 * sweep: per-item error containment, naturally idempotent (done rows are
 * no longer due; the executed use case state-guards itself anyway).
 */
export async function runTransportReactionsSweep(
  appContext: AppContext,
): Promise<ReactionsSweepResult> {
  const due = await appContext.repositories.processReactions.listDue(new Date(), BATCH_LIMIT);

  let executed = 0;
  let skipped = 0;
  const failures: { reactionId: string; error: string }[] = [];

  for (const reaction of due) {
    try {
      if (reaction.kind !== REQUEST_TRANSPORT_REACTION) {
        // Unknown kinds are a deploy mismatch — leave pending, surface loudly.
        failures.push({ reactionId: reaction.id, error: `unknown kind '${reaction.kind}'` });
        continue;
      }
      const result = await appContext.runWrite(() =>
        appContext.useCases.requestTransport.execute({
          clientId: reaction.clientId,
          fulfilmentId: reaction.fulfilmentId,
        }),
      );
      if (isFailure(result)) {
        if (result.error.type === 'business_rule' || result.error.type === 'not_found') {
          // Converged (already requested / fulfilment moved on) — done.
          await appContext.repositories.processReactions.markDone(reaction.id);
          skipped += 1;
        } else {
          failures.push({ reactionId: reaction.id, error: `${result.error.code}` });
        }
      } else {
        await appContext.repositories.processReactions.markDone(reaction.id);
        executed += 1;
      }
    } catch (err) {
      failures.push({
        reactionId: reaction.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    attempted: due.length,
    executed,
    skipped,
    failed: failures.length,
    failures,
  };
}
