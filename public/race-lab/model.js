/* Transparent, illustrative planning model. No local staffing rules are represented. */
(function (root) {
  'use strict';
  const DEFAULTS = {
    officers:[1,1,2,3], barriers:[1,1,2,3], weights:[1,2,4,7],
    rate:85, setup:45, clear:20, wave:15, fast:4, slow:12,
    minimumShift:0, mode:'full', start:'08:00', turnWeight:1, signalWeight:2, trafficWeight:0.3, speedWeight:1, signalOfficers:0
  };
  const CLASSES=['Local','Collector','Minor arterial','Principal arterial'];
  class Heap {
    constructor(){this.a=[];}
    push(x){let a=this.a,i=a.length;a.push(x);while(i){let p=(i-1)>>1;if(a[p][0]<=x[0])break;a[i]=a[p];i=p;}a[i]=x;}
    pop(){let a=this.a,r=a[0],x=a.pop();if(a.length){let i=0;while(true){let l=i*2+1;if(l>=a.length)break;let q=l+1<a.length&&a[l+1][0]<a[l][0]?l+1:l;if(a[q][0]>=x[0])break;a[i]=a[q];i=q;}a[i]=x;}return r;}
  }
  function createNetwork(data){
    const adj=data.nodes.map(()=>[]);
    data.edges.forEach((e,i)=>{if(e.c<0)return;adj[e.a].push([e.b,i]);adj[e.b].push([e.a,i]);});
    const nearest=(x,y,max=Infinity)=>{let found=-1,best=max*max;data.nodes.forEach((p,i)=>{if(!adj[i].length)return;let d=(p[0]-x)**2+(p[1]-y)**2;if(d<best){best=d;found=i;}});return found;};
    function path(start,end,penalty=0,avoid=new Set(),blocked=new Set()){
      if(start===end)return {nodes:[start],edges:[],length:0};
      if(start<0||end<0)return null;
      const dist=new Float64Array(data.nodes.length).fill(Infinity),prev=new Int32Array(data.nodes.length).fill(-1),pe=new Int32Array(data.nodes.length).fill(-1),heap=new Heap();
      const target=data.nodes[end];
      const h=i=>Math.hypot(data.nodes[i][0]-target[0],data.nodes[i][1]-target[1]);
      dist[start]=0;heap.push([h(start),start,0]);
      while(heap.a.length){let [,n,d]=heap.pop();if(d>dist[n]+.001)continue;if(n===end)break;
        for(const [to,ei] of adj[n]){if(blocked.has(ei))continue;let e=data.edges[ei],cost=e.l*(1+penalty*[0,.25,.7,1.5][e.c]);if(avoid.has(ei))cost*=2.8;let nd=d+cost;if(nd<dist[to]){dist[to]=nd;prev[to]=n;pe[to]=ei;heap.push([nd+h(to),to,nd]);}}
      }
      if(!Number.isFinite(dist[end]))return null;
      let nodes=[end],edges=[],v=end;while(v!==start){edges.push(pe[v]);v=prev[v];if(v<0)return null;nodes.push(v);}nodes.reverse();edges.reverse();return {nodes,edges,length:edges.reduce((s,i)=>s+data.edges[i].l,0)};
    }
    function via(waypoints,penalty=0,blocked=new Set()){
      let nodes=[],edges=[],used=new Set();
      for(let i=1;i<waypoints.length;i++){let p=path(waypoints[i-1],waypoints[i],penalty,used,blocked);if(!p)return null;nodes.push(...(i===1?p.nodes:p.nodes.slice(1)));edges.push(...p.edges);p.edges.forEach(e=>used.add(e));}
      return {nodes,edges,waypoints:waypoints.slice(),length:edges.reduce((s,i)=>s+data.edges[i].l,0)};
    }
    return {data,adj,nearest,path,via,factCache:new Map()};
  }
  function evaluate(net,route,settings=DEFAULTS,overrides={}){
    const p={...DEFAULTS,...settings},D=net.data,used=new Set(route.edges),visits=new Map(),distances=[0];
    route.edges.forEach((e,i)=>distances.push(distances[i]+D.edges[e].l));
    route.nodes.forEach((n,i)=>{if(!visits.has(n))visits.set(n,[]);visits.get(n).push(distances[i]/1000);});
    const sites=[];
    for(const [n,km] of visits){
      const incident=net.adj[n],external=incident.filter(([,e])=>!used.has(e));
      if(!external.length)continue;
      const names=[...new Set(incident.map(([,i])=>D.edges[i].n).filter(Boolean))];
      const roadClass=Math.max(...incident.map(([,i])=>D.edges[i].c));
      const coord=D.nodes[n];
      let same=sites.find(s=>Math.hypot(s.x-coord[0],s.y-coord[1])<22 && s.names.some(v=>names.includes(v)));
      if(same){same.members.push(n);same.km.push(...km);same.external.push(...external.map(([,e])=>e));same.c=Math.max(same.c,roadClass);same.names=[...new Set([...same.names,...names])];continue;}
      sites.push({id:n,x:coord[0],y:coord[1],names,c:roadClass,members:[n],km:km.slice(),external:external.map(([,e])=>e)});
    }
    let rawIndex=0,officerHours=0,paidHours=0,barricades=0;const components={hierarchy:0,approaches:0,signals:0,traffic:0,speed:0};
    const startMinutes=Number(p.start.split(':')[0])*60+Number(p.start.split(':')[1]);
    for(const s of sites){
      s.approaches=new Set(s.external).size;
      const o=overrides[s.id]||{};s.c=o.class===undefined?s.c:Number(o.class);
      const incident=[...new Set(s.members.flatMap(id=>net.adj[id].map(([,ei])=>ei)))].map(ei=>D.edges[ei]);
      const factKey=s.members.slice().sort((a,b)=>a-b).join(',');let facts=net.factCache?.get(factKey);
      if(!facts){
        const signal=(D.signals||[]).find(v=>v.status==='In Service'&&Math.hypot(v.p[0]-s.x,v.p[1]-s.y)<=35);
        const volumes=incident.filter(e=>e.adt?.value>0).map(e=>e.adt);
        const speeds=incident.map(e=>e.speed).filter(v=>Number.isFinite(v)&&v>0&&v<=80);
        facts={signal:signal||null,adt:volumes.length?volumes.sort((a,b)=>b.value-a.value)[0]:null,speed:speeds.length?Math.max(...speeds):null};
        net.factCache?.set(factKey,facts);
      }
      s.facts=facts;
      s.officers=o.officers===undefined?Number(p.officers[s.c])+(facts.signal?Number(p.signalOfficers):0):Number(o.officers);
      s.barriers=o.barriers===undefined?Number(p.barriers[s.c])*s.approaches:Number(o.barriers);
      s.note=o.note||'';
      s.begin=p.mode==='full'?-p.setup:Math.min(...s.km)*p.fast-p.setup;
      s.end=p.mode==='full'?route.length/1000*p.slow+p.wave+p.clear:Math.max(...s.km)*p.slow+p.wave+p.clear;
      s.hours=(s.end-s.begin)/60;
      s.parts={hierarchy:Number(p.weights[s.c]),approaches:Number(p.weights[s.c])*.2*Math.max(0,s.approaches-1),signals:facts.signal?Number(p.signalWeight):0,traffic:facts.adt?facts.adt.value/10000*Number(p.trafficWeight):0,speed:facts.speed?Math.max(0,facts.speed-30)/10*Number(p.speedWeight):0};
      s.points=Object.values(s.parts).reduce((a,b)=>a+b,0);
      for(const [key,v] of Object.entries(s.parts))components[key]+=v;
      s.reasons=['ROAD_CLASS_'+s.c,'SIDE_APPROACHES_'+s.approaches,...(facts.signal?['SIGNAL_GIS_MATCH']:[]),...(facts.adt?['ADT_SPATIAL_MATCH']:[]),...(facts.speed?['POSTED_SPEED']:[]),...(Object.keys(o).length?['PLANNER_OVERRIDE']:[])];
      s.control=p.mode==='full'?0:Math.min(...s.km)*p.fast;s.release=s.end-p.clear;
      s.officerHours=s.officers*s.hours;s.paidHours=s.officers*Math.max(s.hours,p.minimumShift);
      s.startTime=startMinutes+s.begin;s.endTime=startMinutes+s.end;
      rawIndex+=s.points;officerHours+=s.officerHours;paidHours+=s.paidHours;barricades+=s.barriers;
    }
    const events=sites.flatMap(s=>[[s.begin,s.officers,1],[s.end,-s.officers,-1]]).sort((a,b)=>a[0]-b[0]||a[2]-b[2]);
    let current=0,peak=0;for(const [,d] of events){current+=d;peak=Math.max(peak,current);}
    let turns=0,changes=0;
    for(let i=1;i<route.edges.length;i++){
      const a=D.nodes[route.nodes[i-1]],b=D.nodes[route.nodes[i]],c=D.nodes[route.nodes[i+1]];
      const v=[b[0]-a[0],b[1]-a[1]],w=[c[0]-b[0],c[1]-b[1]];
      let cos=(v[0]*w[0]+v[1]*w[1])/(Math.hypot(...v)*Math.hypot(...w));
      if(Math.acos(Math.max(-1,Math.min(1,cos)))>Math.PI/4)turns++;
      if(D.edges[route.edges[i-1]].n!==D.edges[route.edges[i]].n)changes++;
    }
    const uniqueLength=[...used].reduce((s,e)=>s+D.edges[e].l,0);
    return {sites,components,coverage:{signals:sites.filter(s=>s.facts.signal).length,traffic:sites.filter(s=>s.facts.adt).length,speed:sites.filter(s=>s.facts.speed!==null).length,total:sites.length},index:rawIndex,officerHours,paidHours,barricades,peak,cost:paidHours*p.rate,turns,changes,repeat:route.length?1-uniqueLength/route.length:0,length:route.length,major:sites.filter(s=>s.c>=2).length};
  }
  async function generate(net,{start,target=5000,settings=DEFAULTS,preference='balanced',constraints={},onProgress=()=>{}}){
    const origin=net.data.nodes[start],candidates=[];let attempted=0;
    const norm=v=>String(v).trim().toLowerCase(),avoidNames=new Set((constraints.avoid||[]).map(norm)),required=(constraints.required||[]).map(norm),blockedNodes=new Set();
    for(const e of net.data.edges)if(avoidNames.has(norm(e.n))){blockedNodes.add(e.a);blockedNodes.add(e.b);}
    const blocked=new Set(net.data.edges.flatMap((e,i)=>blockedNodes.has(e.a)||blockedNodes.has(e.b)?[i]:[]));
    if(blockedNodes.has(start))throw new Error('The chosen start touches a keep-open street. Move the start or change that constraint.');
    const mandatory=required.map(name=>net.data.edges.map((e,i)=>({e,i})).filter(({e,i})=>e.c>=0&&norm(e.n)===name&&!blocked.has(i)).sort((a,b)=>{const mid=e=>[(net.data.nodes[e.a][0]+net.data.nodes[e.b][0])/2,(net.data.nodes[e.a][1]+net.data.nodes[e.b][1])/2];const aa=mid(a.e),bb=mid(b.e);return Math.hypot(aa[0]-origin[0],aa[1]-origin[1])-Math.hypot(bb[0]-origin[0],bb[1]-origin[1]);})[0]?.i??-1);
    if(mandatory.some(i=>i<0))throw new Error('A required street was not found or has no usable segment under the keep-open constraints. Review the names and constraints.');
    const attempts=64;

    for(let i=0;i<attempts;i++){
      const angle=(i%32)*Math.PI*2/32,penalty=(i<32?0.25:1.6)*(preference==='local'?3.2:1);
      let radius=target/8*(i%2?.94:1.06),route=null;
      for(let pass=0;pass<4;pass++){
        const waypoints=[start];
        for(let j=1;j<4;j++){
          const a=angle+j*Math.PI/2;
          waypoints.push(net.nearest(origin[0]+radius*(Math.cos(a)-Math.cos(angle)),origin[1]+radius*(Math.sin(a)-Math.sin(angle))));
        }
        if(mandatory.length){const e=net.data.edges[mandatory[0]];waypoints.splice(1,0,e.a,e.b);for(const ei of mandatory.slice(1)){const v=net.data.edges[ei];waypoints.splice(waypoints.length-1,0,v.a,v.b);}}
        waypoints.push(start);route=net.via(waypoints,penalty,blocked);
        if(!route||!route.length)break;
        radius*=target/route.length;
      }
      if(route&&route.length>target*.65&&route.length<target*1.4){
        const score=evaluate(net,route,settings);
        if(score.repeat<.24)candidates.push({...route,score,signature:[...new Set(route.edges)].sort((a,b)=>a-b).join(',')});
      }
      attempted++;if(i%4===3){onProgress(attempted/attempts);await new Promise(r=>setTimeout(r,0));}
    }
    const tolerance=constraints.tolerance??.02;
    const pool=candidates.filter(r=>Math.abs(r.length-target)/target<=tolerance&&required.every(name=>r.edges.some(e=>norm(net.data.edges[e].n)===name))&&(constraints.maxPeak==null||r.score.peak<=constraints.maxPeak));
    if(!pool.length)throw new Error('No sampled route meets this brief. Widen the distance tolerance, move the start, or relax the street/staffing constraints. No global feasibility claim is made.');
    const unique=[...new Map(pool.map(r=>[r.signature,r])).values()];
    function pick(fn,selected){
      const sorted=unique.slice().sort((a,b)=>fn(a)-fn(b));
      for(const r of sorted){
        if(selected.some(s=>s.signature===r.signature))continue;
        const rs=new Set(r.edges);
        if(selected.some(s=>{let shared=[...new Set(s.edges)].filter(e=>rs.has(e)).length;return shared/Math.max(rs.size,new Set(s.edges).size)>.9;}))continue;
        return r;
      }
      return sorted.find(r=>!selected.some(s=>s.signature===r.signature));
    }
    const selected=[];
    const base=pick(r=>Math.abs(r.length-target)/target*150+r.score.turns*(preference==='turns'?6:.5)+(preference==='local'?r.score.index:0)+r.score.repeat*100,selected);if(base)selected.push({...base,id:'proposed',name:preference==='local'?'Smaller-streets loop':preference==='turns'?'Turn-aware loop':'Distance-first loop',kind:'Example route'});
    const lower=pick(r=>r.score.index+Math.abs(r.length-target)/target*40+r.score.repeat*70,selected);if(lower)selected.push({...lower,id:'lower',name:'Lower-burden candidate',kind:'Compare option'});
    const smooth=pick(r=>r.score.turns*3+r.score.changes+Math.abs(r.length-target)/target*90+r.score.repeat*100,selected);if(smooth)selected.push({...smooth,id:'smooth',name:'Fewer-turns candidate',kind:'Compare option'});
    return selected;
  }
  function xy(lon,lat){return [(lon+77.46)*88152,(37.56-lat)*111195];}
  function lonlat(x,y){return [x/88152-77.46,37.56-y/111195];}
  const VERSION='2.0';
  const api={VERSION,Heap,DEFAULTS,CLASSES,createNetwork,evaluate,generate,xy,lonlat};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.RaceModel=api;
})(typeof window!=='undefined'?window:globalThis);
