#!/usr/bin/env python3
"""Emit one clean JSON record per B2B order for the canonical Node resolver."""
import pandas as pd, json
SRC='/Users/samsood/Downloads/orders_export_1 4.csv'
OUT='/Users/samsood/Documents/GitHub/omnichanneldash/scripts/account-reports/orders_raw.json'
df=pd.read_csv(SRC,dtype=str,low_memory=False)
df['Created at']=pd.to_datetime(df['Created at'],errors='coerce',utc=True)
for c in ['Total','Refunded Amount']:
    df[c+'_n']=pd.to_numeric(df[c],errors='coerce')

def firstnn(s):
    s=s.dropna()
    return s.iloc[0] if len(s) else None

recs=[]
for name,g in df.groupby('Name'):
    g=g.sort_values('Created at')
    tags=firstnn(g['Tags']) or ''
    if 'b2b' not in [t.strip().lower() for t in str(tags).split(',')]: continue
    total=g['Total_n'].dropna()
    ref=g['Refunded Amount_n'].dropna()
    net=(total.iloc[0] if len(total) else 0)-(ref.iloc[0] if len(ref) else 0)
    dt=g['Created at'].dropna()
    recs.append({
        'uniqueId':name,
        'tags':str(tags),
        'company':(firstnn(g['Shipping Company']) or firstnn(g['Shipping Name']) or '(no company)').strip(),
        'city':firstnn(g['Shipping City']) or '',
        'state':firstnn(g['Shipping Province']) or '',
        'zip':(firstnn(g['Shipping Zip']) or ''),
        'date':(dt.iloc[-1].strftime('%Y-%m-%d') if len(dt) else ''),
        'netSales':round(float(net),2),
    })
json.dump(recs,open(OUT,'w'))
print('wrote',len(recs),'b2b orders ->',OUT)
