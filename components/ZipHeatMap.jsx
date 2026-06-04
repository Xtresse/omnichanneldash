"use client";

import { Component, useMemo, useState, useCallback } from "react";
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from "react-simple-maps";
import { geoCentroid, geoBounds, geoAlbersUsa } from "d3-geo";
import { feature } from "topojson-client";
import { scaleQuantile } from "d3-scale";
import { brand, heatRamp, seriesPalette } from "@/lib/brand";
// Bundle the US base map WITH the app rather than fetching it from a CDN at
// runtime. That runtime fetch was a single point of failure that left the map
// blank on some networks (corporate firewall, CDN hiccup, offline). The file is
// ~115KB and only loads inside this dynamically-imported, ssr:false component,
// so it doesn't bloat the initial bundle.
import statesTopo from "us-atlas/states-10m.json";

// Omni orders already carry rep *names* (not ids), so the CRO tracker's
// repName(id) lookup collapses to identity here.
const repName = (r) => r || "—";

const fmtMoney = (n) =>
  n == null || isNaN(n)
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const fmtNum = (n) => (n == null || isNaN(n) ? "—" : new Intl.NumberFormat("en-US").format(n));

const COLOR_MODES = [
  { k: "rep", label: "Owning rep" },
  { k: "net", label: "Net sales" },
  { k: "orders", label: "Order count" },
  { k: "new", label: "New accounts" },
];

// A B2B "market" (ZIP) with this many orders or fewer counts as nascent / thin
// — somewhere we've barely landed and could grow. Tunable one-liner.
const MINIMAL_ORDERS = 3;

// FIPS (2-digit state code carried on the us-atlas geographies) → USPS abbrev.
// Lets a clicked state polygon be matched back to the ship-state on orders so
// the zoom view can filter ZIPs / cities to that state.
const FIPS_TO_STATE = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
  "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY",
};

// ComposableMap viewBox. react-simple-maps builds its projection as
// geoAlbersUsa().translate([width/2, height/2]) (see its makeProjection), so we
// MUST mirror those exact dimensions below or the off-map test misfires.
const MAP_W = 975;
const MAP_H = 610;

const NATIONAL_VIEW = { coordinates: [-97, 38], zoom: 1 };

// react-simple-maps' <Marker> destructures `projection(coords)` with no null
// guard, and geoAlbersUsa returns null for any point it can't place on the US
// map — an international ship-to, or a mis-geocoded order at 0,0 / in the
// ocean. A single such order in the selected date range would throw inside
// _slicedToArray(null) and crash the whole map ("client-side exception").
//
// We pre-filter ZIPs through geoAlbersUsa and drop the null ones — BUT the
// Alaska/Hawaii inset clip-rectangles are positioned relative to `translate`,
// so a projection with a different translate disagrees about which offshore
// points are null. The d3 DEFAULT translate is [480,250] while the map uses
// translate([MAP_W/2, MAP_H/2]); a "Last month" order near an inset boundary
// could pass a default-translate guard yet still project to null at render and
// crash. Configure the guard IDENTICALLY to the map so the two agree.
const usProjection = geoAlbersUsa().translate([MAP_W / 2, MAP_H / 2]);
const projectsOnMap = (lng, lat) => usProjection([lng, lat]) != null;

// Pre-compute each state's GeoJSON feature so the dropdown / a blob click can
// zoom to it without waiting for <Geographies> to hand us the rendered geos.
const STATE_FEATURES = (() => {
  try {
    return feature(statesTopo, statesTopo.objects.states).features;
  } catch {
    return [];
  }
})();
const STATE_GEO = new Map();
for (const f of STATE_FEATURES) {
  const abbr = FIPS_TO_STATE[String(f.id).padStart(2, "0")];
  if (abbr) STATE_GEO.set(abbr, f);
}
const STATE_OPTIONS = [...STATE_GEO.keys()].sort();

