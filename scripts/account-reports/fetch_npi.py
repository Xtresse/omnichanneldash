#!/usr/bin/env python3
"""
Real provider counts from the NPPES NPI registry (CMS, public) for the 5
Tier-1 metros. Counts board-registered Dermatology + Plastic Surgery
providers and unique practice locations per ZIP. (Medspas / aesthetic NP
clinics are largely NOT in NPPES, so this is a conservative REAL floor of
physician-led targets — medspas sit on top.)
"""
import urllib.request, urllib.parse, json, time, re, csv, sys

API='https://npiregistry.cms.hhs.gov/api/?version=2.1'
TAXONOMIES=['Dermatology','Plastic Surgery']

# All 10 territories: (label, state, [zip3 prefixes] or None for whole-state)
TIER1=[
 # ---- Tier 1 ----
 ('Nevada + Utah','NV',None),    # whole Nevada
 ('Nevada + Utah','UT',None),    # whole Utah

 ('Dallas (DFW)','TX',['750','751','752','753','754','760','761','762']),
 ('Ohio (Columbus/Cleveland)','OH',['430','431','432','433','440','441']),
 ('DC / NoVA','DC',None),                       # whole DC
 ('DC / NoVA','VA',['201','220','221','222','223']),  # Northern Virginia
 ('Long Island / Queens','NY',['110','111','113','114','115','116','117','118','119']),
 # ---- Tier 2 ----
 ('Houston / South Texas','TX',['770','771','772','773','774','775','776','777','778','779',
                                '780','781','782','783','784','785']),
 ('Brooklyn / Staten Island','NY',['112','103']),
 ('Philadelphia / Pittsburgh','PA',['190','191','192','193','194','150','151','152']),
 # ---- Tier 3 ----
 ('Buffalo / Rochester / Albany','NY',['120','121','122','123','124','140','141','142','143','144','145','146','147']),
 ('Mississippi / Alabama','MS',None),           # whole state
 ('Mississippi / Alabama','AL',None),           # whole state
]

def fetch(state, tax, postal):
    out=[]
    for skip in range(0,1001,200):
        q={'version':'2.1','enumeration_type':'','taxonomy_description':tax,'state':state,
           'limit':200,'skip':skip}
        if postal: q['postal_code']=postal+'*'
        url=API.split('?')[0]+'?'+urllib.parse.urlencode(q)
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url,timeout=40) as r:
                    d=json.loads(r.read()); break
            except Exception as e:
                if attempt==2: print('  ! fail',state,tax,postal,skip,e,file=sys.stderr); d={'results':[]}
                time.sleep(1.5)
        res=d.get('results') or []
        out+=res
        if len(res)<200: break
        time.sleep(0.2)
    return out

# zip5 -> {providers:set(npi), locations:set(addr|zip), metro}
zips={}
seen_combo=set()
for metro,state,prefixes in TIER1:
    plist=prefixes if prefixes else [None]
    for pre in plist:
        for tax in TAXONOMIES:
            key=(state,pre,tax)
            if key in seen_combo: continue
            seen_combo.add(key)
            for r in fetch(state,tax,pre):
                npi=r.get('number')
                for a in r.get('addresses',[]):
                    if a.get('address_purpose')!='LOCATION': continue
                    if a.get('state')!=state: continue
                    z5=re.sub(r'\D','',str(a.get('postal_code','')))[:5]
                    if len(z5)<5: continue
                    if prefixes and z5[:3] not in prefixes: continue
                    rec=zips.setdefault(z5,{'providers':set(),'locations':set(),'metro':metro})
                    rec['providers'].add(npi)
                    addr=(a.get('address_1','') or '').strip().lower()
                    rec['locations'].add(addr+'|'+z5)
            print(f'  {metro:28} {state} {pre or "(all)"} {tax:16} -> running zips={len(zips)}')

rows=[]
for z5,rec in sorted(zips.items()):
    rows.append((rec['metro'],z5,len(rec['providers']),len(rec['locations'])))
with open('/Users/samsood/Documents/GitHub/omnichanneldash/scripts/account-reports/npi_tier1_counts.csv','w',newline='') as f:
    w=csv.writer(f); w.writerow(['metro','zip','npi_providers','npi_locations']); w.writerows(rows)

from collections import defaultdict
agg=defaultdict(lambda:[0,0,0])
for m,z5,p,l in rows:
    agg[m][0]+=1; agg[m][1]+=p; agg[m][2]+=l
print('\n=== NPI Tier-1 (Dermatology + Plastic Surgery) ===')
for m,(zc,p,l) in agg.items():
    print(f'{m:30} zips_w_providers={zc:4}  providers={p:5}  unique clinic locations={l:5}')
print('\nwrote npi_tier1_counts.csv  (',len(rows),'zips )')
