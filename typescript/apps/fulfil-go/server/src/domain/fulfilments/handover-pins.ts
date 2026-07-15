import { randomInt } from 'node:crypto';
import { handoverDeliveryProof } from '@fulfil-go/shared';
import type { Destination, FulfilmentLine, HandoverPolicy } from '@fulfil-go/shared';

/**
 * Handover PIN generation (docs/handover-verification.md). Pins are one-shot
 * handover codes, not credentials: stored plaintext on the aggregate (they
 * must be retrievable for the audited reveal and provider pushes) and
 * verified SERVER-SIDE only — they never ride events or the driver app.
 */
export const HANDOVER_PIN_LENGTH = 4;

export function generateHandoverPin(): string {
  return randomInt(0, 10 ** HANDOVER_PIN_LENGTH)
    .toString()
    .padStart(HANDOVER_PIN_LENGTH, '0');
}

/**
 * Delivery pin per the stamped policy. 'phone-last4' uses the destination
 * contact phone's last 4 digits and FALLS BACK to random — phone is optional
 * on captured locations. Collect-type fulfilments get one too (it is the
 * collection-point handover code).
 */
export function resolveDeliveryPin(policy: HandoverPolicy, destination: Destination): string | null {
  // A pin exists only when the proof MODE is 'pin' (picture/none skip it).
  if (handoverDeliveryProof(policy) !== 'pin') return null;
  if (policy.deliveryPinSource === 'phone-last4') {
    const digits = (destination.location.contact?.phone ?? '').replace(/\D/g, '');
    if (digits.length >= HANDOVER_PIN_LENGTH) return digits.slice(-HANDOVER_PIN_LENGTH);
  }
  return generateHandoverPin();
}

/**
 * The fulfilment's age restriction: the HIGHEST restrictedMinAge across all
 * lines (Andrew: "the highest age product"), null when nothing is restricted.
 * Computed once at creation — lines are immutable.
 */
export function computeMaxRestrictedAge(
  parts: readonly { readonly lines: readonly FulfilmentLine[] }[],
): number | null {
  let max: number | null = null;
  for (const part of parts) {
    for (const line of part.lines) {
      if (line.restrictedMinAge !== undefined && (max === null || line.restrictedMinAge > max)) {
        max = line.restrictedMinAge;
      }
    }
  }
  return max;
}
