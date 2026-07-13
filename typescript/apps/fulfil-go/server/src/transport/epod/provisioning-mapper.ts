import type { Destination } from '@fulfil-go/shared';
import type { Fulfilment, FulfilmentPart } from '../../domain/fulfilments/fulfilment.js';
import type { EpodLocationUpsert, EpodProductUpsert } from './types.js';

/**
 * Pure mapping from captured fulfilment data onto the EPOD upsert wire
 * shapes (docs/epod-integration-notes.md). Origin locations need NO
 * provisioning — the part's `origin.ref` IS the EPOD location reference
 * (depots/territories are maintained by hand on their side). We provision
 * only the DELIVERY DESTINATION and the PRODUCTS the parts carry.
 */

/** Deterministic destination reference: upstream ref wins, else a fulfilment-keyed one. */
export function epodDestinationReference(destination: Destination, fulfilmentId: string): string {
  return destination.location.ref ?? `fulfilgo-dest-${fulfilmentId}`;
}

/**
 * Build the ONE destination-location upsert for a delivery fulfilment.
 * Returns null for collect fulfilments (the collection point is store-side
 * topology, not a drop) and for destinations without coordinates — EPOD
 * locations require latitude/longitude, so the caller logs and skips.
 */
export function toEpodDestinationLocation(
  fulfilment: Pick<Fulfilment, 'id' | 'type' | 'destination'>,
): EpodLocationUpsert | null {
  if (fulfilment.type !== 'delivery') return null;
  const location = fulfilment.destination.location;
  if (!location.geo) return null;

  const reference = epodDestinationReference(fulfilment.destination, fulfilment.id);
  const contact = location.contact;
  const contactString = contact?.phone ?? contact?.name;
  return {
    reference,
    name: location.name ?? contact?.name ?? location.address.line1 ?? reference,
    ...(location.address.line1 !== undefined ? { address_1: location.address.line1 } : {}),
    ...(location.address.city !== undefined ? { city: location.address.city } : {}),
    ...(location.address.region !== undefined ? { province: location.address.region } : {}),
    ...(location.address.postalCode !== undefined
      ? { postal_code: location.address.postalCode }
      : {}),
    latitude: location.geo.lat,
    longitude: location.geo.lng,
    ...(contactString !== undefined ? { contact: contactString } : {}),
    ...(contact?.email !== undefined ? { email_address: contact.email } : {}),
  };
}

/** Product upserts from ALL parts' lines — reference = sku, deduped (first description wins). */
export function toEpodProducts(
  parts: readonly Pick<FulfilmentPart, 'lines'>[],
): EpodProductUpsert[] {
  const bySku = new Map<string, EpodProductUpsert>();
  for (const part of parts) {
    for (const line of part.lines) {
      if (!bySku.has(line.sku)) {
        bySku.set(line.sku, { reference: line.sku, name: line.description });
      }
    }
  }
  return [...bySku.values()];
}
