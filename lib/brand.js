// Brand color tokens for SVG / canvas / d3 contexts. Tailwind classes (bg-brown,
// text-ink, …) don't reach raw <svg> fills or d3 scales, so the map needs the
// literal hex values here. These mirror the CEO-approved orange/black palette
// defined as CSS variables in app/globals.css (the cream paper-and-ink system)
// so the heat map reads as part of the same dashboard. No green/teal and no
// muddy gold/amber, per the rebrand directive (good=orange, bad=maroon,
// neutral=gray).

export const brand = {
  paper: "#F5F1EA",        // page background
  paper2: "#FAF7F2",       // soft cream surface
  card: "#FFFFFF",
  ink: "#2B1A10",          // primary text (also DTC / channel black)
  inksoft: "#5A4232",      // secondary text
  rule: "#D4D0C8",         // border / rule
  brown: "#F0922E",        // primary brand — orange + B2B
  browndeep: "#241712",    // espresso — section banners, hover
  accent: "#D8761B",       // deeper orange — accent text on cream
  maroon: "#5C2F2E",       // unfavorable / "bad"
  muted: "#8A7359",        // eyebrows, meta
  tan: "#A89478",          // hairline accent
  b2b: "#F0922E",          // orange
  dtc: "#2B1A10",          // black
  adcs: "#A85F28",         // warm orange-brown
};

// Heat-map ramp: cream -> orange -> deep orange -> espresso/black. heatRamp[0]
// is the near-empty surface tone; the scale uses heatRamp.slice(1) for actual
// values. Pure orange progression — no gold/amber.
export const heatRamp = [
  "#FAF7F2",
  "#FBD9B3",
  "#F7B36B",
  "#F0922E",
  "#D8761B",
  "#A85F28",
  "#2B1A10",
];

// Categorical palette — one stable hue per rep on the map. Brand-derived so it
// never strays into the green/teal/blue the brand avoids.
export const seriesPalette = [
  brand.brown,      // orange
  brand.maroon,     // maroon
  brand.ink,        // black
  brand.accent,     // deeper orange
  brand.adcs,       // orange-brown
  brand.muted,      // taupe
  "#7A3A2D",        // burnt sienna
  brand.inksoft,    // soft ink
];
