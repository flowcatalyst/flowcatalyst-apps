import { Type } from '@sinclair/typebox';
import type { RequestLogEntry } from '../../../domain/reporting/request-log.repository.js';

const NullableString = Type.Union([Type.String(), Type.Null()]);

export const RequestLogSummarySchema = Type.Object({
  id: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  clientId: NullableString,
  partitionId: NullableString,
  principalId: NullableString,
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
    operation: entry.operation,
    method: entry.method,
    route: entry.route,
    url: entry.url,
    statusCode: entry.statusCode,
    durationMs: entry.durationMs,
  };
}
