/**
 * Country reference data. Used by address resolution and (in Slice 5)
 * spatial lookup via PostGIS geometries. ISO codes follow ISO 3166-1.
 */
export interface Country {
  readonly id: number;
  readonly name: string;
  readonly isoA2: string;
  readonly isoA3: string;
}
