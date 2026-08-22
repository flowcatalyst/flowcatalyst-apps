/**
 * Every `$id` schema that routes reference via `$ref`. `server.ts` registers
 * each with `server.addSchema`, which (a) lets Fastify resolve the refs for
 * validation + serialization and (b) emits them as `components.schemas.<$id>`
 * in the OpenAPI document.
 *
 * Add a schema here when two or more operations share it. Keep dependencies
 * before dependents (e.g. a property-set schema before the layer that embeds
 * it) — Fastify resolves refs lazily, but the ordering keeps the generated
 * component list readable.
 */
import type { TSchema } from '@sinclair/typebox';
import { ErrorResponseSchema } from './error-response.schema.js';
import { BffClientSchema } from '../routes/bff/clients/client.schema.js';
import { BffPartitionSchema } from '../routes/bff/partitions/partition.schema.js';
import {
  BffLayerDetailResponseSchema,
  BffLayerPropertySetSchema,
} from '../routes/bff/layers/layer-response.schema.js';
import {
  BffLayerFeatureInputSchema,
  BffLayerFeatureSchema,
} from '../routes/bff/layer-features/layer-feature.schema.js';
import { BffFeatureAssociationSchema } from '../routes/bff/locations/feature-association.schema.js';
import { BffLocationSummarySchema } from '../routes/bff/locations/location.schema.js';
import { BffMasterLocationSchema } from '../routes/bff/master-locations/master-location.schema.js';
import { MatchingConfigSchema } from '../routes/matching-config/matching-config.schema.js';
import {
  RematchLocationBodySchema,
  RematchLocationResponseSchema,
} from '../routes/locations/rematch-location.schema.js';

export const SHARED_SCHEMAS: readonly TSchema[] = [
  ErrorResponseSchema,
  BffClientSchema,
  BffPartitionSchema,
  BffLayerPropertySetSchema,
  BffLayerDetailResponseSchema,
  BffLayerFeatureSchema,
  BffLayerFeatureInputSchema,
  BffFeatureAssociationSchema,
  BffLocationSummarySchema,
  BffMasterLocationSchema,
  MatchingConfigSchema,
  RematchLocationBodySchema,
  RematchLocationResponseSchema,
];
