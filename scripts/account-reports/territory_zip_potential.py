#!/usr/bin/env python3
"""
ZIP-level white-space + potential for the 10 new 1099 territories (DATA PREP).
Emits zip_potential.csv and territory_rollup.csv, consumed by build_workbook.py.

Per ZIP the 1099 can work (deck-named geography):
  - target clinics = (population / PERSONS_PER_CLINIC) * income_factor
    (derm + medspa + plastic + aesthetic; ~1 per 10k US, scaled by local income)
  - our existing accounts (fenced/carved out for the current rep)
  - OPEN clinics = target - our accounts  (1099 runway)
  - annual $ potential = open clinics * ANNUAL_PER_ACCOUNT ($3,500 conservative;
    our mature accounts run $4,576/yr, Dallas runs $3,489/yr)
NPI real derm+plastic provider/clinic counts (Tier-1 metros) merged for cross-check.
"""
import sqlite3, glob, os, json, re
import pandas as pd

OUT='/Users/samsood/Documents/GitHub/omnichanneldash/scripts/account-reports'
DB=glob.glob(os.path.expanduser('~/.uszipcode/*.sqlite'))[0]
PERSONS_PER_CLINIC=10000
ANNUAL_PER_ACCOUNT=3500

def z3(z):
    d=re.sub(r'\D','',str(z)); return d[:3] if len(d)>=3 else None
NOVA={'201','220','221','222','223'}
DEFS=[  # name, tier, states, zip3 set (None=whole state). Scoped to deck-named metros.
 ('Nevada + Utah',1,{'NV','UT'},None),
 ('Dallas (DFW)',1,{'TX'},{'750','751','752','753','754','760','761','762'}),
 ('Ohio (Columbus/Cleveland)',1,{'OH'},{'430','431','432','433','440','441'}),
 ('Long Island / Queens',1,{'NY'},{'110','111','113','114','115','116','117','118','119'}),
 ('Houston / South Texas',2,{'TX'},{'770','771','772','773','774','775','776','777','778','779',
                                    '780','781','782','783','784','785'}),
 ('Brooklyn / Staten Island',2,{'NY'},{'112','103'}),
 ('Philadelphia / Pittsburgh',2,{'PA'},{'190','191','192','193','194','150','151','152'}),
 ('Buffalo / Rochester / Albany',3,{'NY'},{'120','121','122','123','124','140','141','142','143','144','145','146','147'}),
 ('Mississippi / Alabama',3,{'MS','AL'},None),
]
TIERN={d[0]:d[1] for d in DEFS}; TIERN['DC / NoVA']=1
def territory_of(state,zip_):
    s=str(state).strip().upper(); z=z3(zip_)
    if s=='DC': return 'DC / NoVA'
    if s=='VA' and z in NOVA: return 'DC / NoVA'
    for name,tier,states,z3set in DEFS:
        if s in states:
            if z3set is None: return name
            if z in z3set: return name
    return None

# slide 8/9 addressable + slide 10 1099 monthly contribution (Mo6 / Mo12, $K)
DECK={'Nevada + Utah':(350,70,95),'Dallas (DFW)':(525,78,105),'Ohio (Columbus/Cleveland)':(450,68,90),
 'DC / NoVA':(450,72,100),'Long Island / Queens':(450,70,95),'Houston / South Texas':(550,60,85),
 'Brooklyn / Staten Island':(300,52,70),'Philadelphia / Pittsburgh':(400,55,75),
 'Buffalo / Rochester / Albany':(240,40,55),'Mississippi / Alabama':(175,38,50)}

states=set()
for _,_,ss,_ in DEFS: states|=ss
states|={'VA','DC'}
q=("SELECT zipcode,major_city,county,state,population,median_household_income FROM simple_zipcode "
   "WHERE state IN (%s) AND zipcode_type='STANDARD' AND population>0")%(','.join('?'*len(states)))
con=sqlite3.connect(DB)
z=pd.read_sql_query(q,con,params=sorted(states))
REF=con.execute("SELECT sum(median_household_income*population)*1.0/sum(population) FROM simple_zipcode "
                "WHERE zipcode_type='STANDARD' AND population>0 AND median_household_income>0").fetchone()[0]
