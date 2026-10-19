-- Matching moved off libpostal (2026-10-19): the tidied address line is now
-- the matching key, and address_hash is SHA-256 over that line instead of over
-- parsed components. Rehash existing rows with the exact rules of
-- domain/services/address-line.ts → tidyAddressLine: lowercase, collapse
-- whitespace, trim each comma segment, drop empty segments, join with ', '.
--
-- Masters hash their normalized_address_line (what toAddressLine built when
-- they were parsed); locations hash their match_address (what create-location
-- now hashes). Idempotent.

UPDATE "master_locations" AS m
SET "address_hash" = encode(sha256(convert_to(t.line, 'UTF8')), 'hex')
FROM (
  SELECT "id", (
    SELECT coalesce(string_agg(btrim(s), ', ' ORDER BY ord), '')
    FROM unnest(string_to_array(regexp_replace(lower("normalized_address_line"), '\s+', ' ', 'g'), ','))
      WITH ORDINALITY AS u(s, ord)
    WHERE btrim(s) <> ''
  ) AS line
  FROM "master_locations"
  WHERE "normalized_address_line" IS NOT NULL
) AS t
WHERE m."id" = t."id";--> statement-breakpoint

UPDATE "locations" AS l
SET "address_hash" = encode(sha256(convert_to(t.line, 'UTF8')), 'hex')
FROM (
  SELECT "id", (
    SELECT coalesce(string_agg(btrim(s), ', ' ORDER BY ord), '')
    FROM unnest(string_to_array(regexp_replace(lower("match_address"), '\s+', ' ', 'g'), ','))
      WITH ORDINALITY AS u(s, ord)
    WHERE btrim(s) <> ''
  ) AS line
  FROM "locations"
) AS t
WHERE l."id" = t."id";--> statement-breakpoint

-- overall_threshold is now the minimum decision-model confidence for a match.
-- 0.85 was tuned for the retired component scorer; only move the global
-- default if it was never changed.
UPDATE "matching_configs"
SET "overall_threshold" = 0.6
WHERE "id" = 'mcf_GLOBAL_DEFAULT' AND "overall_threshold" = 0.85;
