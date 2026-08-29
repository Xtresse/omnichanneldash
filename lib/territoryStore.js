/**
 * Territory Engine persistence, Supabase (Postgres via PostgREST) — same
 * project + raw-fetch style as lib/projectionsStore.js, two new tables:
 *
 *   omni_territory_snapshots      — append-only pull history + diffs
 *   omni_territory_manual_entries — new-rep seeding (no order history yet)
 *
 * Reads/writes go through this app's own gated API routes, so the anon key
 * doesn't need to be secret (same reasoning as projectionsStore.js).
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ykavrlsroiyvtdqdgyqk.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrYXZybHNyb2l5dnRkcWRneXFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxNTA0NDUsImV4cCI6MjA5NDcyNjQ0NX0.0vbkQ2Avw94mu3Sn7JeNVdLYqwxVptQeIoPP98Fq8VY";

const SNAPSHOTS = "omni_territory_snapshots";
const MANUAL = "omni_territory_manual_entries";

export function territoryStoreConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

const rest = (path) => `${SUPABASE_URL}/rest/v1/${path}`;
const headers = (extra = {}) => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
  ...extra,
});

/** Most recent snapshot row (any status), or null if the table is empty. */
export async function readLatestSnapshot() {
  const r = await fetch(rest(`${SNAPSHOTS}?select=*&order=captured_at.desc&limit=1`), {
    headers: headers(),
    cache: "no-store",
  });
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/** Most recent snapshot with status='ok' — the diff baseline. */
export async function readLatestGoodSnapshot() {
  const r = await fetch(
    rest(`${SNAPSHOTS}?select=*&status=eq.ok&order=captured_at.desc&limit=1`),
    { headers: headers(), cache: "no-store" }
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/** Recent snapshot history, newest first, for the diff timeline. */
export async function readSnapshotHistory(limit = 30) {
  const r = await fetch(
    rest(`${SNAPSHOTS}?select=id,captured_at,status,error_message,diff_summary,changed,meta&order=captured_at.desc&limit=${limit}`),
    { headers: headers(), cache: "no-store" }
  );
  if (!r.ok) return [];
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}

export async function insertSnapshot(row) {
  const r = await fetch(rest(SNAPSHOTS), {
    method: "POST",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Supabase insert (snapshot) failed (${r.status}): ${text.slice(0, 300)}`);
  }
  const saved = await r.json();
  return Array.isArray(saved) ? saved[0] : saved;
}

/**
 * Diff two snapshots' stateMap + zipDetail. Returns {added, removed, changed}
 * where `added`/`removed` are keys with no prior/no current value and
 * `changed` is [{key, from, to}] for keys whose resolved rep flipped.
 * `prev` may be null (first-ever snapshot) — everything reads as "added".
 */
export function diffSnapshots(prev, curr) {
  const flat = (snap) => {
    const out = {};
    if (!snap) return out;
    for (const [state, hit] of Object.entries(snap.state_map || snap.stateMap || {})) {
      out[`state:${state}`] = hit?.rep ?? null;
    }
    for (const [state, zips] of Object.entries(snap.zip_detail || snap.zipDetail || {})) {
      for (const [z3, hit] of Object.entries(zips || {})) {
        out[`zip:${state}:${z3}`] = hit?.rep ?? null;
      }
    }
    return out;
  };
  const before = flat(prev);
  const after = flat(curr);
  const added = [];
  const removed = [];
  const changed = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const from = before[key];
    const to = after[key];
    if (from === undefined && to !== undefined) added.push({ key, to });
    else if (from !== undefined && to === undefined) removed.push({ key, from });
    else if (from !== to) changed.push({ key, from, to });
  }
  return { added, removed, changed };
}

export async function readManualEntries() {
  const r = await fetch(rest(`${MANUAL}?select=*&order=created_at.desc`), {
    headers: headers(),
    cache: "no-store",
  });
  if (!r.ok) return [];
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}

export async function upsertManualEntry(row) {
  const clean = {
    rep_name: String(row.rep_name || "").trim(),
    rep_slug: row.rep_slug ? String(row.rep_slug).trim() : null,
    territory_description: row.territory_description || null,
    states: Array.isArray(row.states) ? row.states.map((s) => String(s).toUpperCase().trim()) : [],
    zip_prefixes: Array.isArray(row.zip_prefixes) ? row.zip_prefixes.map((z) => String(z).trim()) : [],
    notes: row.notes || null,
    created_by: row.created_by || null,
    updated_at: new Date().toISOString(),
  };
  if (!clean.rep_name) throw new Error("rep_name is required.");
  clean.exported_snippet = buildOverrideSnippet(clean);
  clean.status = "snippet_generated";

  if (row.id) {
    const r = await fetch(rest(`${MANUAL}?id=eq.${encodeURIComponent(row.id)}`), {
      method: "PATCH",
      headers: headers({ Prefer: "return=representation" }),
      body: JSON.stringify(clean),
    });
    if (!r.ok) throw new Error(`Supabase update (manual entry) failed (${r.status})`);
    const saved = await r.json();
    return Array.isArray(saved) ? saved[0] : saved;
  }
  clean.status = "draft";
  clean.created_at = new Date().toISOString();
  const r = await fetch(rest(MANUAL), {
    method: "POST",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(clean),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Supabase insert (manual entry) failed (${r.status}): ${text.slice(0, 300)}`);
  }
  const saved = await r.json();
  return Array.isArray(saved) ? saved[0] : saved;
}

export async function markManualEntryApplied(id) {
  const r = await fetch(rest(`${MANUAL}?id=eq.${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify({ status: "applied_upstream", updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`Supabase update (mark applied) failed (${r.status})`);
  const saved = await r.json();
  return Array.isArray(saved) ? saved[0] : saved;
}

/**
 * Format a TERRITORY_OVERRIDES-style JS snippet, matching the comment
 * convention already used in Sales-Rep-Dashboards/lib/repTerritory.js
 * (who/when/why, then the declared entries) — ready to review and paste
 * into that file, not auto-applied.
 */
function buildOverrideSnippet(entry) {
  const date = new Date().toISOString().slice(0, 10);
  const who = entry.created_by || "Sam";
  const lines = [
    `// — ${entry.rep_name}${entry.rep_slug ? ` (${entry.rep_slug})` : ""}: ${entry.territory_description || "new 1099 territory"}`,
    `//   Seeded ${date} via omnichanneldash /territory (${who}) — no order history yet,`,
    `//   remove this comment block once real order-tag data supersedes it.${entry.notes ? `\n//   ${entry.notes}` : ""}`,
  ];
  for (const s of entry.states) {
    lines.push(`'${s}': '${entry.rep_slug || "TBD"}',`);
  }
  for (const z of entry.zip_prefixes) {
    lines.push(`'${z}': '${entry.rep_slug || "TBD"}',  // ${entry.rep_name}`);
  }
  return lines.join("\n");
}
