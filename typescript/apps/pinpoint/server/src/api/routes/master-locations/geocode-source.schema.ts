import { Type } from '@sinclair/typebox';
import {
  MASTER_GEOCODE_SOURCES,
  MASTER_ORIGINS,
  type MasterLocation,
} from '../../../domain/locations/master-location.js';

/**
 * Where a master location came from and who produced its coordinates. Masters
 * are our own reference data: sources are PHOTON / OPERATOR / DELIVERY_CAPTURE,
 * never a third party.
 */
export const MasterGeocodeFields = {
  name: Type.Union([Type.String(), Type.Null()]),
  geocodeSource: Type.Union([...MASTER_GEOCODE_SOURCES.map((s) => Type.Literal(s)), Type.Null()]),
  /** LOCATION_APPROVAL | DELIVERY_CAPTURE | MIGRATED. */
  origin: Type.Union(MASTER_ORIGINS.map((o) => Type.Literal(o))),
  /** The approved location it was created from. */
  originLocationId: Type.Union([Type.String(), Type.Null()]),
  /** GPS accuracy of the delivery capture, in metres. */
  captureAccuracyM: Type.Union([Type.Number(), Type.Null()]),
  capturedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
};

export function masterGeocodeFields(master: MasterLocation) {
  return {
    name: master.name,
    geocodeSource: master.geocodeSource,
    origin: master.origin,
    originLocationId: master.originLocationId,
    captureAccuracyM: master.captureAccuracyM,
    capturedAt: master.capturedAt?.toISOString() ?? null,
  };
}
