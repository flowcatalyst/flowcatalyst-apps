import { type Static, Type } from '@sinclair/typebox';

/**
 * Shape posted by the Transistorsoft background-geolocation NATIVE HTTP
 * uploader (the plugin posts these from native code with the WebView
 * suspended — JS never touches them). Root property is `location`, holding a
 * single location or an array when `batchSync: true`.
 *
 * Field set verified against plugin docs at integration time; unknown fields
 * are tolerated (`additionalProperties: true`) so a plugin upgrade can't
 * break ingest — we persist the full element into `raw` regardless.
 */
const CoordsSchema = Type.Object(
  {
    latitude: Type.Number(),
    longitude: Type.Number(),
    accuracy: Type.Optional(Type.Number()),
    speed: Type.Optional(Type.Number()),
    heading: Type.Optional(Type.Number()),
    altitude: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
);

export const TelemetryLocationSchema = Type.Object(
  {
    uuid: Type.String(),
    timestamp: Type.String({ format: 'date-time' }),
    coords: CoordsSchema,
    is_moving: Type.Optional(Type.Boolean()),
    odometer: Type.Optional(Type.Number()),
    event: Type.Optional(Type.String()),
    activity: Type.Optional(
      Type.Object(
        {
          type: Type.Optional(Type.String()),
          confidence: Type.Optional(Type.Number()),
        },
        { additionalProperties: true },
      ),
    ),
    battery: Type.Optional(
      Type.Object(
        {
          level: Type.Optional(Type.Number()),
          is_charging: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: true },
      ),
    ),
    extras: Type.Optional(Type.Record(Type.String(), Type.Any())),
  },
  // No $id: this schema appears twice inside TelemetryBatchSchema (single +
  // array union) and ajv rejects duplicate inline $ids within one route.
  { additionalProperties: true },
);
export type TelemetryLocation = Static<typeof TelemetryLocationSchema>;

export const TelemetryBatchSchema = Type.Object(
  {
    location: Type.Union([TelemetryLocationSchema, Type.Array(TelemetryLocationSchema)]),
  },
  { additionalProperties: true },
);
export type TelemetryBatch = Static<typeof TelemetryBatchSchema>;
