# Territory Audit — Recency-Weighted ZIP Proximity

**Deployed:** commit `e1959a39` to `sales-rep-dashboards` · deployment `dpl_8jJA5RM16AszgoA8dd5vxJyBDBnr` · state READY · 2026-05-12.

## What ships

`lib/repTerritory.js` — attribution rewritten to:

1. **Exact 5-digit ZIP match** — rep with most-recent order in that exact ZIP within the last 180 days.
2. **3-digit ZIP prefix match** — rep with most-recent order in the neighborhood (e.g. all `830xx` ZIPs).
3. **Haversine proximity** — distance from the account's ZIP centroid to each rep's *closest ordered region* (2-digit ZIP centroid). Rep with the smallest distance wins. Hard cap at 500 miles; beyond that, account is unassigned.
4. **Recency filter** — only orders from the **last 180 days** count toward a rep's territory cluster. Old orders age out, so a rep who's been re-territoried away from a region stops "owning" it after their last order there expires from the window.

Tiebreakers across all tiers: most-recent date → higher $ value → alphabetical by rep slug.

State-level fallback was **removed** — proximity gives the same answer for in-state cases AND handles cross-state-territory cases like CO/WY correctly without needing a state bucket at all.

`/api/territory-audit?token=<AUDIT_TOKEN>` — new diagnostic endpoint that runs the proximity attribution against the full Windsor pull and returns per-rep account counts + state distribution + top cities + geoBasis breakdown.

## To pull the audit data

The endpoint is gated by the `AUDIT_TOKEN` env var. To use it:

1. **Set the env var** in Vercel → `sales-rep-dashboards` → Settings → Environment Variables:
   - Key: `AUDIT_TOKEN`
   - Value: any string you choose (e.g. `xtresse-audit-2026-05`)
   - Environment: Production
   - Save, then trigger a redeploy (Settings → General → "Redeploy")

2. **Hit the endpoint** in browser or curl:
   ```
   https://sales-rep-dashboards.vercel.app/api/territory-audit?token=<AUDIT_TOKEN>
   ```

3. Returned JSON shape:
   ```json
   {
     "generatedAt": "2026-05-12T...",
     "totalAccounts": <int>,
     "attributedCount": <int>,
     "unassignedCount": <int>,
     "unassignedSample": [...],
     "reps": [
       {
         "slug": "...",
         "name": "...",
         "section": "...",
         "region": "...",
         "accountCount": <int>,
         "lastOrderDate": "YYYY-MM-DD",
         "states": [{"state": "FL", "count": 42}, ...],
         "topCities": [{"city": "Tampa", "count": 14}, ...],
         "basisCounts": {"zip": 12, "prefix": 8, "proximity": 22, "other": 0}
       },
       ...
     ]
   }
   ```

## Expected outcomes (per Sam's commentary)

| Rep | Expected territory | Predicted post-fix behavior |
|---|---|---|
| **Dia Lamport** | Tampa, FL only | Zero TX accounts, zero WY accounts. Just Tampa-area FL cities (Tampa, St. Petersburg, Clearwater, etc.) |
| **Megan Gilbert** | CO + WY | Should gain Wilson WY + Jackson WY + any other dormant WY accounts. Plus all CO accounts. |
| **Other reps** | Their actual current territory | State list should match where they've actually been ordering in the last 180 days. |

## Verification checklist (Sam to run after setting AUDIT_TOKEN)

- [ ] Hit `/api/territory-audit?token=...`, confirm 200 response with full per-rep breakdown.
- [ ] Dia's `accountCount` row: states list has FL only, zero TX, zero WY.
- [ ] Megan's row: states list includes WY (with Wilson + Jackson on the cities). May also include CO + adjacent states.
- [ ] Scan the unassigned list — accounts that fell outside 500mi of any active rep. These probably need attention or a new rep.
- [ ] Scan each rep's `states` count — flag any rep with 1-2 accounts in a state non-adjacent to their primary region (these may be cross-state proximity artifacts worth eyeballing).

## Per-rep audit (to be filled in after AUDIT_TOKEN is set)

Paste the `reps[]` array from the JSON response into this table for review:

| Rep | Accounts | States | Top cities | Notes |
|---|---|---|---|---|
| Dia Lamport | — | — | — | Expect: Tampa FL only |
| Megan Gilbert | — | — | — | Expect: CO + WY |
| Amy Pierre | — | — | — | — |
| Cheryl Greiber | — | — | — | — |
| Sherry Quinn | — | — | — | — |
| Tyler De Masi | — | — | — | — |
| (... remaining reps) | — | — | — | — |

## Sub-component visibility on the live Account Aging tab

Each row in the table now shows a small chip under the account name indicating attribution basis:

- `via ZIP 33606` — high confidence, rep has orders in that exact ZIP within the last 180 days
- `via ZIP 336xx` — neighborhood match (3-digit prefix)
- `via proximity (~280mi → 80xxx)` — closest ordered region within 500mi, with the distance and target 2-digit region
- Override-style chips (`assigned · ...`) — reserved for the empty `TERRITORY_OVERRIDES` table; not used today

If an account doesn't fit any tier, it appears on no rep's view and shows up in the audit endpoint's `unassignedSample` list.

## Known limitations

- 2-digit ZIP centroid resolution (~80 regions covering contiguous US). Adjacent ZIPs within the same 2-digit region are treated as colocated. Acceptable for cross-state proximity; not appropriate for sub-state routing.
- 180-day recency window is fixed in code at `RECENCY_DAYS = 180`. If a rep takes a 6-month sales gap, their territory cluster shrinks. Adjustable via the constant if too aggressive.
- Hawaii / Alaska / Puerto Rico ZIPs fall back to `unassigned` (no centroid in the contiguous-US table).

---

*Live: https://sales-rep-dashboards.vercel.app/dashboard (rep-cookie auth required).*
