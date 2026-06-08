// Unit check for the canonical preset resolver (lib/presets.mjs).
//
// Guards the bug this file was written to kill: a preset advertised by the
// API route or emitted by FilterBar that doesn't resolve to a real window
// and silently falls back to a 90-day range.
//
// Run with: npm test   (node --test, no extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolvePresetRange,
  PRESET_NAMES,
  ALLOWED_API_PRESETS,
  FILTERBAR_PRESET_VALUES,
  ALL_TIME_START,
} from "../lib/presets.mjs";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
// Fixed UTC anchor so assertions are deterministic: 2026-05-31 (a Sunday).
const NOW = new Date(Date.UTC(2026, 4, 31));

// The exact silent fallback the old presetRange produced for any unmapped
// preset: a trailing 90-day window. No real preset should accidentally equal
// it (other than last_3m / last_90d, which legitimately ARE ~90 days).
const ninetyDayFallback = () => {
  const to = NOW.toISOString().slice(0, 10);
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() - 90);
  return [d.toISOString().slice(0, 10), to];
};

test("every resolvable preset returns a valid [from, to]", () => {
  for (const name of PRESET_NAMES) {
    const [from, to] = resolvePresetRange(name, NOW);
    assert.match(from, ISO, `${name} from is ISO`);
    assert.match(to, ISO, `${name} to is ISO`);
    assert.ok(from <= to, `${name}: from (${from}) <= to (${to})`);
  }
});

test("every API-allowed preset resolves (no silent default)", () => {
  for (const name of ALLOWED_API_PRESETS) {
    assert.ok(PRESET_NAMES.includes(name), `${name} is resolvable`);
    assert.doesNotThrow(() => resolvePresetRange(name, NOW), `${name} resolves`);
  }
});

test("every FilterBar preset value resolves (defensive refresh() path)", () => {
  for (const name of FILTERBAR_PRESET_VALUES) {
    assert.ok(PRESET_NAMES.includes(name), `FilterBar value ${name} is resolvable`);
    const [from, to] = resolvePresetRange(name, NOW);
    assert.ok(from <= to, `${name}: ${from} <= ${to}`);
  }
});

test("previously-broken presets no longer collapse to the 90-day fallback", () => {
  const fallback = JSON.stringify(ninetyDayFallback());
  // Presets that used to hit `map[preset] || 90` and silently became 90 days.
  for (const name of [
    "all_time", "ytd", "this_year", "last_year", "last_2years",
    "today", "this_week", "last_week", "mtd", "last_month", "qtd",
  ]) {
    assert.notEqual(
      JSON.stringify(resolvePresetRange(name, NOW)),
      fallback,
      `${name} must not resolve to the 90-day fallback window`
    );
  }
});

test("known calendar windows resolve correctly @ 2026-05-31", () => {
  assert.deepEqual(resolvePresetRange("today", NOW), ["2026-05-31", "2026-05-31"]);
  assert.deepEqual(resolvePresetRange("mtd", NOW), ["2026-05-01", "2026-05-31"]);
  assert.deepEqual(resolvePresetRange("ytd", NOW), ["2026-01-01", "2026-05-31"]);
  assert.deepEqual(resolvePresetRange("this_year", NOW), ["2026-01-01", "2026-05-31"]);
  assert.deepEqual(resolvePresetRange("qtd", NOW), ["2026-04-01", "2026-05-31"]);
  assert.deepEqual(resolvePresetRange("last_month", NOW), ["2026-04-01", "2026-04-30"]);
  assert.deepEqual(resolvePresetRange("last_year", NOW), ["2025-01-01", "2025-12-31"]);
  assert.deepEqual(resolvePresetRange("last_30d", NOW), ["2026-05-02", "2026-05-31"]);
  assert.deepEqual(resolvePresetRange("last_90d", NOW), ["2026-03-03", "2026-05-31"]);
  // all_time anchors at the data floor, not a rolling window.
  assert.deepEqual(resolvePresetRange("all_time", NOW), [ALL_TIME_START, "2026-05-31"]);
  // this_week: Mon 2026-05-25 .. Sun 2026-05-31.
  assert.deepEqual(resolvePresetRange("this_week", NOW), ["2026-05-25", "2026-05-31"]);
  assert.deepEqual(resolvePresetRange("last_week", NOW), ["2026-05-18", "2026-05-24"]);
});

test("unknown preset throws (no silent fallback)", () => {
  assert.throws(() => resolvePresetRange("garbage", NOW), /Unknown preset/);
  assert.throws(() => resolvePresetRange("", NOW), /Unknown preset/);
});
