/**
 * Processing-trail entries for a location's match attempt (create-location,
 * rematch-location). Fire-and-forget: a trail write must never fail matching.
 */
import type { LocationId } from '../locations/ids.js';
import {
  ProcessingStep,
  type ProcessingLogRepository,
} from '../locations/processing-log.repository.js';
import type { LocationMatchOutcome } from './location-matching.js';

export async function recordMatchTrail(
  processingLog: ProcessingLogRepository,
  locationId: LocationId,
  input: {
    readonly addressLine: string;
    readonly addressHash: string;
    readonly countryHint: string | null;
    readonly outcome: LocationMatchOutcome;
    readonly trigger?: string;
  },
): Promise<void> {
  const subject = { locationId };
  const extra = input.trigger ? { trigger: input.trigger } : {};
  const append = async (step: ProcessingStep, data: Record<string, unknown>) => {
    try {
      await processingLog.append(subject, step, { ...data, ...extra });
    } catch {
      // swallow
    }
  };
  await append(ProcessingStep.Normalized, {
    address_line: input.addressLine,
    address_hash: input.addressHash,
    country_hint: input.countryHint,
  });
  for (const v of input.outcome.verdicts) {
    await append(ProcessingStep.LlmVerified, {
      master_location_id: v.masterLocationId,
      candidate_address: v.candidateAddress,
      outcome: v.outcome,
      match_confirmed: v.matchConfirmed,
      confidence: v.confidence,
      reasoning: v.reasoning,
    });
  }
  const { match } = input.outcome;
  if (match) {
    await append(ProcessingStep.Matched, {
      master_location_id: match.master.id,
      method: match.method,
      confidence: match.confidence,
    });
  } else {
    await append(ProcessingStep.Created, {
      reason: input.outcome.rejectedMasterIds.length > 0 ? 'verifier_rejected' : 'no_match',
      candidates_checked: input.outcome.candidatesChecked,
      rejected_master_location_ids: input.outcome.rejectedMasterIds,
    });
  }
}
