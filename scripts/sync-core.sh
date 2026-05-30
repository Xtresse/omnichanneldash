#!/usr/bin/env bash
# Propagate the canonical shared core to every Xtressé dashboard so they can
# never drift. Edit ONLY omnichanneldash/lib/xtresseCore.js, then run this.
# Same metric + same window => same number on every dashboard, by construction.
set -euo pipefail
MASTER="$(cd "$(dirname "$0")/.." && pwd)/lib/xtresseCore.js"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGETS=(
  "$ROOT/xtresse-leadershipdash/lib/xtresseCore.js"
  "$ROOT/Sales-Rep-Dashboards/lib/xtresseCore.js"
  "$ROOT/CRO_Tracker/lib/xtresseCore.js"
  "$ROOT/xtresse-orders-tracker/lib/xtresseCore.js"
)
for t in "${TARGETS[@]}"; do
  mkdir -p "$(dirname "$t")"
  cp "$MASTER" "$t"
  echo "synced -> $t"
done
echo "canonical core sha256: $(sha256sum "$MASTER" | cut -d' ' -f1)"
echo "All dashboards now share an identical core. Commit each repo."
