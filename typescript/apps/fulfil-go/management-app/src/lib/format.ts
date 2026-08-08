/**
 * Shared display formatting. Every grid/panel shows timestamps the same way
 * (en-ZA short date + short time) — use this instead of a per-page `fmt()`.
 */
export function fmtDateTime(iso: string | null | undefined): string {
  return iso
    ? new Date(iso).toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
}
