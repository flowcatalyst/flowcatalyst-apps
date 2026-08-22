/**
 * Build a case-insensitive "contains" pattern for Postgres ILIKE from free
 * text. Escapes the LIKE metacharacters (`\`, `%`, `_`) so user input is
 * matched literally; the default ILIKE escape character is `\`.
 */
export function containsPattern(search: string): string {
  const escaped = search.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `%${escaped}%`;
}
