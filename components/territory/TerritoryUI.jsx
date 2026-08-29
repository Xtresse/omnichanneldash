"use client";

import { useEffect, useMemo, useState } from "react";

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "Washington DC",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico",
};
const SPLIT_STATES = ["CA", "FL", "TX", "NJ", "GA"];

function repLabel(slug, roster) {
  if (!slug) return "— unassigned";
  const rep = roster.find((r) => r.slug === slug);
  return rep ? rep.name : slug;
}

function timeAgo(iso) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export default function TerritoryUI() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedState, setExpandedState] = useState(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ rep_name: "", rep_slug: "", territory_description: "", states: "", zip_prefixes: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/territory", { cache: "no-store" });
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const latest = data?.latest || null;
  const roster = latest?.rep_roster || [];
  const stateMap = latest?.state_map || {};
  const zipDetail = latest?.zip_detail || {};
  const pendingEntries = (data?.manualEntries || []).filter((e) => e.status !== "applied_upstream");
  const appliedEntries = (data?.manualEntries || []).filter((e) => e.status === "applied_upstream");

  const stateRows = useMemo(() => {
    const rows = Object.entries(stateMap).map(([abbr, hit]) => ({
      abbr,
      name: STATE_NAMES[abbr] || abbr,
      rep: hit?.rep || null,
      basis: hit?.basis || null,
      split: SPLIT_STATES.includes(abbr),
    }));
    const q = search.trim().toLowerCase();
    const filtered = q
      ? rows.filter(
          (r) =>
            r.abbr.toLowerCase().includes(q) ||
            r.name.toLowerCase().includes(q) ||
            repLabel(r.rep, roster).toLowerCase().includes(q)
        )
      : rows;
    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }, [stateMap, search, roster]);

  async function submitManualEntry(e) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    try {
      const body = {
        rep_name: form.rep_name,
        rep_slug: form.rep_slug || null,
        territory_description: form.territory_description,
        states: form.states.split(",").map((s) => s.trim()).filter(Boolean),
        zip_prefixes: form.zip_prefixes.split(",").map((s) => s.trim()).filter(Boolean),
        notes: form.notes,
      };
      const res = await fetch("/api/territory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "save failed");
      setSaveMsg("Saved — snippet ready below.");
      setForm({ rep_name: "", rep_slug: "", territory_description: "", states: "", zip_prefixes: "", notes: "" });
      setShowForm(false);
      await load();
    } catch (err) {
      setSaveMsg(`Error: ${String(err?.message || err)}`);
    } finally {
      setSaving(false);
    }
  }

  function copySnippet(entry) {
    navigator.clipboard?.writeText(entry.exported_snippet || "");
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col">
      <header className="sticky top-0 z-30 bg-browndeep text-paper border-b border-rule">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <a href="/" className="font-display text-lg leading-none hover:underline">
            Xtressé Omni
          </a>
          <div className="flex-1" />
          <div className="font-display text-lg font-semibold leading-none">Territory</div>
          <div className="flex-1" />
          <button
            onClick={load}
            className="px-3 py-1.5 rounded-md border border-paper/30 text-[12px] hover:bg-paper/10 transition"
          >
            Refresh
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6 space-y-6">
        {loading && <div className="text-sm text-muted">Loading…</div>}
        {error && <div className="text-sm text-red-600">Error: {error}</div>}

        {!loading && !error && !latest && (
          <div className="rounded-lg border border-rule bg-white p-4 text-sm">
            No snapshot yet. The <code>territory-tick</code> cron pulls from Sales-Rep-Dashboards
            every 15 minutes — trigger one manually to seed this page, or wait for the next tick.
          </div>
        )}

        {latest && (
          <>
            <section className="rounded-lg border border-rule bg-white p-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="font-display text-base">Live territory map</div>
                  <div className="text-[12px] text-muted">
                    Captured {timeAgo(latest.captured_at)} · status {latest.status}
                    {latest.status === "error" && ` (${latest.error_message}) — showing last-good data`}
                    {" · "}
                    {latest.meta?.ordersUsed ? `${latest.meta.ordersUsed} orders` : ""}
                  </div>
                </div>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search state or rep…"
                  className="border border-rule rounded-md px-2 py-1 text-sm w-56"
                />
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-muted border-b border-rule">
                      <th className="py-1.5 pr-3">State</th>
                      <th className="py-1.5 pr-3">Rep</th>
                      <th className="py-1.5 pr-3">Basis</th>
                      <th className="py-1.5 pr-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {stateRows.map((r) => (
                      <>
                        <tr key={r.abbr} className="border-b border-rule/50">
                          <td className="py-1.5 pr-3">
                            {r.name} <span className="text-muted">({r.abbr})</span>
                            {r.split && <span className="ml-1 text-[10px] text-amber-700">*shared</span>}
                          </td>
                          <td className="py-1.5 pr-3">{repLabel(r.rep, roster)}</td>
                          <td className="py-1.5 pr-3 text-[11px] text-muted">{r.basis || "—"}</td>
                          <td className="py-1.5 pr-3">
                            {r.split && zipDetail[r.abbr] && (
                              <button
                                className="text-[11px] underline text-muted hover:text-ink"
                                onClick={() => setExpandedState(expandedState === r.abbr ? null : r.abbr)}
                              >
                                {expandedState === r.abbr ? "hide zips" : "show zips"}
                              </button>
                            )}
                          </td>
                        </tr>
                        {expandedState === r.abbr && zipDetail[r.abbr] && (
                          <tr key={`${r.abbr}-detail`} className="bg-paper/60">
                            <td colSpan={4} className="py-2 px-3">
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                                {Object.entries(zipDetail[r.abbr]).map(([z3, hit]) => (
                                  <span key={z3}>
                                    <span className="text-muted">{z3}xx</span> → {repLabel(hit.rep, roster)}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-lg border border-rule bg-white p-4">
              <div className="font-display text-base mb-2">Recent changes</div>
              {(data.history || []).filter((h) => h.changed).length === 0 && (
                <div className="text-sm text-muted">No changes detected since tracking began.</div>
              )}
              <ul className="space-y-2 text-sm">
                {(data.history || [])
                  .filter((h) => h.changed)
                  .slice(0, 10)
                  .map((h) => (
                    <li key={h.id} className="border-b border-rule/50 pb-2">
                      <div className="text-[11px] text-muted">{timeAgo(h.captured_at)}</div>
                      {h.status === "error" ? (
                        <div className="text-red-600">Fetch error: {h.error_message}</div>
                      ) : (
                        <div className="flex flex-wrap gap-x-3 text-[12px]">
                          {h.diff_summary?.changed?.map((c, i) => (
                            <span key={i}>
                              <b>{c.key}</b>: {repLabel(c.from, roster)} → {repLabel(c.to, roster)}
                            </span>
                          ))}
                          {h.diff_summary?.added?.map((a, i) => (
                            <span key={`a${i}`}>
                              <b>{a.key}</b>: new → {repLabel(a.to, roster)}
                            </span>
                          ))}
                          {h.diff_summary?.removed?.map((rm, i) => (
                            <span key={`r${i}`}>
                              <b>{rm.key}</b>: {repLabel(rm.from, roster)} → gone
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
              </ul>
            </section>
          </>
        )}

        <section className="rounded-lg border border-rule bg-white p-4">
          <div className="flex items-center justify-between">
            <div className="font-display text-base">New-rep seeding</div>
            <button
              onClick={() => setShowForm(!showForm)}
              className="px-3 py-1.5 rounded-md bg-brown text-ink text-[12px] font-semibold hover:bg-browndeep hover:text-paper transition"
            >
              {showForm ? "Cancel" : "+ Add new rep/territory"}
            </button>
          </div>
          <p className="text-[12px] text-muted mt-1">
            For a brand-new 1099 with zero order history yet — nothing to infer from. Generates a
            ready-to-review TERRITORY_OVERRIDES snippet; doesn't write to the live resolver
            automatically. Once real order data confirms the assignment, it auto-flips to applied.
          </p>

          {showForm && (
            <form onSubmit={submitManualEntry} className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <label className="flex flex-col gap-1">
                Rep name*
                <input required value={form.rep_name} onChange={(e) => setForm({ ...form, rep_name: e.target.value })}
                  className="border border-rule rounded-md px-2 py-1.5" />
              </label>
              <label className="flex flex-col gap-1">
                Rep slug (once known)
                <input value={form.rep_slug} onChange={(e) => setForm({ ...form, rep_slug: e.target.value })}
                  placeholder="e.g. jane-doe" className="border border-rule rounded-md px-2 py-1.5" />
              </label>
              <label className="flex flex-col gap-1 md:col-span-2">
                Territory description
                <input value={form.territory_description} onChange={(e) => setForm({ ...form, territory_description: e.target.value })}
                  placeholder="e.g. Denver metro, new 1099" className="border border-rule rounded-md px-2 py-1.5" />
              </label>
              <label className="flex flex-col gap-1">
                States (comma-separated)
                <input value={form.states} onChange={(e) => setForm({ ...form, states: e.target.value })}
                  placeholder="e.g. CO" className="border border-rule rounded-md px-2 py-1.5" />
              </label>
              <label className="flex flex-col gap-1">
                ZIP-3 prefixes (comma-separated)
                <input value={form.zip_prefixes} onChange={(e) => setForm({ ...form, zip_prefixes: e.target.value })}
                  placeholder="e.g. 802, 803" className="border border-rule rounded-md px-2 py-1.5" />
              </label>
              <label className="flex flex-col gap-1 md:col-span-2">
                Notes (who/when/why — kept alongside the snippet)
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2} className="border border-rule rounded-md px-2 py-1.5" />
              </label>
              <div className="md:col-span-2 flex items-center gap-3">
                <button disabled={saving} type="submit"
                  className="px-4 py-1.5 rounded-md bg-brown text-ink text-[12px] font-semibold hover:bg-browndeep hover:text-paper transition disabled:opacity-50">
                  {saving ? "Saving…" : "Save & generate snippet"}
                </button>
                {saveMsg && <span className="text-[12px] text-muted">{saveMsg}</span>}
              </div>
            </form>
          )}

          {pendingEntries.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="text-[11px] uppercase tracking-wider text-muted">Pending upstream</div>
              {pendingEntries.map((entry) => (
                <div key={entry.id} className="border border-rule rounded-md p-3 text-sm">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="font-semibold">
                      {entry.rep_name} {entry.rep_slug && <span className="text-muted">({entry.rep_slug})</span>}
                    </div>
                    <button onClick={() => copySnippet(entry)} className="text-[11px] underline text-muted hover:text-ink">
                      {copiedId === entry.id ? "copied!" : "copy snippet"}
                    </button>
                  </div>
                  <div className="text-[12px] text-muted">{entry.territory_description}</div>
                  <pre className="mt-2 bg-paper/70 rounded p-2 text-[11px] overflow-x-auto whitespace-pre-wrap">
                    {entry.exported_snippet}
                  </pre>
                </div>
              ))}
            </div>
          )}

          {appliedEntries.length > 0 && (
            <div className="mt-4 text-[12px] text-muted">
              Applied: {appliedEntries.map((e) => e.rep_name).join(", ")}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
