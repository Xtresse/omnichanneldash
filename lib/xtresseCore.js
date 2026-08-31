// =============================================================================
// XTRESSÉ CANONICAL CORE  —  SINGLE SOURCE OF TRUTH FOR ALL DASHBOARDS
// =============================================================================
// This file is BYTE-FOR-BYTE IDENTICAL across every Xtressé dashboard repo
// (omnichanneldash, xtresse-leadershipdash, Sales-Rep-Dashboards, CRO_Tracker,
// xtresse-orders-tracker, xtresse-ops-tracker, xtresse-finance-tracker,
// DTC_Dashboard). Do NOT edit a single copy — edit the master and run
// scripts/sync-core to propagate, so the dashboards can never drift.
//
// It owns every rule that determines a NUMBER:
//   • Shop timezone + date bucketing            (America/Los_Angeles)
//   • Shopify Admin API client (client-creds)   (one query, one field set)
//   • Revenue netting                            net = CURRENT subtotal
//        (= subtotalPriceSet − refundsToSubtotal; excludes shipping & tax;
//         reflects refunds, cancellations and edits. We deliberately do NOT
//         subtract totalRefundedSet, which includes refunded shipping/tax and
//         over-subtracts.)
//   • Channel classification  B2B / DTC / ADCS
//   • Rep roster + attribution
//   • SKU → product family map + B2B focus SKUs
//
// Reconciled vs Shopify, May 2026: B2B May 1–30 = $1,013,743 / 469 rep orders.
// Same metric + same window ⇒ same number on every dashboard, by construction.
// =============================================================================

export const SHOP_TZ = 'America/Los_Angeles';
const API_VERSION = '2025-01';
const DEFAULT_STORE = 'ace1d0-26.myshopify.com';
const shopDomain = () =>
  process.env.SHOPIFY_STORE_DOMAIN || process.env.WINDSOR_ACCOUNT || DEFAULT_STORE;

export function hasShopifyCreds() {
  return Boolean(
    process.env.SHOPIFY_ADMIN_API_TOKEN ||
      process.env.XVIE_INTERNAL_TOKEN ||
      (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET) ||
      (process.env.XVIE_INTERNAL_CLIENT_ID && process.env.XVIE_INTERNAL_CLIENT_SECRET)
  );
}

