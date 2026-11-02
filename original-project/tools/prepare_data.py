import json, urllib.request, urllib.parse, time, pathlib, collections, math, concurrent.futures
ROOT=pathlib.Path(__file__).resolve().parents[1]
BASE='https://services1.arcgis.com/k3vhq11XkBNeeOfM/ArcGIS/rest/services/'
def get(url,params=None):
 if params: url+='?'+urllib.parse.urlencode(params)
 for attempt in range(3):
  try:
   with urllib.request.urlopen(url,timeout=45) as r: return json.load(r)
  except Exception:
   if attempt==2: raise
meta=get(BASE+'CarriagewayCenterlines/FeatureServer/0',{'f':'json'})
print('Domains:',[(x['name'],x.get('domain')) for x in meta['fields'] if x['name'] in ['FunctionalClass','StreetType','OneWay']],flush=True)
params={'f':'json','where':'1=1','geometry':'-77.515,37.525,-77.405,37.605','geometryType':'esriGeometryEnvelope','inSR':4326,'spatialRel':'esriSpatialRelIntersects','returnIdsOnly':'true'}
ids=get(BASE+'CarriagewayCenterlines/FeatureServer/0/query',params)['objectIds']
print('Segments:',len(ids),flush=True)
chunks=list(range(0,len(ids),1000))
def fetch(chunk):
 return get(BASE+'CarriagewayCenterlines/FeatureServer/0/query',{'f':'json','where':'1=1','geometry':'-77.515,37.525,-77.405,37.605','geometryType':'esriGeometryEnvelope','inSR':4326,'spatialRel':'esriSpatialRelIntersects','resultOffset':chunk,'resultRecordCount':1000,'orderByFields':'OBJECTID','outFields':'OBJECTID,FullName,FunctionalClass,StreetType,PostedSpeed,OneWay','returnGeometry':'true','outSR':4326,'geometryPrecision':6})['features']
features=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
 for batch in pool.map(fetch,chunks): features+=batch
(ROOT/'tools'/'raw-streets.json').write_text(json.dumps({'features':features,'fields':meta['fields']},separators=(',',':')))
print('Classes',collections.Counter(x['attributes']['FunctionalClass'] for x in features),flush=True)
print('Street types',collections.Counter(x['attributes']['StreetType'] for x in features),flush=True)
services=get(BASE,{'f':'json'})
print('Water candidates',[x for x in services.get('services',[]) if any(s in x['name'].lower() for s in ['water','hydro','park','river','stream'])],flush=True)
