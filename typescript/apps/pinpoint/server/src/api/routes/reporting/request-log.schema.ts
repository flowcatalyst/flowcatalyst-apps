import { Type } from '@sinclair/typebox';
import type { RequestLogEntry } from '../../../domain/reporting/request-log.repository.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);

/** `API` (canonical API) or `UI` (the SPA, through the BFF). */
export const RequestSurfaceSchema = Type.Union([Type.Literal('API'), Type.Literal('UI')]);

export const RequestLogSummarySchema = Type.Object({
  id: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  clientId: NullableString,
  partitionId: NullableString,
  principalId: NullableString,
  surface: RequestSurfaceSchema,
  operation: Type.String(),
  method: Type.String(),
  route: Type.String(),
  url: Type.String(),
  statusCode: Type.Integer(),
  durationMs: Type.Integer(),
});

export function toSummary(entry: Omit<RequestLogEntry, 'requestBody' | 'responseBody'>) {
  return {
    id: entry.id,
    createdAt: entry.createdAt.toISOString(),
    clientId: entry.clientId,
    partitionId: entry.partitionId,
    principalId: entry.principalId,
    surface: entry.surface,
    operation: entry.operation,
    method: entry.method,
    route: entry.route,
    url: entry.url,
    statusCode: entry.statusCode,
    durationMs: entry.durationMs,
  };
}
