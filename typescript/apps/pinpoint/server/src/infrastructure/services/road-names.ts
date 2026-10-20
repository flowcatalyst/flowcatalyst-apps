/**
 * Road-name comparison shared by the geocoders: does a result sit on the road
 * the caller asked for? Abbreviations and Afrikaans types are canonicalised
 * (`Rd` = `Road`, `Straat` = `Street`); different types are different roads
 * (`Main Road` ≠ `Main Crescent`).
 */

/** Abbreviations and Afrikaans equivalents → one canonical road-type word. */
const ROAD_ABBREVIATIONS: Readonly<Record<string, string>> = {
  rd: 'road',
  st: 'street',
  str: 'street',
  ave: 'avenue',
  av: 'avenue',
  dr: 'drive',
  ln: 'lane',
  cres: 'crescent',
  cl: 'close',
  pl: 'place',
  blvd: 'boulevard',
  ct: 'court',
  hwy: 'highway',
  sq: 'square',
  tce: 'terrace',
  straat: 'street',
  weg: 'road',
  laan: 'avenue',
  rylaan: 'avenue',
};

const ROAD_TYPES = new Set([
  ...Object.values(ROAD_ABBREVIATIONS),
  'way',
  'circle',
  'parade',
  'grove',
  'rise',
]);

/** Lowercased word tokens with road-type abbreviations and synonyms canonicalised. */
function roadTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((t) => ROAD_ABBREVIATIONS[t] ?? t);
}

/**
 * The identifying words of a road name: type words ("Road", "Ave") and bare
 * numbers dropped, so `Curvy Rd`, `Curvy Road` and `16 Curvy` all reduce to
 * `curvy`.
 */
export function roadCore(road: string | null | undefined): string[] {
  if (!road) return [];
  return roadTokens(road).filter((t) => !ROAD_TYPES.has(t) && !/^\d+$/.test(t));
}

function roadTypes(road: string | null | undefined): string[] {
  if (!road) return [];
  return roadTokens(road).filter((t) => ROAD_TYPES.has(t));
}

/**
 * Same identifying words, and — when both names carry a type — the same type:
 * `Main Rd` = `Main Road` and `Kerk Straat` = `Kerk Street`, but `Main Road` ≠
 * `Main Crescent`. A request with no type word (`16 Curvy`) accepts any type.
 */
export function sameRoad(requested: string, candidate: string | null): boolean {
  const want = roadCore(requested);
  const core = roadCore(candidate);
  if (core.length !== want.length || !core.every((t, i) => t === want[i])) return false;
  const wantTypes = roadTypes(requested);
  const types = roadTypes(candidate);
  if (wantTypes.length === 0 || types.length === 0) return true;
  return wantTypes.length === types.length && wantTypes.every((t, i) => t === types[i]);
}

/**
 * Whether a candidate's road name appears, as a contiguous phrase, inside one
 * comma segment of the free-text line. Type words are kept here (unlike
 * `sameRoad`): with no parse to say which segment is the road, `Blairgowrie
 * Drive` must not match a line that only names the suburb Blairgowrie.
 */
export function roadInLine(road: string | null, line: string): boolean {
  if (!road) return false;
  const needle = roadTokens(road);
  if (needle.length === 0) return false;
  return line.split(',').some((segment) => {
    const hay = roadTokens(segment);
    for (let i = 0; i + needle.length <= hay.length; i++) {
      if (needle.every((t, j) => hay[i + j] === t)) return true;
    }
    return false;
  });
}
