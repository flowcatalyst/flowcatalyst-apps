/**
 * The address_line_hash migration rehashed existing rows in SQL. It is only
 * correct if the SQL tidy + hash produce byte-for-byte what
 * `addressLineHash` (TypeScript) produces for new rows — otherwise a migrated
 * master never exact-matches a new location with the same address. This pins
 * the two together on awkward inputs.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { addressLineHash } from '../../../src/domain/services/address-line.js';
import { getDbFixture } from '../db-fixture.js';

// Kept identical to drizzle/20261019092906_address_line_hash/migration.sql.
function sqlHash(line: string) {
  return sql`SELECT encode(sha256(convert_to((
    SELECT coalesce(string_agg(btrim(s), ', ' ORDER BY ord), '')
    FROM unnest(string_to_array(regexp_replace(lower(${line}::text), '\\s+', ' ', 'g'), ','))
      WITH ORDINALITY AS u(s, ord)
    WHERE btrim(s) <> ''
  ), 'UTF8')), 'hex') AS h`;
}

describe('address_line_hash migration — SQL/TypeScript parity', () => {
  let db: Awaited<ReturnType<typeof getDbFixture>>['db'];

  beforeAll(async () => {
    db = (await getDbFixture()).db;
  });

  it.each([
    '548 Market Street, San Francisco, US',
    '  16  Curvy Road ,Blairgowrie,,  Randburg\t2194 , ZA , ',
    'Ünit 4, 12 BREE St, Cape Town',
    ',,leading, trailing,,',
    'Kerkstraat 12,\n Stellenbosch',
    'single',
    '',
  ])('hashes %j identically', async (line) => {
    const [row] = await db.execute(sqlHash(line));
    expect(row?.['h']).toBe(addressLineHash(line));
  });
});
