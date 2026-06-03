// Server-side geocoder for the ZIP heat map.
//
// Omnichannel orders carry a ship-to city / state / ZIP string but NO lat/lng
// (the sibling CRO tracker got exact coordinates straight from Shopify via
// Windsor; this app's pull doesn't request them). So we resolve coordinates
// here, on the server, and attach them to each order — that keeps the client
// <ZipHeatMap> component a faithful port (it just reads o.shipLat / o.shipLng)
// AND keeps the ~900KB ZIP table out of the browser bundle entirely; only the
// 49KB major-cities file ships to the client, for the whitespace layer.
//
// Resolution order per order:
//   1. 5-digit ZIP centroid  (data/us-zips.json, 33k ZIPs — near-complete)
//   2. city + state centroid (data/us-cities-major.json, pop ≥ 50k metros)
//   3. null  → the order is dropped from the map (counted as "off-map hidden")
//
// Both JSON files are imported (not fs-read) so they're bundled into the
// serverless function and parsed once at module load.

import zips from "@/data/us-zips.json";
import cities from "@/data/us-cities-major.json";

// Full state / territory name → USPS abbreviation. Shopify's `province` field
// is the full name ("California"); `provinceCode` is "CA". The omni order shape
// surfaces whichever the source gave us, so we accept both.
const STATE_NAME_TO_ABBR = {
  "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
  "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
  "district of columbia": "DC", "florida": "FL", "georgia": "GA", "hawaii": "HI",
  "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
  "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
  "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
  "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
  "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", "tennessee": "TN", "texas": "TX",
  "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
  "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
  "puerto rico": "PR",
};

const VALID_ABBR = new Set(Object.values(STATE_NAME_TO_ABBR));

/** Normalize a raw ship-state string (full name OR code) → USPS abbrev, or "". */
export function normalizeState(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  if (s.length === 2 && VALID_ABBR.has(s.toUpperCase())) return s.toUpperCase();
  return STATE_NAME_TO_ABBR[s.toLowerCase()] || "";
}

// city|ST → [lat, lng], built once for the metro fallback.
const CITY_INDEX = new Map();
for (const c of cities) {
  CITY_INDEX.set(`${c.c.toLowerCase()}|${c.s}`, [c.lat, c.lng]);
}

/**
 * Resolve a ship-to to a coordinate. Returns { lat, lng, abbr } or null.
 * `abbr` is the normalized 2-letter state so the map can filter by state.
 */
export function geocode({ zip, city, state }) {
  const abbr = normalizeState(state);

  // 1. ZIP centroid (most precise, near-complete coverage).
  if (zip) {
    const z5 = String(zip).trim().slice(0, 5);
    const hit = zips[z5];
    if (hit) return { lat: hit[0], lng: hit[1], abbr };
  }

  // 2. Major-city centroid (metros only).
  if (city && abbr) {
    const hit = CITY_INDEX.get(`${String(city).trim().toLowerCase()}|${abbr}`);
    if (hit) return { lat: hit[0], lng: hit[1], abbr };
  }

  return null;
}
