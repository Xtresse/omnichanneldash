#!/usr/bin/env node
// Fleet core-drift guard (2026-08-16). The vendored-core model (scripts/sync-core.sh
// copies omni's lib/xtresseCore.js to every dashboard) has no other guardrail —
// this is it. A full-file diff is useless (repos legitimately differ in comments +
// repo-specific helpers), so this compares each repo's REVENUE/CHANNEL-CRITICAL
// INVARIANTS to the master and flags only real, numbers-affecting drift. Exit 1 on
// drift so it can gate CI. Extend INVARIANTS as the core's critical logic grows.
import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
const ROOT = process.env.CORE_ROOT || '/Users/samsood/Documents/GitHub';
const MASTER = path.join(ROOT, 'omnichanneldash/lib/xtresseCore.js');
const TARGETS = ['xtresse-leadershipdash','Sales-Rep-Dashboards','CRO_Tracker','xtresse-orders-tracker','xtresse-ops-tracker','xtresse-finance-tracker','DTC_Dashboard','xtresse-influencer-dash'];
// name -> predicate on the file text. TRUE means "has the canonical form".
const INVARIANTS = {
  statusAny:        c => /status:any created_at/.test(c),                 // order universe incl. cancelled
  shopLocalWindow:  c => /hi = to \|\| shopLocalDate/.test(c),            // window-end in shop TZ, not UTC
  netFormula:       c => /currentSubtotalPriceSet/.test(c),              // net = current subtotal (post-refund)
  classifyChannel:  c => /classifyChannel/.test(c),                       // the ONE channel function
  isAdcsUnified:    c => !/\/\^adcs\$\/i/.test(c),                        // NOT the old exact-match regex
  b2bCodePattern:   c => /XVIE|B2B-|REP-/.test(c),                        // B2B discount-code classification
};
const master = fs.readFileSync(MASTER,'utf8');
const mInv = Object.fromEntries(Object.entries(INVARIANTS).map(([k,f])=>[k,f(master)]));
const mSha = crypto.createHash('sha256').update(master).digest('hex');
console.log(`canonical master: omnichanneldash  sha=${mSha.slice(0,12)}`);
console.log(`invariants: ${Object.entries(mInv).map(([k,v])=>k+'='+v).join('  ')}\n`);
let drift=0;
for (const t of TARGETS){
  const f=path.join(ROOT,t,'lib/xtresseCore.js');
  if(!fs.existsSync(f)){console.log(`  ? MISSING      ${t}`);drift++;continue;}
  const c=fs.readFileSync(f,'utf8');
  const sha=crypto.createHash('sha256').update(c).digest('hex');
  const diffs=Object.keys(INVARIANTS).filter(k=>INVARIANTS[k](c)!==mInv[k]);
  if(sha===mSha){console.log(`  ✓ IN SYNC      ${t}  (byte-identical)`);continue;}
  if(diffs.length===0){console.log(`  · ok           ${t}  (invariants match; comments/helpers differ)`);continue;}
  drift++;
  console.log(`  ✗ DRIFT        ${t}  →  ${diffs.map(k=>k+': repo='+INVARIANTS[k](c)+' vs master='+mInv[k]).join(' | ')}`);
}
console.log(drift?`\n${drift} repo(s) drift on revenue/channel invariants — sync-core.sh or reconcile before trusting cross-dashboard ties.`:`\nAll cores share the canonical revenue/channel logic. ✓`);
process.exit(drift?1:0);
