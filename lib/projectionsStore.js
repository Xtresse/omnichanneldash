/**
 * Editable target OVERRIDES, persisted in Supabase (Postgres via PostgREST).
 *
 * This is the writable layer Sam/Mike edit on the Projections tab. Each row
 * overrides the Budget / Base / Stretch targets (in BOTH gross and net) for one
 * channel × product × month, OVERLAYING the Google-Sheet budget cube
 * (lib/budgetSheet → /api/budget). Anything left blank falls through to the
 * sheet value, so the sheet stays the default and edits are surgical.
 *
 * Reads/writes go through the app's own gated API route (app/api/projections),
 * which runs server-side, so the Supabase key never has to be secret: the
 * publishable/anon key is used and the dashboard password gate + permissive RLS
 * on this single non-sensitive targets table protect writes. Same Supabase
 * project as the DTC dashboard's dtc_projections.
 *
 * Env (with safe fallbacks so it works the moment the table exists):
 *   SUPABASE_URL, SUPABASE_ANON_KEY
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ykavrlsroiyvtdqdgyqk.supabase.co";
// PUBLIC anon key (safe to embed — maps to the `anon` role; writes are gated by
// the dashboard password + permissive RLS on this one targets table).
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrYXZybHNyb2l5dnRkcWRneXFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxNTA0NDUsImV4cCI6MjA5NDcyNjQ0NX0.0vbkQ2Avw94mu3Sn7JeNVdLYqwxVptQeIoPP98Fq8VY";
const TABLE = "omni_projections";

// Editable cells: 3 tiers × 2 bases. Keyed per channel × product × month.
export const OVERRIDE_FIELDS = [
  "budget_gross", "budget_net",
  "base_gross", "base_net",
  "stretch_gross", "stretch_net",
];

export function projectionsConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== "__ANON_KEY__");
}

const rest = (path) => `${SUPABASE_URL}/rest/v1/${path}`;
const headers = (extra = {}) => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
  ...extra,
});

/** Every saved override row. Returns [] on any failure (caller falls back to sheet). */
export async function readOverrides() {
  if (!projectionsConfigured()) return [];
  try {
    const r = await fetch(rest(`${TABLE}?select=*`), { headers: headers(), cache: "no-store" });
    if (!r.ok) return [];
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/** Upsert one channel × product × month row (merge on the composite key). */
export async function upsertOverride(row) {
  if (!projectionsConfigured()) throw new Error("Projections store not configured (set SUPABASE_URL / SUPABASE_ANON_KEY).");
  if (!row?.channel || !row?.product || !row?.month) throw new Error("channel, product and month are required.");
  const clean = { channel: String(row.channel), product: String(row.product), month: String(row.month) };
  for (const f of OVERRIDE_FIELDS) {
    const v = row[f];
    clean[f] = v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v);
  }
  clean.updated_at = new Date().toISOString();

  const r = await fetch(rest(TABLE), {
    method: "POST",
    headers: headers({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify(clean),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Supabase upsert failed (${r.status}): ${text.slice(0, 200)}`);
  }
  const saved = await r.json();
  return Array.isArray(saved) ? saved[0] : saved;
}

/** Delete a channel × product × month override (revert to the sheet value). */
export async function deleteOverride({ channel, product, month }) {
  if (!projectionsConfigured()) throw new Error("Projections store not configured.");
  const q = `channel=eq.${encodeURIComponent(channel)}&product=eq.${encodeURIComponent(product)}&month=eq.${encodeURIComponent(month)}`;
  const r = await fetch(rest(`${TABLE}?${q}`), { method: "DELETE", headers: headers({ Prefer: "return=minimal" }) });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Supabase delete failed (${r.status}): ${text.slice(0, 200)}`);
  }
  return { ok: true };
}

/**
 * Apply saved overrides onto a sheet cube in place-safe fashion, returning a NEW
 * merged cube of shape company[channel][product][month][tier][basis]. Any
 * non-null override cell wins over the sheet; blanks fall through.
 */
export function mergeOverrides(cube, overrides) {
  const company = structuredCloneSafe(cube?.company || {});
  for (const o of overrides || []) {
    const { channel, product, month } = o;
    if (!channel || !product || !month) continue;
    company[channel] ||= {};
    company[channel][product] ||= {};
    company[channel][product][month] ||= {};
    const cell = company[channel][product][month];
    for (const tier of ["budget", "base", "stretch"]) {
      for (const basis of ["gross", "net"]) {
        const v = o[`${tier}_${basis}`];
        if (v != null && !Number.isNaN(Number(v))) {
          cell[tier] ||= {};
          cell[tier][basis] = Number(v);
        }
      }
    }
  }
  return { ...cube, company, overridden: (overrides || []).length };
}

function structuredCloneSafe(obj) {
  try { return structuredClone(obj); } catch { return JSON.parse(JSON.stringify(obj || {})); }
}