// ---- Store-timezone date helpers -------------------------------------------
// Shopify Analytics (the number the team cross-checks against) buckets orders
// in the SHOP timezone. Order timestamps come back as UTC ISO; convert to the
// shop wall-clock so month boundaries tie. Without this, late-evening-PT orders
// (early next-day UTC) leak into the next month.
const _dtf = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHOP_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
export function toShopLocalISO(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const p = {};
  for (const part of _dtf.formatToParts(d)) p[part.type] = part.value;
  const hh = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hh}:${p.minute}:${p.second}`;
}
export const shopLocalDate = (iso) => toShopLocalISO(iso).slice(0, 10);

// ---- Tag parsing / rep roster / classification -----------------------------
export const REPS = {
  "Jamie Bergeron": ["Existing", "West"],
  "Michelle Spencer": ["Existing", "East"],
  "Dia Lamport": ["Existing", "East"],
  "Cheryl Greiber": ["Existing", "West"],
  "Denisse Schimelpfening": ["Existing", "West"],
  "Tyler De Masi": ["Existing", "East"],
  "Laura Mann": ["Existing", "West"],
  "Sherry Quinn": ["Existing", "East"],
  "Michelle Boehle": ["Existing", "West"],
  "Sonia Mace": ["Existing", "East"],
  "Taylor Bates": ["Existing", "East"],
  "Julie Fetter": ["Existing", "West"],
  "Becky Curry": ["Existing", "East"],
  "Ryan Masa": ["1099", "West"],
  "Heidi Fisher": ["New", "West"],
  "Gina Napoli": ["New", "East"],
  "Amy Pierre": ["New", "East"],
  "Megan Gilbert": ["New", "East"],
  "Bridget Selberg": ["New", "West"],
  "Carrie Dodge": ["New", "West"],
  "Morgan Hood": ["New", "East"],
  "Lexi Cavaliere": ["1099", "West"],
  "Jim & Anne Weeks": ["1099", "East"],
  "Sevi McCutcheon": ["1099", "East"],
  "Krista Taylor": ["1099", "West"],
  "Stephanie Lansdowne": ["1099", "West"],
  "Tom Scurti": ["1099", "East"],
  "Paul Onofrio": ["1099", "East"],
  "Sasha Parlin": ["1099", "West"],
  "Jamie Hayward": ["1099", "West"],
  "Laura Mulcahy": ["1099", "West"],
  "Stacy Martin": ["1099", "East"],
  "Steff Lundstrom": ["1099", "West"],
  "Maggie Seifert": ["1099", "East"],
};
export const TERRITORY_ORDER = ["Existing", "New", "1099"];

const norm = (s) =>
  String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

const VARIANTS = (() => {
  const m = {};
  for (const r of Object.keys(REPS)) m[norm(r)] = r;
  m[norm('Tyler DeMasi')] = 'Tyler De Masi';
  m[norm('jim and anne weeks')] = 'Jim & Anne Weeks';
  m[norm('jim weeks')] = 'Jim & Anne Weeks';
  m[norm('jim and anne')] = 'Jim & Anne Weeks';
  m[norm('anne weeks')] = 'Jim & Anne Weeks';
  m[norm('Dia Spangler Lamport')] = 'Dia Lamport';
  m[norm('lexi Calaviere')] = 'Lexi Cavaliere';
  // 2026-08-16 audit (Sam): "Cheryl Grieber" (transposed ei/ie typo) is used
  // as a standalone rep tag on 5 real B2B orders (#3571/3572/3585/3587/3628,
  // Feb–Aug 2026, ~$13.9K net) with no accompanying correctly-spelled tag —
  // findRep() returned null for these, dropping them out of her rep-level
  // attribution entirely (order count, net, and weighted President's Club
  // sales). Root cause of the Cheryl Greiber vs Laura Mann rank-4/5 swap.
  m[norm('Cheryl Grieber')] = 'Cheryl Greiber';
  return m;
})();

// Accepts an array OR any string format Shopify Flow / connectors emit:
// Python list literal, JSON array, or plain CSV. Format-agnostic ON PURPOSE so
// the row tag encoding can never break attribution again.
export function parseOrderTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  const stripped = String(raw).trim().replace(/^\[|\]$/g, '');
  const quoted = stripped.match(/['"]([^'"]*)['"]/g);
  if (quoted && quoted.length > 0) {
    return quoted.map((m) => m.replace(/^['"]|['"]$/g, '').trim()).filter(Boolean);
  }
  return stripped.split(',').map((t) => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

// canonical rep attribution. Returns repName | '__EXCLUDE__' (ADCS) | null.
export function findRep(tagsRaw) {
  const tags = parseOrderTags(tagsRaw);
  if (tags.length === 0) return null;
  for (const t of tags) {
    const lower = String(t || '').toLowerCase();
    if (lower.includes('adcs') || lower.includes('advanced derm')) return '__EXCLUDE__';
  }
  for (const t of tags) {
    const nt = norm(t);
    if (VARIANTS[nt]) return VARIANTS[nt];
  }
  return null;
}
export function territoryFor(rep) { return REPS[rep] ? REPS[rep][0] : null; }
export function regionFor(rep) { return REPS[rep] ? REPS[rep][1] : null; }

// SUBSTRING match on purpose (2026-07-15 unification): tags like
// "ADCS-AccountName" / "California-ADCS" must classify as ADCS. Exact-match
// (/^adcs$/) let them fall through to B2B/DTC — the same bug omni fixed in
// May 2026 (~$500K B2B gap vs leadership). Now matches findRep()'s
// __EXCLUDE__ check so the two signals can never disagree.
export function isAdcs(tagsRaw) {
  return parseOrderTags(tagsRaw).some((t) => /adcs/i.test(t) || /advanced derm/i.test(t));
}
export function isFirstOrder(tagsRaw) {
  return parseOrderTags(tagsRaw).some((t) => /^first order$/i.test(t));
}

const B2B_DISCOUNT_PATTERNS = [/^REP-/i, /^XVIE\d+/i, /^B2B-/i, /^ADCS-/i];

// Channel: 'ADCS' | 'B2B' | 'DTC'. THE one channel decision — every
// dashboard (omni, DTC dash, ops/finance trackers) must classify through
// this function so the numbers tie per-order.
//
// 2026-07-15 unification (Sam, "make sure both follow the exact same
// logic"): folded in omni's stronger signals that the core was missing —
//   • ADCS by DISCOUNT CODE substring (order #3831: code "ADCS Bulk
//     Pricing per SS-BC-KF" with a rep tag but no ADCS tag — must be
//     ADCS, not rep-attributed B2B; checked BEFORE findRep for that
//     reason).
//   • \b(rep|territory)\b tag words → B2B (matches omni's historical
//     behavior; a retail order never carries these).
// Signal order matters: ADCS ⊳ recognized rep ⊳ b2b/wholesale/rep-word
// tags ⊳ B2B code patterns ⊳ DTC. Explicit tagging always beats weaker
// signals — never reorder without reconciling omni vs DTC dash per-order.
export function classifyChannel({ tagsRaw, discountCodesRaw }) {
  if (isAdcs(tagsRaw)) return 'ADCS';
  const codes = parseOrderTags(discountCodesRaw);
  if (codes.some((c) => /adcs|advanced derm/i.test(c))) return 'ADCS';
  const rep = findRep(tagsRaw);
  if (rep && rep !== '__EXCLUDE__') return 'B2B';
  const tags = parseOrderTags(tagsRaw).map((t) => t.toLowerCase());
  if (tags.some((t) => t === 'b2b' || t === 'wholesale' || /\b(rep|territory)\b/.test(t))) return 'B2B';
  if (codes.some((c) => B2B_DISCOUNT_PATTERNS.some((re) => re.test(c)))) return 'B2B';
  return 'DTC';
}

// ---- SKU → family ----------------------------------------------------------
export const SKU_FAMILY = {
  "860011740100": "Gummies",
  "X-GN-045CT-001": "Gummies", "X-GN-060CT-001": "Gummies", "X-GN-060CT-003": "Gummies",
  "X-GN-060CT-BROWN": "Gummies", "X-GN-090CT-001": "Gummies", "X-GN-180CT-001": "Gummies",
  "X-GN-002CT-001": "Sachets", "X-GN-002CT-002": "Sachets", "X-GN-002CT-003": "Sachets",
  "X-GN-002CT-004": "Sachets", "X-GN-002CT-RAW": "Sachets",
  "X-FRC-30ML-CASE": "Serum", "X-FRC-30ML-001": "Serum",
  "X-XVIE-2ML-006": "XVIE", "X-XVIE-2ML-001": "XVIE", "X-XVIE-2ML-003": "XVIE", "X-XVIE-003": "XVIE",
  "XTR-SHPR-DBL": "Exclude", "test-nem-1234": "Exclude", "X-BAG-MKT": "Exclude",
  "X-TEE-F-XS": "Exclude", "X-TEE-F-S": "Exclude", "X-TEE-F-MD": "Exclude",
  "X-TEE-F-LG": "Exclude", "X-TEE-F-XL": "Exclude", "X-TEE-M-SM": "Exclude",
  "X-TEE-M-MD": "Exclude", "X-TEE-M-LG": "Exclude", "X-TEE-M-XL": "Exclude",
};
export function familyFor(sku) {
  if (!sku) return "Other";
  if (SKU_FAMILY[sku]) return SKU_FAMILY[sku];
  const u = String(sku).toUpperCase();
  if (u.startsWith("X-GN-002")) return "Sachets";
  if (u.startsWith("X-GN")) return "Gummies";
  if (u.includes("XVIE")) return "XVIE";
  if (u.includes("FRC")) return "Serum";
  if (u.startsWith("X-TEE") || u.startsWith("X-BAG") || u.startsWith("XTR-")) return "Exclude";
  return "Other";
}
export const FAMILY_ORDER = ["Gummies", "Serum", "XVIE", "Sachets"];
export const B2B_FOCUS_SKUS = {
  Serum:   new Set(["X-FRC-30ML-CASE"]),
  Gummies: new Set(["860011740100"]),
  XVIE:    null, // no dedicated B2B case SKU — count all XVIE
};

// ---- Shopify Admin API client ----------------------------------------------
let cachedToken = null;
// Credential priority: a static token wins outright (no exchange needed);
// otherwise client-credentials-exchange, preferring the general dashboard
// app (SHOPIFY_CLIENT_ID/SECRET) and falling back to xvie-internal-4 (the
// B2B/find-a-provider/loyalty write app, full scope superset — see
// ~/.claude/xvie-internal.env) when the former isn't configured.
async function getAccessToken() {
  if (process.env.SHOPIFY_ADMIN_API_TOKEN) return process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (process.env.XVIE_INTERNAL_TOKEN) return process.env.XVIE_INTERNAL_TOKEN;
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60000) return cachedToken.value;
  const clientId = process.env.SHOPIFY_CLIENT_ID || process.env.XVIE_INTERNAL_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET || process.env.XVIE_INTERNAL_CLIENT_SECRET;
  const res = await fetch(`https://${shopDomain()}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`Shopify token exchange failed: ${res.status}`);
  const json = await res.json();
  if (!json.access_token) throw new Error('Shopify token exchange returned no access_token');
  cachedToken = { value: json.access_token, expiresAt: now + (json.expires_in ? json.expires_in * 1000 : 86400000) };
  return cachedToken.value;
}
async function adminGraphQL(query, variables) {
  const token = await getAccessToken();
  const res = await fetch(`https://${shopDomain()}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
    next: { revalidate: 300 },
  });
  if (res.status === 401) { cachedToken = null; throw new Error('Shopify 401'); }
  if (!res.ok) throw new Error(`Shopify GraphQL failed: ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error('Shopify GraphQL errors: ' + JSON.stringify(json.errors).slice(0, 300));
  return json.data;
}

const money = (set) => (set && set.shopMoney ? set.shopMoney.amount : '');
const numericId = (gid) => (gid ? String(gid).split('/').pop() : '');
const mapFulfillment = (s) => (s === 'FULFILLED' ? 'fulfilled' : s === 'PARTIALLY_FULFILLED' ? 'partial' : null);

const ORDERS_QUERY = `
query Orders($q: String!, $cursor: String) {
  orders(first: 250, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus tags discountCodes email
      customer {
        id
        defaultAddress { city provinceCode province country zip }
        companyContactProfiles {
          roleAssignments(first: 10) {
            edges { node { companyLocation { id shippingAddress { city zip } } } }
          }
        }
      }
      purchasingEntity { __typename ... on PurchasingCompany { location { id } } }
      subtotalPriceSet { shopMoney { amount } }
      currentSubtotalPriceSet { shopMoney { amount } }
      totalPriceSet { shopMoney { amount } }
      currentTotalPriceSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      shippingAddress { address1 city company province provinceCode country countryCodeV2 zip latitude longitude }
      lineItems(first: 100) { edges { node {
        title sku quantity
        originalUnitPriceSet { shopMoney { amount } }
        totalDiscountSet { shopMoney { amount } }
      } } }
      refunds {
        refundLineItems(first: 50) { edges { node {
          quantity
          lineItem { sku }
        } } }
      }
    } }
  }
}`;

// Sum EXACT returned quantities per SKU across ALL refunds on an order.
// Shopify exposes refunds as a list; each refund has refundLineItems, each
// with a quantity and the original lineItem (whose sku we key on). We
// accumulate across every refund so multiple partial refunds on the same
// order add up. Refund lines missing a SKU are skipped (can't attribute a
// returned unit to a SKU). refundLineItems is capped at first:50 — ample for
// any real Xtressé order (a B2B order has a handful of distinct SKUs); we do
// not paginate refund line items. Returns a plain { sku: qty } map.
function returnedQtyBySku(order) {
  const out = {};
  const refunds = Array.isArray(order.refunds) ? order.refunds : [];
  for (const refund of refunds) {
    const rlis = (refund && refund.refundLineItems && refund.refundLineItems.edges) || [];
    for (const e of rlis) {
      const node = e && e.node;
      if (!node) continue;
      const sku = node.lineItem && node.lineItem.sku ? String(node.lineItem.sku).trim() : '';
      if (!sku) continue; // refund line with no SKU — can't attribute, skip
      const q = Number(node.quantity);
      if (!Number.isFinite(q) || q <= 0) continue;
      out[sku] = (out[sku] || 0) + q;
    }
  }
  return out;
}

// Flatten a Shopify order into canonical "Windsor-shaped" rows (one per line
// item) consumed by every dashboard. CANONICAL NET = current subtotal:
//   order_subtotal_price       = subtotalPriceSet            (original, excl ship/tax)
//   order_refunds_subtotal     = subtotalPriceSet − currentSubtotalPriceSet
//   ⇒ net = order_subtotal_price − order_refunds_subtotal = currentSubtotalPriceSet
// order_created_at is SHOP-LOCAL so all windowing/bucketing is store-TZ.
//
// CANCELLED / VOIDED orders (B2B Net-Terms voids — the #5104 / Selberg
// cancel-rebill pattern). The order pull uses `status:any`, so cancelled
// orders ARE present (a cancelled original and its rebill both come back).
// A cancellation must contribute ZERO net: no cash was collected, and the
// rebill carries the real revenue. Shopify does not always emit a refund for
// a Net-Terms void (currentSubtotalPriceSet can stay equal to subtotal, so
// the refunds_subtotal signal is 0), so we cannot rely on the refund delta.
// Instead, when order.cancelledAt is set we force order_refunds_subtotal =
// subtotalPriceSet ⇒ net = gross − gross = 0. The rebill (uncancelled)
// stands on its own, so there is no double-subtraction.
function orderToRows(order) {
  const a = order.shippingAddress || {};
  const def = (order.customer && order.customer.defaultAddress) || {};
  // Stable Shopify CompanyLocation id, when the order has a B2B
  // purchasingEntity — ported from Sales-Rep-Dashboards' 2026-08-12 fix
  // (commit aa374c2, "make it uniform across all dashboards" per Sam).
  // See that repo's lib/repData.js for the full incident writeup.
  const pe = order.purchasingEntity;
  const companyLocationId =
    pe && pe.__typename === 'PurchasingCompany' && pe.location ? numericId(pe.location.id) : '';
  // Fallback: the ordering CONTACT's own standing CompanyLocation role
  // assignment, for orders that skip B2B attribution entirely.
  const roleAssignments = (
    (order.customer && order.customer.companyContactProfiles) || []
  ).flatMap((profile) => ((profile.roleAssignments && profile.roleAssignments.edges) || []).map((e) => e.node));
  let customerCompanyLocationId = '';
  if (roleAssignments.length === 1) {
    customerCompanyLocationId = numericId(roleAssignments[0].companyLocation && roleAssignments[0].companyLocation.id);
  } else if (roleAssignments.length > 1) {
    const orderCity = (a.city || '').trim().toLowerCase();
    const orderZip = (a.zip || '').trim();
    const matches = roleAssignments.filter((r) => {
      const loc = r.companyLocation && r.companyLocation.shippingAddress;
      if (!loc) return false;
      return (loc.city || '').trim().toLowerCase() === orderCity && (loc.zip || '').trim() === orderZip;
    });
    if (matches.length === 1) {
      customerCompanyLocationId = numericId(matches[0].companyLocation.id);
    }
  }
  const sub = parseFloat(money(order.subtotalPriceSet)) || 0;
  const curSub = parseFloat(money(order.currentSubtotalPriceSet)) || 0;
  // EXACT per-SKU returned quantities (summed across all refunds on the
  // order). Additive new field; consumers compute exact net units per SKU as
  // gross qty − returned qty. Does NOT affect net dollars (still the
  // current-subtotal delta below) or any pre-existing behavior.
  const returnedBySku = returnedQtyBySku(order);
  const isCancelled = Boolean(order.cancelledAt);
  // Cancelled ⇒ net 0: subtract the full gross. Otherwise normal refund delta.
  const refundsSubtotal = isCancelled ? sub : Math.max(0, sub - curSub);
  const tags = Array.isArray(order.tags) ? order.tags : [];
  const codes = Array.isArray(order.discountCodes) ? order.discountCodes : [];
  const base = {
    order_id: numericId(order.id),
    order_name: order.name || '',
    order_created_at: toShopLocalISO(order.createdAt),
    order_created_at_utc: order.createdAt || '',
    order_financial_status: order.displayFinancialStatus || '',
    order_fulfillment_status: mapFulfillment(order.displayFulfillmentStatus),
    order_subtotal_price: money(order.subtotalPriceSet),
    order_gross_sales: money(order.subtotalPriceSet),
    order_total_price_amount: money(order.currentTotalPriceSet),
    order_total_price: money(order.currentTotalPriceSet),
    order_total_discounts: money(order.totalDiscountsSet),
    order_total_shipping_price: money(order.totalShippingPriceSet),
    // For cancelled orders refundsSubtotal == gross ⇒ net = gross − gross = 0.
    // This is read unconditionally by every consumer, so it is the single
    // lever that zeroes out cancellations. (order_returns_amount stays the
    // old Windsor refund-row signal and is only read on refund offset rows.)
    order_refunds_subtotal: String(refundsSubtotal),
    order_returns_amount: '',
    // EXACT returned units per SKU, summed across all refunds on this order
    // (sku -> returned qty). JSON-encoded so it rides the flat row shape like
    // order_tags. Consumers (e.g. the XVIE accelerator) read this to compute
    // exact net units = gross qty − returned qty per SKU, instead of a
    // proportional approximation. Empty object when the order has no refunds.
    order_returned_qty_by_sku: JSON.stringify(returnedBySku),
    order_cancelled_at: order.cancelledAt || '',
    order_tags: JSON.stringify(tags),
    order_discount_codes: JSON.stringify(codes),
    order_email: order.email || '',
    order_customer_id: numericId(order.customer && order.customer.id) || (order.email || '').toLowerCase(),
    order_company_location_id: companyLocationId,
    order_customer_company_location_id: customerCompanyLocationId,
    order_shipping_address: a.address1 || '',
    order_shipping_address_city: a.city || '',
    order_shipping_address_province: a.province || a.provinceCode || '',
    order_shipping_address_zip: a.zip || '',
    // Shopify geocodes most ship-to addresses → exact rooftop lat/lng. Carried
    // through for the ZIP heat map (preferred over ZIP-centroid geocoding).
    order_shipping_address_lat: a.latitude != null ? a.latitude : '',
    order_shipping_address_lng: a.longitude != null ? a.longitude : '',
    order_shipping_address_country: a.country || a.countryCodeV2 || '',
    order_shipping_address_company: a.company || '',
    customer_default_address__city: def.city || a.city || '',
    customer_default_address__province_code: def.provinceCode || a.provinceCode || '',
  };
  const lis = (order.lineItems && order.lineItems.edges) || [];
  if (lis.length === 0) {
    return [{ ...base, line_item__title: '', line_item__sku: '', line_item__quantity: '', line_item__price: '', line_item__total_discount: '', line_item__returned_quantity: '' }];
  }
  // Multiple sale lines can share a SKU; the per-order returnedBySku total is
  // the authoritative net basis (consumers should net per-SKU at the order
  // level via order_returned_qty_by_sku). line_item__returned_quantity below
  // surfaces the order's total returned qty for that line's SKU on the FIRST
  // line carrying that SKU (zero on subsequent duplicate-SKU lines) so a naive
  // per-line sum still equals the exact per-order returned total without
  // double-counting. Net-of-returns logic should prefer the order-level map.
  const seenSku = new Set();
  return lis.map((le) => {
    const li = le.node;
    const sku = li.sku || '';
    let retQty = '';
    if (sku && Object.prototype.hasOwnProperty.call(returnedBySku, sku)) {
      retQty = seenSku.has(sku) ? '0' : String(returnedBySku[sku]);
      seenSku.add(sku);
    }
    return {
      ...base,
      line_item__title: li.title || '',
      line_item__sku: sku,
      line_item__quantity: li.quantity == null ? '' : String(li.quantity),
      line_item__price: money(li.originalUnitPriceSet),
      line_item__total_discount: money(li.totalDiscountSet),
      line_item__returned_quantity: retQty,
    };
  });
}

async function fetchOrders(q) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 200; i++) {
    const data = await adminGraphQL(ORDERS_QUERY, { q, cursor });
    const conn = data.orders;
    for (const e of conn.edges) out.push(e.node);
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}

