#!/usr/bin/env python3
"""
Territory Expansion analysis for the 10 new 1099 markets (PPT slides 8-9).

Logic:
  - B2B orders only (tag contains 'b2b'); ADCS excluded from rep aggregates.
  - Map each B2B order's ship-to (province + zip3) into one of the 10 new territories.
  - Account = ship-to company @ zip (location-level, per the loyalty-report convention).
  - Each account's current rep = rep tag on its orders (most-recent / dominant).
  - CLAIMED = account already worked by an existing rep -> stays with that rep.
  - OPEN white space = territory addressable accounts that no rep owns -> 1099 game.
  - "Inconsequential" proof: $ each existing rep pulls from inside these 10 territories
    vs their total book.

Outputs CSVs in this folder; the workbook is built by build_workbook.py.
"""
import pandas as pd, numpy as np, re, json, sys

SRC = '/Users/samsood/Downloads/orders_export_1 4.csv'
OUT = '/Users/samsood/Documents/GitHub/omnichanneldash/scripts/account-reports'

# ---- canonical rep roster + tag aliases ----
EXISTING_TIER = ['Jamie Bergeron','Michelle Spencer','Dia Lamport','Cheryl Greiber','Tyler De Masi',
                 'Sonia Mace','Laura Mann','Michelle Boehle','Sherry Quinn','Denisse Schimelpfening',
                 'Julie Fetter','Taylor Bates','Becky Curry']
NEW_TIER = ['Heidi Fisher','Megan Gilbert','Amy Pierre','Gina Napoli','Bridget Selberg',
            'Morgan Hood','Carrie Dodge','James Tuckett']
REPS_1099 = ['Jim & Anne Weeks','Lexi Cavaliere','Sevi McCutcheon','Krista Taylor','Ryan Masa']
TIER = {}
for r in EXISTING_TIER: TIER[r]='Existing'
for r in NEW_TIER: TIER[r]='New'
for r in REPS_1099: TIER[r]='1099'

# alias -> canonical rep (tags carry name variants)
ALIASES = {
    'dia spangler lamport':'Dia Lamport','dia lamport':'Dia Lamport','dia spangler':'Dia Lamport',
    'jim weeks':'Jim & Anne Weeks','anne weeks':'Jim & Anne Weeks','jim & anne weeks':'Jim & Anne Weeks',
}
CANON = {r.lower(): r for r in TIER}
def rep_from_tags(tags):
    if not isinstance(tags,str): return None
    for raw in [t.strip() for t in tags.split(',')]:
        low = raw.lower()
        if low in CANON: return CANON[low]
        if low in ALIASES: return ALIASES[low]
    return None

# ---- territory definitions: (province set, zip3 set). zip3 wins where it overlaps a state. ----
def z3(z):
    z = re.sub(r'\D','', str(z))
    return z[:3] if len(z)>=3 else None

TERRITORIES = [
    # name, tier, province(s), zip3 set (None = whole state(s))
    ('Nevada (Las Vegas)',      1, {'NV'}, None),
    ('Dallas (DFW)',            1, {'TX'}, {'750','751','752','753','754','760','761','762'}),
    ('Ohio (Columbus/Cleveland)',1,{'OH'}, None),
    ('DC / NoVA',               1, {'DC'}, None),  # DC whole + VA zips handled below
    ('Long Island / Queens',    1, {'NY'}, {'110','111','113','114','115','116','117','118','119'}),
    ('Houston / South Texas',   2, {'TX'}, {'770','771','772','773','774','775','776','777','778','779',
                                            '780','781','782','783','784','785','786','787','788','789'}),
    ('Brooklyn / Staten Island',2, {'NY'}, {'112','103'}),
    ('Philadelphia / Pittsburgh',2,{'PA'}, {'190','191','192','193','194','150','151','152'}),
    ('Buffalo / Rochester / Albany',3,{'NY'},{'120','121','122','123','124','140','141','142','143','144','145','146','147'}),
    ('Mississippi / Alabama',   3, {'MS','AL'}, None),
]
NOVA_Z3 = {'201','220','221','222','223'}  # VA portion of DC/NoVA

def assign_territory(prov, zip_):
    z = z3(zip_)
    # DC / NoVA special: DC state, or VA NoVA zips
    if prov=='DC': return 'DC / NoVA'
    if prov=='VA' and z in NOVA_Z3: return 'DC / NoVA'
    for name, tier, provs, z3set in TERRITORIES:
        if name=='DC / NoVA': continue
        if prov in provs:
            if z3set is None: return name
            if z in z3set: return name
    return None

TER_TIER = {t[0]: t[1] for t in TERRITORIES}

