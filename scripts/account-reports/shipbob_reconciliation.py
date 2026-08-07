#!/usr/bin/env python3
"""Reconciliation CSV for ShipBob-bound orders (tag:SHIPBOB, excl Xvie/test), same style as Scale3PL."""
import os, json, urllib.request, csv, pathlib
REPO = pathlib.Path(__file__).resolve().parents[2]
ENV = REPO / ".env.local"
OUT = REPO / "scripts" / "account-reports" / "shipbob_reconciliation_0623.csv"
SINCE = os.environ.get("SCALE3PL_SINCE", "2026-06-23T18:00:00Z")
API = "2025-01"
STOP = {"b2b","dtc","gummy","bundle","serum","first order","first","first fr order","first xvie",
        "dtcbox","subscription","subscription first order","subscription recurring order",
        "order fulfillment guru","shipbob","shipbob ga","shipbob-b2b","scale3pl","microsite",
        "net terms","xvie","junetierup","ofg:routing rules match","first order "}

for line in ENV.read_text().splitlines():
    m = line.strip()
    if "=" in m and not m.startswith("#"):
        k, v = m.split("=", 1); os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
STORE = os.environ.get("SHOPIFY_STORE_DOMAIN", "ace1d0-26.myshopify.com")
tok = json.load(urllib.request.urlopen(urllib.request.Request(
    f"https://{STORE}/admin/oauth/access_token",
    data=json.dumps({"client_id": os.environ["SHOPIFY_CLIENT_ID"], "client_secret": os.environ["SHOPIFY_CLIENT_SECRET"], "grant_type": "client_credentials"}).encode(),
    headers={"Content-Type": "application/json"})))["access_token"]

Q = """query($q:String!,$after:String){ orders(first:100, after:$after, query:$q, sortKey:CREATED_AT){
 edges{ node{ name createdAt displayFinancialStatus displayFulfillmentStatus tags totalPriceSet{shopMoney{amount}}
  shippingAddress{ name company address1 address2 city provinceCode zip phone }
  customer{ email phone }
  lineItems(first:50){ edges{ node{ quantity sku title } } } } }
 pageInfo{ hasNextPage endCursor } } }"""

def fetch():
    q = f"created_at:>='{SINCE}' fulfillment_status:unfulfilled tag:SHIPBOB -tag:xvie"
    out, after = [], None
    while True:
        d = json.load(urllib.request.urlopen(urllib.request.Request(
            f"https://{STORE}/admin/api/{API}/graphql.json",
            data=json.dumps({"query": Q, "variables": {"q": q, "after": after}}).encode(),
            headers={"Content-Type": "application/json", "X-Shopify-Access-Token": tok})))
        c = d["data"]["orders"]; out += [e["node"] for e in c["edges"]]
        if c["pageInfo"]["hasNextPage"]: after = c["pageInfo"]["endCursor"]
        else: return out

def is_test(n):
    e = ((n.get("customer") or {}).get("email") or "").lower()
    return "samukhsood+" in e or n["displayFinancialStatus"] in ("VOIDED", "REFUNDED")

rows = [n for n in fetch() if not is_test(n)]
b2b = sum(1 for n in rows if "b2b" in [t.lower() for t in n["tags"]])
with open(OUT, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["Order","Created (UTC)","Channel","Rep","Fulfillment","Financial","Total USD",
                "Ship To Name","Company","Address1","Address2","City","State","Zip","Phone","Email","Items"])
    for n in rows:
        sa = n.get("shippingAddress") or {}
        ch = "b2b" if "b2b" in [t.lower() for t in n["tags"]] else "dtc"
        rep = ", ".join(t for t in n["tags"] if t.lower() not in STOP)
        phone = sa.get("phone") or (n.get("customer") or {}).get("phone") or ""
        items = "; ".join(f"{li['node']['quantity']}x {li['node']['title']} ({li['node']['sku']})" for li in n["lineItems"]["edges"])
        w.writerow([n["name"], n["createdAt"][:16].replace("T"," "), ch, rep,
                    n["displayFulfillmentStatus"], n["displayFinancialStatus"],
                    n["totalPriceSet"]["shopMoney"]["amount"], sa.get("name") or "", sa.get("company") or "",
                    sa.get("address1") or "", sa.get("address2") or "", sa.get("city") or "",
                    sa.get("provinceCode") or "", sa.get("zip") or "", phone,
                    (n.get("customer") or {}).get("email") or "", items])
print(f"{len(rows)} ShipBob orders (B2B {b2b} / DTC {len(rows)-b2b}) -> {OUT.name}")
