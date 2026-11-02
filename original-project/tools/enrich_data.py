"""Fetch authoritative spatial supplements; preserve the original graph IDs."""
import json, urllib.request, urllib.parse, pathlib, concurrent.futures, math, re, collections, hashlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
CITY='https://services1.arcgis.com/k3vhq11XkBNeeOfM/ArcGIS/rest/services/'
TRAFFIC='https://services.arcgis.com/p5v98VHDX9Atv3l7/arcgis/rest/services/VDOT_Bidirectional_Traffic_Volume_2025/FeatureServer/0'
def get(url,params=None):
 if params:url+='?'+urllib.parse.urlencode(params)
 with urllib.request.urlopen(url,timeout=45) as r:d=json.load(r)
 if d.get('error'):raise ValueError(str(d['error']))
 return d
def inspect(kv):
 name,u=kv;d=get(u,{'f':'json'});print(name,[(x['name'],x.get('alias')) for x in d.get('fields',[])],flush=True)

FUNCTIONAL={'Local':0,'Collector':1,'Minor Arterial':2,'Principal Arterial':3}
LIMITED_ACCESS_TYPES={'Ramp','Highway','Highway Interchange'}
LIMITED_ACCESS_CLASSES={'Freeway','Interchange Ramps'}
def dataset_version(d):
 """Hash of the street graph. Worksheets and sessions store node and edge IDs, which are only valid for this graph."""
 graph=json.dumps({'nodes':d['nodes'],'edges':[[e['a'],e['b'],e['source'],e['c']] for e in d['edges']]},separators=(',',':'))
 return 'richmond-centerlines-'+d['source']['retrieved']+'-'+hashlib.sha256(graph.encode()).hexdigest()[:12]
def xy(p):return [round((p[0]+77.46)*88152,2),round((37.56-p[1])*111195,2)]
def distance_segment(p,a,b):
 dx,dy=b[0]-a[0],b[1]-a[1];t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy or 1)))
 return math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)
def fetch_features(spec):
 key,url,fields=spec;features=[];offset=0
 while True:
  d=get(url+'/query',{'f':'json','where':'1=1','outFields':fields,'outSR':4326,'returnGeometry':'true','geometry':'-77.515,37.525,-77.405,37.605','geometryType':'esriGeometryEnvelope','inSR':4326,'spatialRel':'esriSpatialRelIntersects','resultOffset':offset,'resultRecordCount':1000})
  features+=d.get('features',[])
  if not d.get('exceededTransferLimit'):break
  offset+=len(d['features'])
  if offset>20000:raise ValueError('Unexpectedly large supplement')
 print(key,len(features),'records',str(features[0].get('attributes') if features else '')[:450],flush=True)
 return key,features
