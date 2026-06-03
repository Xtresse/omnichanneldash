// Brand color tokens for SVG / canvas / d3 contexts. Tailwind classes (bg-brown,
// text-ink, …) don't reach raw <svg> fills or d3 scales, so the map needs the
// literal hex values here. These mirror the Tailwind palette defined as CSS
// variables in app/globals.css (the "bright redesign" cream-paper system) so
// the heat map reads as part of the same dashboard. Ported from the sibling
// CRO tracker's lib/brand.ts.

export const brand = {
  paper: "#F7F5F0",        // page background
  paper2: "#F4EEDA",       // soft cream surface
  card: "#FFFFFF",
  ink: "#302C29",          // primary text (also DTC / channel black)
  inksoft: "#6A5F54",      // secondary text
  rule: "#E0DEDB",         // border / rule
  brown: "#E6A403",        // primary brand — orange-gold + B2B
  browndeep: "#C8860D",    // brand deep — section banners, hover
  accent: "#AA2D2D",       // accent — red (ADCS / sale)
  muted: "#8A8076",        // eyebrows, meta
  tan: "#C9B68E",          // hairline accent
  b2b: "#E6A403",          // orange-gold
  dtc: "#302C29",          // black
  adcs: "#AA2D2D",         // red
};

// Heat-map ramp: paper → tan → gold → deep → black. heatRamp[0] is the
// near-empty surface tone; the scale uses heatRamp.slice(1) for actual values.
export const heatRamp = [
  "#F4EEDA",
  "#EBD9B0",
  "#C9B68E",
  "#E6A403",
  "#C8860D",
  "#8A5A0A",
  "#302C29",
];

// Categorical palette — one stable hue per rep on the map. Brand-derived so it
// never strays into the green/teal/blue the brand avoids.
export const seriesPalette = [
  brand.brown,      // orange-gold
  brand.accent,     // red
  brand.ink,        // black
  brand.browndeep,  // deep gold
  brand.tan,        // tan
  brand.muted,      // taupe
  "#7A3A2D",        // burnt sienna
  brand.inksoft,    // soft ink
];