def main():
    df = pd.read_csv(SRC, dtype=str, low_memory=False)
    df['Created at'] = pd.to_datetime(df['Created at'], errors='coerce', utc=True)
    for c in ['Total','Subtotal','Refunded Amount']:
        df[c+'_n'] = pd.to_numeric(df[c], errors='coerce').fillna(0)
    df['net'] = df['Total_n'] - df['Refunded Amount_n']

    def has(t,c):
        return isinstance(t,str) and c in [x.strip().lower() for x in t.split(',')]
    df['is_b2b'] = df['Tags'].apply(lambda t: has(t,'b2b'))
    df['is_adcs'] = df['Tags'].apply(lambda t: has(t,'adcs')) | \
                    df['Shipping Company'].fillna('').str.lower().str.contains('adcs')
    df['rep'] = df['Tags'].apply(rep_from_tags)

    # drop the brand's own house/sample account
    selfacct = df['Shipping Company'].fillna('').str.strip().str.lower().eq('xtresse')
    b = df[df['is_b2b'] & ~df['is_adcs'] & ~selfacct].copy()
    b['territory'] = [assign_territory(p,z) for p,z in zip(b['Shipping Province'], b['Shipping Zip'])]

    # ---------- REP IMPACT (inconsequential proof) : full book vs in-territory ----------
    rep_book = b.dropna(subset=['rep']).groupby('rep')['net'].sum()
    in_terr = b[b['territory'].notna()].dropna(subset=['rep']).groupby('rep')['net'].sum()
    rep_imp = pd.DataFrame({'total_book': rep_book, 'in_new_territories': in_terr}).fillna(0)
    rep_imp['pct_protected'] = (rep_imp['in_new_territories']/rep_imp['total_book']*100).round(1)
    rep_imp['tier'] = [TIER.get(r,'?') for r in rep_imp.index]
    rep_imp = rep_imp.sort_values('total_book', ascending=False)
    rep_imp.to_csv(f'{OUT}/rep_impact.csv')

    # ---------- ACCOUNT-LEVEL table inside territories ----------
    t = b[b['territory'].notna()].copy()
    t['company'] = t['Shipping Company'].fillna(t['Shipping Name']).fillna('(no company)').str.strip()
    t['acct_key'] = (t['company'].str.lower() + '|' + t['Shipping Zip'].fillna('').str.replace(' ','').str[:5])

    def agg_acct(g):
        # current rep = most recent rep tag seen on the account's orders
        gr = g.dropna(subset=['rep']).sort_values('Created at')
        rep = gr['rep'].iloc[-1] if len(gr) else None
        return pd.Series({
            'territory': g['territory'].iloc[0],
            'company': g['company'].iloc[0],
            'city': g['Shipping City'].dropna().iloc[0] if g['Shipping City'].notna().any() else '',
            'state': g['Shipping Province'].dropna().iloc[0] if g['Shipping Province'].notna().any() else '',
            'zip': (g['Shipping Zip'].dropna().iloc[0][:5] if g['Shipping Zip'].notna().any() else ''),
            'current_rep': rep,
            'rep_tier': TIER.get(rep,'') if rep else '',
            'orders': g['Name'].nunique(),
            'net_sales': round(g['net'].sum(),2),
            'last_order': g['Created at'].max(),
            'first_order': g['Created at'].min(),
        })
    acc = t.groupby('acct_key', dropna=False).apply(agg_acct).reset_index(drop=True)
    acc['status'] = np.where(acc['current_rep'].notna(), 'CLAIMED (stays w/ rep)', 'OPEN (1099 white space)')
    acc['tier'] = acc['territory'].map(TER_TIER)
    acc['last_order'] = pd.to_datetime(acc['last_order']).dt.date
    acc['first_order'] = pd.to_datetime(acc['first_order']).dt.date
    acc = acc.sort_values(['tier','territory','net_sales'], ascending=[True,True,False])
    acc.to_csv(f'{OUT}/territory_accounts.csv', index=False)

    # ---------- TERRITORY SUMMARY ----------
    rows=[]
    for name in [x[0] for x in TERRITORIES]:
        sub = acc[acc['territory']==name]
        claimed = sub[sub['current_rep'].notna()]
        openw = sub[sub['current_rep'].isna()]
        rows.append({
            'territory': name, 'tier': TER_TIER[name],
            'total_accounts': len(sub),
            'claimed_accts': len(claimed), 'claimed_sales': round(claimed['net_sales'].sum(),2),
            'open_accts': len(openw), 'open_sales': round(openw['net_sales'].sum(),2),
            'total_sales': round(sub['net_sales'].sum(),2),
        })
    ts = pd.DataFrame(rows)
    ts.to_csv(f'{OUT}/territory_summary.csv', index=False)

    # ---------- console summary ----------
    total_book_all = b.dropna(subset=['rep'])['net'].sum()
    in_terr_all = b[b['territory'].notna()].dropna(subset=['rep'])['net'].sum()
    print(f"\nWindow: {b['Created at'].min().date()} -> {b['Created at'].max().date()}")
    print(f"B2B (ex-ADCS) net sales: ${b['net'].sum():,.0f}  | rep-attributed: ${total_book_all:,.0f}")
    print(f"Net sales INSIDE the 10 new territories: ${t['net'].sum():,.0f}")
    print(f"  of which attributed to an EXISTING rep (claimed): ${in_terr_all:,.0f} "
          f"({in_terr_all/total_book_all*100:.1f}% of all rep book)")
    print('\n--- TERRITORY SUMMARY ---')
    print(ts.to_string(index=False))
    print('\n--- REP IMPACT (existing + new tier) ---')
    show = rep_imp[rep_imp['tier'].isin(['Existing','New'])]
    print(show[['tier','total_book','in_new_territories','pct_protected']].to_string())
    print(f"\nWrote: territory_accounts.csv ({len(acc)} accts), territory_summary.csv, rep_impact.csv")

if __name__=='__main__':
    main()