// Opportunity-view colors, drawn from the CEO orange/black palette
// (good/target = orange, covered/neutral = gray). No gold/amber.
const OPEN_FILL = heatRamp[1];      // light orange — a state with NO sales
const COVERED_FILL = "#ECE6DB";     // muted cream-gray — a state already covered

/**
 * ZIP-level B2B heat map with two views:
 *
 *  SALES (default) — density-glow heat cloud of where B2B sales ARE. Each ZIP is
 *    a soft radial-gradient blob through a Gaussian blur; "Owning rep" gives each
 *    rep their own hue, the metric modes shade along the brand heat ramp. A
 *    Density/Points toggle switches render styles.
 *
 *  OPPORTUNITY — the inverse: where to expand. States with NO B2B sales light up
 *    orange (covered states fade to gray); every major city (pop ≥ 50k) with no
 *    sales drops an orange whitespace dot; and existing markets are filtered down
 *    to the THIN ones (≤ MINIMAL_ORDERS orders) so the eye lands on nascent
 *    territory instead of where we already win.
 *
 *  Either way, drill into a state via the "Jump to" dropdown, a polygon click, or
 *  a blob click. ADCS + DTC are excluded upstream — this map is B2B only.
 */
function ZipHeatMapInner({ orders }) {
  const [colorBy, setColorBy] = useState("rep");
  const [style, setStyle] = useState("heat");
  const [view, setView] = useState("sales"); // "sales" | "opportunity"
  const [hover, setHover] = useState(null);
  const [position, setPosition] = useState(NATIONAL_VIEW);
  const [focus, setFocus] = useState(null);
  const [countiesTopo, setCountiesTopo] = useState(null);
  const [cities, setCities] = useState(null);

  const opportunity = view === "opportunity";

  const { zips, offMap } = useMemo(() => {
    const m = new Map();
    for (const o of orders) {
      if (o.shipLat == null || o.shipLng == null || !isFinite(o.shipLat) || !isFinite(o.shipLng)) continue;
      const key = o.shipZip || `${o.shipLat.toFixed(3)},${o.shipLng.toFixed(3)}`;
      let z = m.get(key);
      if (!z) {
        z = {
          zip: o.shipZip || "—",
          lat: 0, lng: 0, orderCount: 0, netSales: 0, newAccounts: 0,
          repNet: new Map(), dominantRep: "",
          city: o.shipCity || "", state: o.shipState || "",
        };
        m.set(key, z);
      }
      z.orderCount += 1;
      z.netSales += o.net;
      if (o.isFirstOrder) z.newAccounts += 1;
      z.lat += o.shipLat;
      z.lng += o.shipLng;
      if (o.rep) z.repNet.set(o.rep, (z.repNet.get(o.rep) ?? 0) + o.net);
    }
    for (const z of m.values()) {
      z.lat /= z.orderCount;
      z.lng /= z.orderCount;
      let best = "", bv = -Infinity;
      for (const [r, v] of z.repNet) if (v > bv) { bv = v; best = r; }
      z.dominantRep = best;
    }
    // Drop any ZIP that doesn't land on the US map (see usProjection note) so a
    // stray international / mis-geocoded order can't crash the <Marker> layer.
    const all = Array.from(m.values());
    const list = all.filter((zp) => projectsOnMap(zp.lng, zp.lat));
    return { zips: list, offMap: all.length - list.length };
  }, [orders]);

  // States we have ANY B2B sales in — drives the Opportunity state shading.
  const statesWithSales = useMemo(() => {
    const s = new Set();
    for (const z of zips) if (z.state) s.add(z.state);
    return s;
  }, [zips]);

  // Stable categorical color per rep (sorted for determinism).
  const repColors = useMemo(() => {
    const ids = [...new Set(zips.map((z) => z.dominantRep).filter(Boolean))].sort();
    const m = new Map();
    ids.forEach((id, i) => m.set(id, seriesPalette[i % seriesPalette.length]));
    return m;
  }, [zips]);

  const metricOf = useCallback(
    (z) =>
      colorBy === "net" ? z.netSales : colorBy === "orders" ? z.orderCount : colorBy === "new" ? z.newAccounts : 0,
    [colorBy],
  );

  const colorScale = useMemo(() => {
    const vals = zips.map(metricOf).filter((v) => v > 0);
    return scaleQuantile().domain(vals.length ? vals : [0, 1]).range(heatRamp.slice(1));
  }, [zips, metricOf]);

  const colorFor = useCallback(
    (z) => {
      if (colorBy === "rep") return z.dominantRep ? repColors.get(z.dominantRep) ?? brand.muted : brand.muted;
      const v = metricOf(z);
      return v > 0 ? colorScale(v) : brand.tan;
    },
    [colorBy, repColors, metricOf, colorScale],
  );

  // Register every distinct fill so we can emit one soft radial gradient per
  // color (center → transparent) for the density glow.
  const gradients = useMemo(() => {
    const map = new Map();
    zips.forEach((z) => {
      const c = colorFor(z);
      if (!map.has(c)) map.set(c, `hg${map.size}`);
    });
    return map;
  }, [zips, colorFor]);

  // Marker / blur sizes are in map units, which ZoomableGroup scales with the
  // zoom factor — divide by zoom so the glow stays a constant screen size as
  // you fly in.
  const z = position.zoom;
  const heatRadius = (a) => Math.max(8, Math.min(34, 9 + Math.sqrt(a.orderCount) * 6)) / z;
  const dotRadius = (a) => Math.max(2.5, Math.min(15, Math.sqrt(a.orderCount) * 2.2)) / z;

  // Render larger markers first so small ones sit on top (clickable).
  const sorted = useMemo(() => [...zips].sort((a, b) => b.orderCount - a.orderCount), [zips]);

  // The markets actually drawn: everything in Sales view, only the thin/nascent
  // ones (≤ MINIMAL_ORDERS) in Opportunity view.
  const visibleMarkets = useMemo(
    () => (opportunity ? sorted.filter((a) => a.orderCount <= MINIMAL_ORDERS) : sorted),
    [opportunity, sorted],
  );

  const repsPresent = useMemo(
    () => [...repColors.keys()].sort((a, b) => repName(a).localeCompare(repName(b))),
    [repColors],
  );

  // Top cities inside the focused state — labelled when zoomed in.
  const focusCities = useMemo(() => {
    if (!focus) return [];
    const m = new Map();
    for (const a of zips) {
      if (a.state !== focus.abbr || !a.city) continue;
      const key = a.city.toLowerCase();
      let c = m.get(key);
      if (!c) { c = { city: a.city, state: a.state, lat: 0, lng: 0, orderCount: 0, netSales: 0 }; m.set(key, c); }
      // Weight the label position toward higher-volume ZIPs in the city.
      c.lat += a.lat * a.orderCount;
      c.lng += a.lng * a.orderCount;
      c.orderCount += a.orderCount;
      c.netSales += a.netSales;
    }
    const out = [...m.values()].map((c) => ({ ...c, lat: c.lat / c.orderCount, lng: c.lng / c.orderCount }));
    return out.sort((x, y) => y.netSales - x.netSales).slice(0, 12);
  }, [focus, zips]);

  // city|ST set of everywhere we already have B2B sales — subtracted from the
  // whitespace layers so we never label a city we sell into as "open".
  const soldCityKeys = useMemo(() => {
    const s = new Set();
    for (const a of zips) if (a.city) s.add(`${a.city.toLowerCase()}|${a.state}`);
    return s;
  }, [zips]);

  // Whitespace inside the focused state — every major (pop ≥ 50k) city we DON'T
  // yet sell into. Capped + projection-guarded so dense states stay readable.
  const whitespaceCities = useMemo(() => {
    if (!focus || !cities) return [];
    return cities
      .filter((c) => c.s === focus.abbr && !soldCityKeys.has(`${c.c.toLowerCase()}|${c.s}`) && projectsOnMap(c.lng, c.lat))
      .sort((a, b) => b.p - a.p)
      .slice(0, 40);
  }, [focus, cities, soldCityKeys]);

  // National whitespace (Opportunity view, no state focused): the biggest US
  // cities with NO B2B sales anywhere — the headline "open markets" list.
  const nationalWhitespace = useMemo(() => {
    if (!opportunity || focus || !cities) return [];
    return cities
      .filter((c) => !soldCityKeys.has(`${c.c.toLowerCase()}|${c.s}`) && projectsOnMap(c.lng, c.lat))
      .sort((a, b) => b.p - a.p)
      .slice(0, 24);
  }, [opportunity, focus, cities, soldCityKeys]);

  // Lazy-load the cities file the moment Opportunity (or a zoom) needs it.
  const loadCities = useCallback(() => {
    if (!cities) import("@/data/us-cities-major.json").then((m) => setCities(m.default ?? m));
  }, [cities]);

  const showSales = useCallback(() => setView("sales"), []);
  const showOpportunity = useCallback(() => { setView("opportunity"); loadCities(); }, [loadCities]);

  // Zoom by state abbreviation — the single path used by the dropdown, a
  // polygon click, and a click on a heat blob. Looks the state's geometry up
  // from the pre-computed features so it doesn't depend on the click target.
  const zoomToAbbr = useCallback((abbr) => {
    const geo = STATE_GEO.get(abbr);
    if (!geo) return;
    const fips = String(geo.id).padStart(2, "0");
    const centroid = geoCentroid(geo);
    const [[x0, y0], [x1, y1]] = geoBounds(geo);
    const span = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0) * 1.4);
    const zoom = Math.max(2.5, Math.min(9, 48 / span));
    setPosition({ coordinates: centroid, zoom });
    setFocus({ fips, abbr });
    // Counties are ~840KB and the cities list ~50KB — only pull them in once
    // the user actually zooms into a state.
    if (!countiesTopo) import("us-atlas/counties-10m.json").then((m) => setCountiesTopo(m.default ?? m));
    loadCities();
  }, [countiesTopo, loadCities]);

  const zoomToState = useCallback((geo) => {
    const abbr = FIPS_TO_STATE[String(geo.id).padStart(2, "0")];
    if (abbr) zoomToAbbr(abbr);
  }, [zoomToAbbr]);

  const resetView = useCallback(() => {
    setPosition(NATIONAL_VIEW);
    setFocus(null);
  }, []);

  const nudgeZoom = (factor) =>
    setPosition((p) => ({ ...p, zoom: Math.max(1, Math.min(12, p.zoom * factor)) }));

  const located = orders.filter((o) => o.shipLat != null).length;
  const openCount = focus ? whitespaceCities.length : nationalWhitespace.length;

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-sans text-[10px] uppercase tracking-[0.16em] text-muted font-semibold">View</span>
        <div className="inline-flex rounded-md border border-rule overflow-hidden">
          {[["sales", "Sales"], ["opportunity", "Opportunity"]].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={k === "opportunity" ? showOpportunity : showSales}
              className={`font-sans text-[11px] px-2.5 py-1 ${
                view === k ? "bg-brown text-paper font-semibold" : "bg-paper text-inksoft hover:bg-paper2"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Color-by + Style only steer the Sales heat cloud. */}
        {!opportunity && (
          <>
            <span className="font-sans text-[10px] uppercase tracking-[0.16em] text-muted font-semibold ml-1">Color by</span>
            <div className="inline-flex rounded-md border border-rule overflow-hidden">
              {COLOR_MODES.map((o) => (
                <button
                  key={o.k}
                  type="button"
                  onClick={() => setColorBy(o.k)}
                  className={`font-sans text-[11px] px-2.5 py-1 ${
                    colorBy === o.k ? "bg-brown text-paper font-semibold" : "bg-paper text-inksoft hover:bg-paper2"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <span className="font-sans text-[10px] uppercase tracking-[0.16em] text-muted font-semibold ml-1">Style</span>
            <div className="inline-flex rounded-md border border-rule overflow-hidden">
              {[["heat", "Density"], ["points", "Points"]].map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setStyle(k)}
                  className={`font-sans text-[11px] px-2.5 py-1 ${
                    style === k ? "bg-brown text-paper font-semibold" : "bg-paper text-inksoft hover:bg-paper2"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        <span className="font-sans text-[10px] uppercase tracking-[0.16em] text-muted font-semibold ml-1">Jump to</span>
        <select
          value={focus?.abbr ?? ""}
          onChange={(e) => (e.target.value ? zoomToAbbr(e.target.value) : resetView())}
          className="font-sans text-[11px] px-2 py-1 rounded-md border border-rule bg-paper text-inksoft hover:border-brown cursor-pointer"
          aria-label="Zoom to a state"
        >
          <option value="">All US</option>
          {STATE_OPTIONS.map((abbr) => (
            <option key={abbr} value={abbr}>{abbr}</option>
          ))}
        </select>

        <span className="font-sans text-[10px] text-muted ml-auto">
          {opportunity
            ? `${fmtNum(openCount)} open ${focus ? "cities" : "big cities"} · ${fmtNum(visibleMarkets.length)} thin markets (≤${MINIMAL_ORDERS})`
            : `${fmtNum(zips.length)} ZIPs · ${fmtNum(located)} B2B orders located${offMap > 0 ? ` · ${fmtNum(offMap)} off-map hidden` : ""}`}
        </span>
      </div>

      <div className="relative bg-card border border-rule rounded-xl overflow-hidden">
        {/* Breadcrumb / zoom controls */}
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
          {focus && (
            <button
              type="button"
              onClick={resetView}
              className="font-sans text-[11px] px-2 py-1 rounded-md bg-card border border-rule text-inksoft hover:border-brown shadow-sm"
            >
              ← US · {focus.abbr}
            </button>
          )}
          <button type="button" onClick={() => nudgeZoom(1.5)} aria-label="Zoom in"
            className="font-sans text-sm leading-none w-7 h-7 rounded-md bg-card border border-rule text-inksoft hover:border-brown shadow-sm">+</button>
          <button type="button" onClick={() => nudgeZoom(1 / 1.5)} aria-label="Zoom out"
            className="font-sans text-sm leading-none w-7 h-7 rounded-md bg-card border border-rule text-inksoft hover:border-brown shadow-sm">−</button>
        </div>

        <ComposableMap
          projection="geoAlbersUsa"
          width={MAP_W}
          height={MAP_H}
          style={{ width: "100%", height: "auto", display: "block" }}
        >
          <defs>
            {/* Soft falloff per color → the heat-cloud look. */}
            {[...gradients.entries()].map(([color, id]) => (
              <radialGradient key={id} id={id} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={color} stopOpacity={0.78} />
                <stop offset="55%" stopColor={color} stopOpacity={0.32} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </radialGradient>
            ))}
            <filter id="heatBlur" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation={5 / z} />
            </filter>
          </defs>

          <ZoomableGroup
            center={position.coordinates}
            zoom={position.zoom}
            minZoom={1}
            maxZoom={12}
            onMoveEnd={(p) => setPosition({ coordinates: p.coordinates, zoom: p.zoom })}
          >
            <Geographies geography={statesTopo}>
              {({ geographies }) =>
                geographies.map((geo) => {
                  const fips = String(geo.id).padStart(2, "0");
                  const abbr = FIPS_TO_STATE[fips];
                  const isFocus = focus?.fips === fips;
                  // Opportunity view: light orange = no B2B sales (open), gray =
                  // already covered. Sales view: the usual cream basemap.
                  const hasSales = statesWithSales.has(abbr);
                  const fill = opportunity ? (hasSales ? COVERED_FILL : OPEN_FILL) : (brand.paper2 ?? "#F4EEDA");
                  const stroke = isFocus ? brand.brown : opportunity && !hasSales ? brand.brown : "#d9d4c8";
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      onClick={() => zoomToState(geo)}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={(isFocus ? 1.2 : 0.5) / z}
                      style={{
                        default: { outline: "none", cursor: "pointer" },
                        hover: { outline: "none", fill: opportunity ? (hasSales ? COVERED_FILL : OPEN_FILL) : focus ? (brand.paper2 ?? "#F4EEDA") : "#EFE8D2" },
                        pressed: { outline: "none" },
                      }}
                    />
                  );
                })
              }
            </Geographies>

            {/* County outlines for the focused state — geographic orientation. */}
            {focus && countiesTopo && (
              <Geographies geography={countiesTopo}>
                {({ geographies }) =>
                  geographies
                    .filter((g) => String(g.id).padStart(5, "0").startsWith(focus.fips))
                    .map((geo) => (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill="transparent"
                        stroke={brand.tan}
                        strokeWidth={0.4 / z}
                        style={{ default: { outline: "none", pointerEvents: "none" }, hover: { outline: "none" }, pressed: { outline: "none" } }}
                      />
                    ))
                }
              </Geographies>
            )}

            {/* Visual heat layer — Sales view only (non-interactive so state
                clicks pass through). */}
            {!opportunity && style === "heat" && (
              <g filter="url(#heatBlur)" style={{ pointerEvents: "none" }}>
                {sorted.map((a, i) => (
                  <Marker key={i} coordinates={[a.lng, a.lat]}>
                    <circle r={heatRadius(a)} fill={`url(#${gradients.get(colorFor(a))})`} />
                  </Marker>
                ))}
              </g>
            )}

            {/* Markets layer. Sales: every market (crisp points, or the hover hit
                layer under the heat glow). Opportunity: only the thin/nascent
                markets, as solid orange dots. */}
            {visibleMarkets.map((a, i) => {
              const showDot = opportunity || style === "points";
              const fillC = opportunity ? brand.brown : style === "points" ? colorFor(a) : "transparent";
              return (
                <Marker key={`p${i}`} coordinates={[a.lng, a.lat]}>
                  <circle
                    r={opportunity ? Math.max(2.6, dotRadius(a)) : style === "points" ? dotRadius(a) : Math.max(2.5, dotRadius(a))}
                    fill={fillC}
                    fillOpacity={showDot ? (opportunity ? 0.9 : 0.82) : 0}
                    stroke={showDot ? "#fff" : "none"}
                    strokeWidth={0.5 / z}
                    onMouseEnter={() => setHover(a)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => a.state && zoomToAbbr(a.state)}
                    style={{ cursor: "pointer" }}
                  />
                </Marker>
              );
            })}

            {/* Whitespace cities (no B2B sales). Orange in Opportunity view (drop
                a rep here), muted gray as context in Sales view. Non-interactive
                so they never block a state click. */}
            {[...(focus ? whitespaceCities : nationalWhitespace)].map((c, i) => {
              const wsColor = opportunity ? brand.brown : brand.muted;
              return (
                <Marker key={`w${i}`} coordinates={[c.lng, c.lat]} style={{ default: { pointerEvents: "none" }, hover: {}, pressed: {} }}>
                  <circle r={(opportunity ? 2.1 : 1.8) / z} fill={wsColor} fillOpacity={opportunity ? 0.95 : 0.7} />
                  <text
                    x={3.5 / z}
                    y={1.2 / z}
                    style={{ fontFamily: "system-ui, sans-serif", fontWeight: opportunity ? 600 : 500, pointerEvents: "none" }}
                    fontSize={(opportunity ? 8 : 7.5) / z}
                    fill={wsColor}
                    stroke="#fff"
                    strokeWidth={1.4 / z}
                    paintOrder="stroke"
                  >
                    {c.c}
                  </text>
                </Marker>
              );
            })}

            {/* City labels (where we DO have sales) when zoomed into a state. */}
            {focus && focusCities.map((c, i) => (
              <Marker key={`c${i}`} coordinates={[c.lng, c.lat]}>
                <circle r={2.2 / z} fill={brand.ink} />
                <text
                  x={4 / z}
                  y={1.5 / z}
                  style={{ fontFamily: "system-ui, sans-serif", fontWeight: 600, pointerEvents: "none" }}
                  fontSize={9 / z}
                  fill={brand.ink}
                  stroke="#fff"
                  strokeWidth={1.6 / z}
                  paintOrder="stroke"
                >
                  {c.city}
                </text>
              </Marker>
            ))}
          </ZoomableGroup>
        </ComposableMap>

        {hover && (
          <div className="absolute top-2 left-2 bg-card border border-rule rounded-lg shadow-lg px-3 py-2 font-sans text-xs pointer-events-none max-w-[240px]">
            <div className="font-semibold text-ink">
              {hover.city ? `${hover.city}, ` : ""}{hover.state} {hover.zip !== "—" ? hover.zip : ""}
            </div>
            <div className="text-inksoft mt-0.5">{fmtMoney(hover.netSales)} net · {fmtNum(hover.orderCount)} orders</div>
            <div className="text-muted">{fmtNum(hover.newAccounts)} new · owner {hover.dominantRep ? repName(hover.dominantRep) : "—"}</div>
          </div>
        )}

        <div className="absolute bottom-2 left-2 font-sans text-[10px] text-muted bg-card/80 rounded px-1.5 py-0.5 pointer-events-none">
          {opportunity
            ? focus
              ? "Orange = major city (50k+) with no B2B sales · dots = thin markets (≤" + MINIMAL_ORDERS + " orders)"
              : "Orange states = no B2B sales · orange dots = biggest cities with no sales — open territory"
            : focus
              ? "Gray = major city (50k+) with no B2B sales — open territory"
              : "Click a state (or use “Jump to”) to zoom into its cities"}
        </div>
      </div>

      {/* Legend */}
      {opportunity ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-sans text-[11px] text-inksoft">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 h-3 rounded-sm border border-rule" style={{ backgroundColor: OPEN_FILL }} />
            State with no B2B sales
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 h-3 rounded-sm border border-rule" style={{ backgroundColor: COVERED_FILL }} />
            Already covered
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: brand.brown }} />
            Open big city / thin market (≤{MINIMAL_ORDERS} orders)
          </span>
        </div>
      ) : colorBy === "rep" ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {repsPresent.map((id) => (
            <span key={id} className="inline-flex items-center gap-1.5 font-sans text-[11px] text-inksoft">
              <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: repColors.get(id) }} />
              {repName(id)}
            </span>
          ))}
          {repsPresent.length === 0 && <span className="font-sans text-[11px] text-muted">No rep-attributed ZIPs in range.</span>}
        </div>
      ) : (
        <div className="flex items-center gap-2 font-sans text-[11px] text-muted">
          <span>Low</span>
          <span className="inline-flex h-2.5 rounded-full overflow-hidden">
            {heatRamp.slice(1).map((c, i) => (
              <span key={i} className="inline-block w-6 h-2.5" style={{ backgroundColor: c }} />
            ))}
          </span>
          <span>High</span>
          <span className="ml-2">
            {colorBy === "net" ? "Net sales per ZIP" : colorBy === "orders" ? "Orders per ZIP" : "New accounts per ZIP"} · glow intensity = density
          </span>
        </div>
      )}
    </div>
  );
}

// Defense-in-depth: even with the projection guard, no single bad data row
// should be able to blank the whole dashboard. If the map subtree throws, show
// a quiet fallback instead of React's full "Application error" screen.
class MapErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="bg-card border border-rule rounded-xl p-6 text-center font-sans text-sm text-inksoft">
          The map couldn’t render this selection. The rest of the dashboard is unaffected — try a different date range or state.
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ZipHeatMap(props) {
  return (
    <MapErrorBoundary>
      <ZipHeatMapInner {...props} />
    </MapErrorBoundary>
  );
}