if __name__=='__main__':
 specs=[('signals',CITY+'Signalized_Intersections/FeatureServer/15','OBJECTID,intersecti,location,status'),('traffic',TRAFFIC,'OBJECTID,ADT,DATA_DATE,ROUTE_COMMON_NAME,START_LABEL,END_LABEL')]+[(key,CITY+'HealthAndSafety1/FeatureServer/'+str(idx),'*') for key,idx in [('EMS',3),('Fire',4),('Hospital',5),('Police',9)]]
 if (ROOT/'tools/enrichment-raw.json').exists():raw=json.loads((ROOT/'tools/enrichment-raw.json').read_text())
 else:
  with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:raw=dict(pool.map(fetch_features,specs))
 (ROOT/'tools/enrichment-raw.json').write_text(json.dumps(raw,separators=(',',':')))
 d=json.loads((ROOT/'dist/data.js').read_text().removeprefix('window.RACE_DATA=').rstrip(';\n'))
 signal_points=[]
 for f in raw['signals']:
  g=f.get('geometry',{});a=f['attributes'];points=g.get('points') or ([[g['x'],g['y']]] if 'x' in g else [])
  if str(a.get('status','')).lower()!='in service':continue
  for p in points:signal_points.append({'p':xy(p),'id':a['OBJECTID'],'intersection':a.get('intersecti'),'location':a.get('location'),'status':a.get('status')})
 grid=collections.defaultdict(list)
 for f in raw['traffic']:
  a=f['attributes'];adt=a.get('ADT')
  if not isinstance(adt,(int,float)) or adt<=0:continue
  for path in f.get('geometry',{}).get('paths',[]):
   points=[xy(p) for p in path]
   for start,end in zip(points,points[1:]):
    if math.dist(start,end)<1:continue
    segment=(start,end,a)
    for gx in range(math.floor((min(start[0],end[0])-25)/100),math.floor((max(start[0],end[0])+25)/100)+1):
     for gy in range(math.floor((min(start[1],end[1])-25)/100),math.floor((max(start[1],end[1])+25)/100)+1):grid[(gx,gy)].append(segment)
 matches=0
 for e in d['edges']:
  if e['c']<0:continue
  a,b=d['nodes'][e['a']],d['nodes'][e['b']];dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
  found=[]
  for t in [.25,.5,.75]:
   p=[a[0]+t*dx,a[1]+t*dy];best=25;match=None
   for sa,sb,attrs in grid[(math.floor(p[0]/100),math.floor(p[1]/100))]:
    vx,vy=sb[0]-sa[0],sb[1]-sa[1];align=abs((dx*vx+dy*vy)/(length*math.hypot(vx,vy) or 1))
    if align<.9:continue
    dist=distance_segment(p,sa,sb)
    if dist<best:best=dist;match=attrs
   if match:found.append(match)
  if len(found)>=2:
   counts=collections.Counter(a['OBJECTID'] for a in found);key,count=counts.most_common(1)[0]
   if count>=2:
    a=next(a for a in found if a['OBJECTID']==key);e['adt']={'value':a['ADT'],'year':2025,'id':key,'date':a.get('DATA_DATE'),'name':a.get('ROUTE_COMMON_NAME'),'method':'spatial alignment within 25m; >=2 of 3 samples'};matches+=1
 facilities=[]
 for kind in ['EMS','Fire','Hospital','Police']:
  for f in raw[kind]:
   a=f['attributes'];g=f.get('geometry',{})
   if 'x' not in g:continue
   p=xy([g['x'],g['y']]);name=next((v for k,v in a.items() if k.upper() in ['NAME','FACILITY','FACILITY_NAME','STATION','STATION_NAME'] and v),None)
   if not name:name=kind+' facility '+str(a.get('OBJECTID',a.get('OBJECTID_1','')))
   facilities.append({'name':str(name),'kind':kind,'p':p,'status':a.get('STATUS'),'address':str(a.get('ADDRESS',a.get('Address',''))),'sourceKinds':[kind],'sourceId':a.get('OBJECTID',a.get('OBJECTID_1'))})
 # Co-located EMS and fire inventories can describe the same physical station.
 unique=[]
 for f in facilities:
  number=re.findall(r'\d+',f['name']);found=None
  for g in unique:
   same_address=f['address'] and f['address'].lower()==g['address'].lower()
   same_number=number and number==re.findall(r'\d+',g['name']) and 'fire' in (f['name']+' '+g['name']).lower()
   if math.dist(f['p'],g['p'])<40 and (same_address or same_number):found=g;break
  if found:
   found['sourceKinds']=list(set(found['sourceKinds']+[f['kind']]))
   if {'EMS':0,'Police':1,'Fire':2,'Hospital':3}[f['kind']]>{'EMS':0,'Police':1,'Fire':2,'Hospital':3}[found['kind']]:found['kind']=f['kind'];found['name']=f['name'];found['sourceId']=f['sourceId']
  else:unique.append(f)
 facilities=unique
 # Preserve public-road type and one-way attributes for transparent connectivity screening.
 old=json.loads((ROOT/'tools/raw-streets.json').read_text());attrs={f['attributes']['OBJECTID']:f['attributes'] for f in old['features']}
 for e in d['edges']:
  a=attrs.get(e['source'],{});e['oneWay']=a.get('OneWay');e['publicRoad']=a.get('StreetType') not in ['Private','Alley',None];e['roadType']=a.get('StreetType')
  # Functional class for every edge, including roads excluded from routing, and a freeway-connection flag.
  e['fc']=FUNCTIONAL.get(a.get('FunctionalClass'))
  e['limitedAccess']=a.get('StreetType') in LIMITED_ACCESS_TYPES or a.get('FunctionalClass') in LIMITED_ACCESS_CLASSES
 d['signals']=signal_points;d['facilities']=facilities
 d['datasetVersion']=dataset_version(d)
 d['enrichment']={'version':'2026-11-02.2','retrieved':'2026-11-02','signals':{'url':specs[0][1],'records':len(raw['signals']),'points':len(signal_points),'status':'available'},'traffic':{'url':TRAFFIC,'year':2025,'records':len(raw['traffic']),'matchedEdges':matches,'status':'available','match':'Geometry alignment; not field-verified'},'facilities':{'url':CITY+'HealthAndSafety1/FeatureServer','records':len(facilities),'status':'available'},'notes':'Sources are GIS snapshots. Absence of a match means unknown, not zero. ADT is an annual daily average, not race-day volume. Facilities may be outdated or misclassified.'}
 (ROOT/'dist/data.js').write_text('window.RACE_DATA='+json.dumps(d,separators=(',',':'))+';\n')
 print('Enriched:',len(signal_points),'signal points,',matches,'ADT-matched street edges,',len(facilities),'facilities; dataset',d['datasetVersion'],flush=True)