// Quarterly shards fetched concurrently (cursor pagination is sequential per
// query, so sharding is the only way to parallelize the cold full pull).
function quarterShards(fromISO, toISO) {
  const start = new Date(fromISO + 'T00:00:00Z');
  const end = toISO ? new Date(toISO + 'T00:00:00Z') : new Date();
  const shards = [];
  let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cur <= end) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 3, 1));
    const lo = cur.toISOString().slice(0, 10);
    const hi = new Date(next.getTime() - 86400000).toISOString().slice(0, 10);
    // status:any so cancelled/voided orders are included (then netted to 0 in
    // orderToRows). Without it Shopify defaults to open orders and silently
    // drops cancellations, diverging from Shopify net sales.
    shards.push(`status:any created_at:>=${lo} created_at:<=${hi}`);
    cur = next;
  }
  return shards;
}

// Date range pull. Shopify evaluates bare-date created_at in the SHOP timezone,
// so the window is store-TZ — matching order_created_at (also store-local).
export async function fetchShopifyRows({ from, to } = {}) {
  const lo = from || '2024-01-01';
  // Default window-end = TODAY in the SHOP timezone (Pacific), matching how
  // orders are bucketed (shopLocalDate). UTC toISOString() rolled the day
  // forward in the late-afternoon PT, pulling tomorrow's empty window.
  const hi = to || shopLocalDate(new Date().toISOString());
  // pad one UTC day on each side so store-TZ boundary orders aren't missed,
  // then the consumer windows precisely by shop-local order_created_at.
  // status:any so cancelled/voided orders are included (netted to 0 below).
  const orders = await fetchOrders(`status:any created_at:>=${lo} created_at:<=${hi}`);
  const rows = [];
  for (const o of orders) for (const r of orderToRows(o)) rows.push(r);
  return rows;
}

// Full-history pull (store opened 2024), quarterly-sharded for speed.
export async function fetchShopifyAllRows(fromISO = '2024-01-01') {
  const shards = quarterShards(fromISO);
  const results = await Promise.all(shards.map((q) => fetchOrders(q)));
  const rows = [];
  for (const o of results.flat()) for (const r of orderToRows(o)) rows.push(r);
  return rows;
}
