import json, math, pathlib, collections, urllib.request, urllib.parse, concurrent.futures, datetime
ROOT=pathlib.Path(__file__).resolve().parents[1]
raw=json.loads((ROOT/'tools/raw-streets.json').read_text())
nodes=[];buckets=collections.defaultdict(list);edges=[]
def xy(p):return [round((p[0]+77.46)*88152,2),round((37.56-p[1])*111195,2)]
def node(p):
 x,y=p;k=(round(x),round(y))
 for dx in [-1,0,1]:
  for dy in [-1,0,1]:
   for i in buckets[(k[0]+dx,k[1]+dy)]:
    q=nodes[i]
    if math.hypot(q[0]-x,q[1]-y)<1.2:return i
 i=len(nodes);nodes.append(p);buckets[k].append(i);return i
classes={'Local':0,'Collector':1,'Minor Arterial':2,'Principal Arterial':3}
for f in raw['features']:
 a=f['attributes'];cls=classes.get(a['FunctionalClass'],-1)
 if a['StreetType'] in ['Alley','Private','Ramp','Highway Interchange','Highway']:cls=-1
 for path in f.get('geometry',{}).get('paths',[]):
  p=[xy(v) for v in path];l=sum(math.dist(p[i],p[i-1]) for i in range(1,len(p)))
  if len(p)<2 or l<2:continue
  aa,bb=node(p[0]),node(p[-1]);
  if aa==bb:continue
  edges.append({'a':aa,'b':bb,'p':p,'n':a.get('FullName') or 'Unnamed street','c':cls,'l':round(l,2),'speed':a.get('PostedSpeed'),'source':a['OBJECTID']})
adj=collections.defaultdict(list)
for i,e in enumerate(edges):
 if e['c']>=0:adj[e['a']].append(e['b']);adj[e['b']].append(e['a'])
seen=set();components=[]
for n in adj:
 if n in seen:continue
 group={n};stack=[n];seen.add(n)
 while stack:
  for v in adj[stack.pop()]:
   if v not in seen:seen.add(v);group.add(v);stack.append(v)
 components.append(group)
main=max(components,key=len)
for e in edges:
 if e['a'] not in main or e['b'] not in main:e['c']=-1
print('Graph:',len(nodes),'nodes,',len(edges),'edges; main component',len(main),'; next',sorted(map(len,components),reverse=True)[:5],flush=True)
BASE='https://services1.arcgis.com/k3vhq11XkBNeeOfM/ArcGIS/rest/services/'
def fetch_polys(name):
 try:
  u=BASE+name+'/FeatureServer/0/query?'+urllib.parse.urlencode({'f':'json','where':'1=1','outFields':'OBJECTID','outSR':4326,'returnGeometry':'true','geometryPrecision':5,'maxAllowableOffset':.00004,'resultRecordCount':1000})
  with urllib.request.urlopen(u,timeout=40) as r:d=json.load(r)
  rings=[]
  for f in d.get('features',[]):
   for ring in f.get('geometry',{}).get('rings',[]):
    if any(-77.53<p[0]<-77.4 and 37.515<p[1]<37.61 for p in ring):rings.append([xy(p) for p in ring])
  print(name,len(rings),flush=True);return name,rings
 except Exception as e:print(name,type(e).__name__,str(e),flush=True);return name,[]
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as p:polys=dict(p.map(fetch_polys,['Water_Poly','Park']))
d={'nodes':nodes,'edges':edges,'water':polys['Water_Poly'],'parks':polys['Park'],'source':{'name':'Richmond DPW Carriageway Centerlines','url':BASE+'CarriagewayCenterlines/FeatureServer/0','retrieved':'2026-11-02','extent':[-77.515,37.525,-77.405,37.605],'water':BASE+'Water_Poly/FeatureServer','parks':BASE+'Park/FeatureServer'},'seeds':[{'name':'The Fan','lon':-77.4662,'lat':37.5532},{'name':'Monroe Ward','lon':-77.447,'lat':37.5468},{'name':'Byrd Park','lon':-77.4847,'lat':37.5482}]}
(ROOT/'dist/data.js').write_text('window.RACE_DATA='+json.dumps(d,separators=(',',':'))+';\n')
print('Wrote data.js', (ROOT/'dist/data.js').stat().st_size,flush=True)
