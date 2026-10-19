/**
 * Period helpers for the usage page. The server reports each bucket by its
 * local start date (`YYYY-MM-DD`, cut in the report's timezone); these fill the
 * empty periods in between so the chart's time axis is continuous, and label
 * them. Dates are handled as plain calendar dates (UTC arithmetic on
 * `YYYY-MM-DD`), never as instants, so no timezone can shift a bucket.
 */

export type UsagePeriod = 'month' | 'week' | 'day';

function parse(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The local calendar date of an instant in `timeZone`, as `YYYY-MM-DD`. */
export function localDate(instant: Date, timeZone: string): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Start of the period containing `date` (months on the 1st, ISO weeks on Monday). */
export function periodStartOf(date: string, period: UsagePeriod): string {
  const d = parse(date);
  if (period === 'month') return format(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
  if (period === 'week') {
    const back = (d.getUTCDay() + 6) % 7; // Monday = 0
    return format(new Date(d.getTime() - back * 86_400_000));
  }
  return date;
}

function next(date: string, period: UsagePeriod): string {
  const d = parse(date);
  if (period === 'month')
    return format(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
  return format(new Date(d.getTime() + (period === 'week' ? 7 : 1) * 86_400_000));
}

/** Every period start from the one containing `from` to the one containing `to`. */
export function periodRange(from: string, to: string, period: UsagePeriod): string[] {
  const out: string[] = [];
  const last = periodStartOf(to, period);
  for (let p = periodStartOf(from, period); p <= last && out.length < 1000; p = next(p, period)) {
    out.push(p);
  }
  return out;
}

const MONTH = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const DAY = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });

/** Short axis label: "Mar 2026" for a month, "23 Feb" for a week or day. */
export function periodLabel(start: string, period: UsagePeriod): string {
  return period === 'month' ? MONTH.format(parse(start)) : DAY.format(parse(start));
}

/** Long label for tooltips and tables: "Week of 23 Feb 2026", "02 Mar 2026". */
export function periodTitle(start: string, period: UsagePeriod): string {
  const full = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parse(start));
  if (period === 'month') return MONTH.format(parse(start));
  return period === 'week' ? `Week of ${full}` : full;
}

/** The instant a period ends (exclusive), as the local date after it — for drill-down filters. */
export function periodEnd(start: string, period: UsagePeriod): string {
  return next(start, period);
}

/** The calendar date after `date`. */
export function addDay(date: string): string {
  return format(new Date(parse(date).getTime() + 86_400_000));
}

/** The instant of midnight at the start of calendar `date` in `timeZone`. */
export function zonedMidnight(date: string, timeZone: string): Date {
  const guess = parse(date).getTime();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(guess));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  // What wall-clock time `guess` shows in the zone, read back as if UTC: the
  // difference is the zone's offset at that moment.
  const shown = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return new Date(guess - (shown - guess));
}
