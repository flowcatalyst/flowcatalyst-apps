/**
 * Request log — every API request's input and output, attributed to a client
 * / partition / principal — and the usage report built on it.
 *
 * Infrastructure telemetry, not a domain aggregate: rows are written straight
 * to the repository by the `request-log` plugin after the response is sent
 * (no UnitOfWork, no events), so a request is logged even when its use case
 * failed and its transaction rolled back.
 */

/** Which HTTP surface a request came through: the canonical API or the SPA's BFF. */
export const REQUEST_SURFACES = ['API', 'UI'] as const;
export type RequestSurface = (typeof REQUEST_SURFACES)[number];

export interface NewRequestLogEntry {
  readonly surface: RequestSurface;
  readonly clientId: string | null;
  readonly partitionId: string | null;
  readonly principalId: string | null;
  readonly operation: string;
  readonly method: string;
  readonly route: string;
  readonly url: string;
  readonly statusCode: number;
  readonly durationMs: number;
  readonly requestBody: unknown;
  readonly responseBody: unknown;
}

export interface RequestLogEntry extends NewRequestLogEntry {
  readonly id: string;
  readonly createdAt: Date;
}

export type UsagePeriod = 'month' | 'week' | 'day';

/**
 * Rows a non-admin principal may see: requests in their granted partitions,
 * partition-less requests for clients those partitions belong to, and their
 * own requests. Absent = everything (anchors / admins).
 */
export interface RequestLogVisibility {
  readonly principalId: string;
  readonly partitionIds: readonly string[];
  readonly clientIds: readonly string[];
}

export interface RequestLogFilter {
  readonly visibleTo?: RequestLogVisibility | undefined;
  readonly from: Date;
  /**
   * Exclusive end. Omit for "up to now" — left unbounded rather than set from
   * the app clock, which can trail the database's (row timestamps are DB time).
   */
  readonly to?: Date | undefined;
  readonly clientId?: string | undefined;
  readonly partitionId?: string | undefined;
  readonly operation?: string | undefined;
  readonly surface?: RequestSurface | undefined;
}

export interface UsageQuery extends Omit<RequestLogFilter, 'from'> {
  readonly period: UsagePeriod;
  /** IANA zone the period boundaries are cut in, e.g. `Africa/Johannesburg`. */
  readonly timezone: string;
  /**
   * Window start. Default: the start of the period that began
   * `DEFAULT_USAGE_PERIODS[period] - 1` periods ago, in `timezone` — so the
   * report opens on a whole period, never a partial one.
   */
  readonly from?: Date | undefined;
}

/** Periods in the default usage window, the current one included. */
export const DEFAULT_USAGE_PERIODS: Readonly<Record<UsagePeriod, number>> = {
  month: 12,
  week: 12,
  day: 31,
};

export interface UsageReport {
  readonly from: Date;
  /** The requested end, or the report time when none was given. */
  readonly to: Date;
  readonly rows: readonly UsageRow[];
}

export interface UsageRow {
  /** Start of the period, as a local date (`YYYY-MM-DD`) in the query's timezone. */
  readonly periodStart: string;
  readonly clientId: string | null;
  readonly clientCode: string | null;
  readonly partitionId: string | null;
  readonly partitionCode: string | null;
  readonly operation: string;
  readonly surface: RequestSurface;
  readonly requests: number;
  /** Requests answered with a 4xx or 5xx. */
  readonly errors: number;
}

export interface RequestLogPage {
  readonly entries: readonly Omit<RequestLogEntry, 'requestBody' | 'responseBody'>[];
  readonly total: number;
}

export interface RequestLogRepository {
  record(entry: NewRequestLogEntry): Promise<void>;
  usage(query: UsageQuery): Promise<UsageReport>;
  list(filter: RequestLogFilter & { limit: number; offset: number }): Promise<RequestLogPage>;
  findById(id: string): Promise<RequestLogEntry | null>;
  /** Delete rows created before `cutoff`; returns how many. */
  pruneBefore(cutoff: Date): Promise<number>;
}