z['zipcode']=z['zipcode'].astype(str).str.zfill(5)
z['territory']=[territory_of(st,zp) for st,zp in zip(z['state'],z['zipcode'])]
z=z[z['territory'].notna()].copy()
z['tier']=z['territory'].map(TIERN)

acc=pd.DataFrame(json.load(open(f'{OUT}/accounts_attributed.json')))
acc['zip5']=acc['zip'].astype(str).str.replace(r'\D','',regex=True).str[:5].str.zfill(5)
acc_by_zip=acc.groupby('zip5').agg(our_accts=('company','size'),our_net=('netSales','sum'))
owner_by_terr=acc.groupby('territory').apply(lambda g: g.groupby('assignedRep').netSales.sum().idxmax())

# NPI real derm+plastic counts (Tier-1 metros)
npi=pd.read_csv(f'{OUT}/npi_tier1_counts.csv',dtype={'zip':str})
npi['zip']=npi['zip'].str.zfill(5)
npi_by_zip=npi.set_index('zip')[['npi_providers','npi_locations']]

z=z.merge(acc_by_zip,left_on='zipcode',right_index=True,how='left')
z=z.merge(npi_by_zip,left_on='zipcode',right_index=True,how='left')
z['our_accts']=z['our_accts'].fillna(0).astype(int)
# Nevada + Utah: James Tuckett is being removed entirely — ALL existing accounts in this
# territory TRANSFER to the new 1099, so nothing is fenced (open clinics = full target).
TRANSFER_TERR={'Nevada + Utah'}
z['transfer']=z['territory'].isin(TRANSFER_TERR)
z.loc[z['transfer'],'our_accts']=0
inc=pd.to_numeric(z['median_household_income'],errors='coerce')
z['income_factor']=(inc/REF).pow(0.5).clip(0.5,1.5).fillna(1.0)
z['target_clinics']=(z['population']/PERSONS_PER_CLINIC*z['income_factor']).round().astype(int)
z['open_clinics']=(z['target_clinics']-z['our_accts']).clip(lower=0)
z['annual_potential']=z['open_clinics']*ANNUAL_PER_ACCOUNT
z['current_owner']=z['territory'].map(owner_by_terr)
z['npi_providers']=z['npi_providers'].astype('Int64')
z['npi_locations']=z['npi_locations'].astype('Int64')
z=z.sort_values(['tier','territory','annual_potential'],ascending=[True,True,False])

cols=['territory','tier','state','county','major_city','zipcode','population','median_household_income',
      'income_factor','target_clinics','npi_providers','npi_locations','our_accts','open_clinics',
      'annual_potential','current_owner']
z[cols].to_csv(f'{OUT}/zip_potential.csv',index=False)

# territory rollup
roll=z.groupby('territory').agg(zips=('zipcode','size'),pop=('population','sum'),target=('target_clinics','sum'),
        npi_loc=('npi_locations','sum'),npi_prov=('npi_providers','sum'),
        ours=('our_accts','size'),our_accts=('our_accts','sum'),open=('open_clinics','sum'),
        tam=('annual_potential','sum')).reset_index()
roll['tier']=roll['territory'].map(TIERN)
roll['owner']=roll['territory'].map(owner_by_terr)
roll['deck_addr']=roll['territory'].map(lambda t:DECK[t][0])
roll['deck_mo6']=roll['territory'].map(lambda t:DECK[t][1]*1000)
roll['deck_mo12']=roll['territory'].map(lambda t:DECK[t][2]*1000)
roll['deck_mo12_annual']=roll['territory'].map(lambda t:DECK[t][2]*12000)
roll=roll.sort_values(['tier','territory'])
roll.to_csv(f'{OUT}/territory_rollup.csv',index=False)

print('wrote zip_potential.csv ({:,} zips) + territory_rollup.csv'.format(len(z)))
print('TOT: target {:,} | NPI loc {:,} | open {:,} | TAM ${:,}/yr'.format(
    int(z.target_clinics.sum()),int(z.npi_locations.sum()),int(z.open_clinics.sum()),int(z.annual_potential.sum())))
