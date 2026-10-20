import { Type } from '@sinclair/typebox';
import { MASTER_GEOCODE_SOURCES } from '../../../domain/locations/master-location.js';

/**
 * Who produced a master location's coordinates — `PHOTON`, `GOOGLE_MAPS` or
 * `OPERATOR` — and, for cached third-party coordinates, when they must be
 * refreshed or are deleted (Google: 30 days).
 */
export const MasterGeocodeFields = {
  geocodeSource: Type.Union([...MASTER_GEOCODE_SOURCES.map((s) => Type.Literal(s)), Type.Null()]),
  geocodeExpiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
};
