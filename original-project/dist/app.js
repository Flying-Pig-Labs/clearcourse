(function(){
'use strict';
const $=id=>document.getElementById(id),M=window.RaceModel,P=window.RacePlanning,D=window.RACE_DATA,net=M.createNetwork(D),NS='http://www.w3.org/2000/svg';
const KEY='richmond-race-lab-v1';
const copy=v=>JSON.parse(JSON.stringify(v));
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=(v,d=0)=>Number(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const money=v=>'$'+n(v);
const time=v=>{let day=Math.floor(v/1440),m=((Math.round(v)%1440)+1440)%1440;let h=Math.floor(m/60),pm=h>=12;return (h%12||12)+':'+String(m%60).padStart(2,'0')+(pm?' pm':' am')+(day>0?' +'+day+'d':day<0?' −1d':'');};
let state={version:1,distance:5,seed:'0',preference:'balanced',pickedStart:null,settings:copy(M.DEFAULTS),routes:[],selected:'proposed',overrides:{},constraints:{tolerance:.02,avoid:[],required:[],maxPeak:null},calibration:{},audit:[],ruleRevision:1};
let activeSite=null,editing=false,picking=false,drawPoints=[],drawRoute=null,showAll=false,generating=false,toastTimer;
let view={x:-2400,y:-1500,w:5200,h:4000};
try{const saved=JSON.parse(localStorage.getItem(KEY));if(saved&&saved.version===1)state=validateSession(saved);}catch(e){/* blocked or incompatible browser storage */}
function validSettings(s){
 const r=copy(M.DEFAULTS);
 if(!s||typeof s!=='object')return r;
 for(const k of ['officers','barriers','weights'])if(Array.isArray(s[k])&&s[k].length===4&&s[k].every(v=>Number.isFinite(v)&&v>=0&&v<=100))r[k]=s[k].slice();
 for(const [k,max] of Object.entries({rate:1000,setup:240,clear:240,wave:240,fast:30,slow:30,minimumShift:24,turnWeight:10,signalWeight:100,trafficWeight:100,speedWeight:100,signalOfficers:20}))if(Number.isFinite(s[k])&&s[k]>=0&&s[k]<=max)r[k]=s[k];
 if(r.fast<2)r.fast=2;if(r.slow<r.fast)r.slow=r.fast;
 if(['full','rolling'].includes(s.mode))r.mode=s.mode;
 if(/^([01]\d|2[0-3]):[0-5]\d$/.test(s.start||''))r.start=s.start;
 return r;
}
function validateRoute(r){
 if(!r||!Array.isArray(r.edges)||!Array.isArray(r.nodes)||r.edges.length<1||r.edges.length>20000||r.nodes.length!==r.edges.length+1)throw new Error('A saved route has invalid geometry.');
 r.edges.forEach((ei,i)=>{if(!Number.isInteger(ei)||!D.edges[ei])throw new Error('This route uses an unavailable street.');const e=D.edges[ei];if(e.c<0||!((e.a===r.nodes[i]&&e.b===r.nodes[i+1])||(e.b===r.nodes[i]&&e.a===r.nodes[i+1])))throw new Error('This route does not connect through the bundled street network.');});
 return {id:String(r.id||'imported').slice(0,50),name:String(r.name||'Imported route').slice(0,90),kind:String(r.kind||'Imported session').slice(0,60),edges:r.edges.slice(),nodes:r.nodes.slice(),length:r.edges.reduce((a,e)=>a+D.edges[e].l,0)};
}
function validateSession(s){
 if(s.version!==1)throw new Error('This session format is not supported.');
 const rs=(s.routes||[]).slice(0,8).map(validateRoute),r={version:1,distance:Math.max(1,Math.min(15,Number(s.distance)||5)),seed:['0','1','2','map'].includes(String(s.seed))?String(s.seed):'0',preference:['balanced','local','turns'].includes(s.preference)?s.preference:'balanced',settings:validSettings(s.settings),routes:rs,selected:rs.some(r=>r.id===s.selected)?s.selected:rs[0]?.id||'proposed',overrides:{},pickedStart:null};
 if(Number.isInteger(s.pickedStart)&&net.adj[s.pickedStart]?.length)r.pickedStart=s.pickedStart;
 for(const route of rs){const out={};for(const [id,o] of Object.entries(s.overrides?.[route.id]||{})){if(!/^\d+$/.test(id)||!D.nodes[+id]||!o)continue;const item={note:String(o.note||'').slice(0,500)};for(const k of ['officers','barriers','class'])if(Number.isFinite(Number(o[k]))&&Number(o[k])>=0&&Number(o[k])<=(k==='class'?3:100))item[k]=Number(o[k]);out[id]=item;}r.overrides[route.id]=out;}
 r.constraints={tolerance:Number.isFinite(s.constraints?.tolerance)?Math.max(.01,Math.min(.1,s.constraints.tolerance)):.02,avoid:Array.isArray(s.constraints?.avoid)?s.constraints.avoid.slice(0,10).map(String):[],required:Array.isArray(s.constraints?.required)?s.constraints.required.slice(0,3).map(String):[],maxPeak:Number.isInteger(s.constraints?.maxPeak)&&s.constraints.maxPeak>=0&&s.constraints.maxPeak<=500?s.constraints.maxPeak:null};
 r.calibration={};for(const route of rs){const observations=s.calibration?.[route.id];if(Array.isArray(observations))r.calibration[route.id]=observations.filter(o=>o&&/^\d+$/.test(String(o.site_id))).slice(0,1000).map(o=>{const row={site_id:String(o.site_id),category:String(o.category||'Unclassified').slice(0,100),note:String(o.note||'').slice(0,500)};for(const k of ['officers','barriers','hours'])if(Number.isFinite(o[k])&&o[k]>=0&&o[k]<=1000)row[k]=o[k];return row;});}
 r.audit=Array.isArray(s.audit)?s.audit.slice(-80).map(a=>({at:String(a.at||''),action:String(a.action||'').slice(0,200),ruleRevision:Number(a.ruleRevision)||1})):[];r.ruleRevision=Math.max(1,Math.min(9999,Number(s.ruleRevision)||1));
 return r;
}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){/* app remains usable without persistence */}}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
function active(){return state.routes.find(r=>r.id===state.selected)||state.routes[0];}
function score(r){return M.evaluate(net,r,state.settings,state.overrides[r.id]||{});}
function svg(tag,attrs={}){const el=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);return el;}
function pathString(points){return points.map((p,i)=>(i?'L':'M')+p[0]+','+p[1]).join('');}
function renderBase(){
 const base=$('baseLayer');
 base.append(svg('path',{d:D.parks.map(pathString).map(s=>s+'Z').join(''),class:'map-park'}));
 base.append(svg('path',{d:D.water.map(pathString).map(s=>s+'Z').join(''),class:'map-water','fill-rule':'evenodd'}));
 for(const c of [-1,0,1,2,3]){
  const d=D.edges.filter(e=>e.c===c).map(e=>pathString(e.p)).join('');
  base.append(svg('path',{d,class:'map-street',stroke:c<0?'#e2e3d6':'#fafaf4','stroke-width':c<0?1.2:[2.9,4.3,5.3,7][c]}));
  if(c>=0)base.append(svg('path',{d,class:'map-street',stroke:c>=2?'#d3d9bf':'#d4d9c6','stroke-width':c>=2?.8:.5}));
 }
 renderLabels();
}
function renderLabels(){
 const group=$('labelLayer');group.replaceChildren();
 const neighborhoods=[['THE FAN',-77.4684,37.5526],['MUSEUM DISTRICT',-77.4811,37.5634],["SCOTT’S ADDITION",-77.4706,37.573],['MONROE WARD',-77.4466,37.5469],['JACKSON WARD',-77.4405,37.5516],['BYRD PARK',-77.485,37.5449],['OREGON HILL',-77.4528,37.5387],['JAMES RIVER',-77.4628,37.5298],['DOWNTOWN',-77.4327,37.5406]];
 const factor=view.w/850;
 for(const [label,lon,lat] of neighborhoods){const [x,y]=M.xy(lon,lat);const t=svg('text',{x,y,class:'map-label','font-size':9.5*factor});t.textContent=label;group.append(t);}
 const named=['W BROAD ST','N BELVIDERE ST','S BELVIDERE ST','MONUMENT AVE','W MAIN ST','W CARY ST','N ARTHUR ASHE BLVD','BOULEVARD','W LEIGH ST'];
 const byName=new Map();
 for(const e of D.edges){if(!named.includes(e.n.toUpperCase()))continue;const p=e.p[Math.floor(e.p.length/2)];if(p[0]<view.x||p[0]>view.x+view.w||p[1]<view.y||p[1]>view.y+view.h)continue;let arr=byName.get(e.n)||[];arr.push(e);byName.set(e.n,arr);}
 for(const [name,es] of byName){const e=es[Math.floor(es.length/2)],mid=e.p[Math.floor(e.p.length/2)],a=e.p[0],b=e.p.at(-1);let angle=Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI;if(angle>90)angle-=180;if(angle< -90)angle+=180;const t=svg('text',{x:mid[0],y:mid[1]-4*factor,class:'map-label street-label','font-size':6.5*factor,transform:`rotate(${angle} ${mid[0]} ${mid[1]})`});t.textContent=name.toUpperCase();group.prepend(t);}
}
function applyView(){
 const rect=$('mapStage').getBoundingClientRect();view.h=view.w*rect.height/Math.max(1,rect.width);$('map').setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);
 const px=rect.width/view.w;let meters=px*500>90?200:500;$('mapScale').style.width=(meters*px)+'px';$('mapScale').textContent=meters+' m';
 renderLabels();renderMapOverlays();
}
function fitRoute(r=active()){
 const points=r?r.nodes.map(i=>D.nodes[i]):[M.xy(-77.481,37.567),M.xy(-77.44,37.541)];
 let xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);let minx=Math.min(...xs),maxx=Math.max(...xs),miny=Math.min(...ys),maxy=Math.max(...ys);const rect=$('mapStage').getBoundingClientRect(),ratio=rect.width/Math.max(rect.height,1);
 view.w=Math.max(1800,(maxx-minx)*1.48,(maxy-miny)*ratio*1.4);view.x=(minx+maxx)/2-view.w/2;view.h=view.w/ratio;view.y=(miny+maxy)/2-view.h/2;applyView();
}
function routeGeometry(r){return r.edges.map((ei,i)=>{const e=D.edges[ei],p=e.a===r.nodes[i]?e.p:e.p.slice().reverse();return pathString(p);}).join('');}
function renderMapOverlays(){
 const routeLayer=$('routeLayer'),sites=$('siteLayer'),ghost=$('ghostLayer'),waypoints=$('waypointLayer');routeLayer.replaceChildren();sites.replaceChildren();ghost.replaceChildren();waypoints.replaceChildren();
 const r=editing?drawRoute:active(),scale=view.w/Math.max($('mapStage').clientWidth,1);
 if(!editing)for(const alt of state.routes){if(alt.id===r?.id)continue;ghost.append(svg('path',{d:routeGeometry(alt),fill:'none',stroke:'#a7b59c','stroke-width':2.4,'stroke-dasharray':'3 5','stroke-opacity':.48,'vector-effect':'non-scaling-stroke'}));}
 if(r){const d=routeGeometry(r);routeLayer.append(svg('path',{d,fill:'none',stroke:'#f9fbed','stroke-width':10,'stroke-linecap':'round','stroke-linejoin':'round','vector-effect':'non-scaling-stroke'}));routeLayer.append(svg('path',{d,fill:'none',stroke:'#397c52','stroke-width':5.5,'stroke-linecap':'round','stroke-linejoin':'round','vector-effect':'non-scaling-stroke'}));
  if(!editing&&!picking){const sc=score(r);for(const s of sc.sites){const o=state.overrides[r.id]?.[s.id],g=svg('g',{'data-site':s.id,tabindex:'0',role:'button','aria-label':s.names.join(' and ')+', '+M.CLASSES[s.c]+', '+s.officers+' estimated officers'});g.append(svg('circle',{cx:s.x,cy:s.y,r:($('mapStage').clientWidth<500?12:8)*scale,class:'site-hit'}));g.append(svg('circle',{cx:s.x,cy:s.y,r:(o?4.7:s.c>=2?4.1:3)*scale,fill:o?'#55784a':s.c>=2?'#d4b376':'#c1ce97',stroke:'#fcfff4',class:'map-site'}));g.addEventListener('click',ev=>{ev.stopPropagation();openSite(s.id);});g.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();openSite(s.id);}});g.addEventListener('pointerenter',()=>showTooltip(s));g.addEventListener('pointerleave',()=>$('mapTooltip').hidden=true);sites.append(g);}}
 }
 const points=editing?drawPoints:r?[r.nodes[0]]:[];
 for(let i=0;i<points.length;i++){const p=D.nodes[points[i]],g=svg('g',{});g.append(svg('circle',{cx:p[0],cy:p[1],r:9*scale,fill:'#244f39',stroke:'#fff','stroke-width':2,'vector-effect':'non-scaling-stroke'}));const t=svg('text',{x:p[0],y:p[1]+3*scale,'text-anchor':'middle','font-size':8*scale,fill:'#fff','font-family':'system-ui','font-weight':600});t.textContent=editing?String(i+1):'S';g.append(t);waypoints.append(g);}
 renderFacilities(waypoints,scale);
 if(picking&&state.pickedStart!==null){const p=D.nodes[state.pickedStart];waypoints.append(svg('circle',{cx:p[0],cy:p[1],r:8*scale,fill:'#c19c5d',stroke:'#fff','stroke-width':2,'vector-effect':'non-scaling-stroke'}));}
}
function showTooltip(s){const p=worldToScreen(s.x,s.y),t=$('mapTooltip');t.innerHTML=`<strong>${escape(s.names.join(' / '))}</strong>${escape(M.CLASSES[s.c])} · ${s.officers} modeled officer${s.officers===1?'':'s'} · click to review`;t.style.left=Math.max(8,Math.min($('mapStage').clientWidth-230,p.x+12))+'px';t.style.top=Math.max(55,Math.min($('mapStage').clientHeight-75,p.y-30))+'px';t.hidden=false;}
function worldToScreen(x,y){const stage=$('mapStage');return{x:(x-view.x)/view.w*stage.clientWidth,y:(y-view.y)/view.h*stage.clientHeight};}
function screenToWorld(x,y){const rect=$('map').getBoundingClientRect();return{x:view.x+(x-rect.left)/rect.width*view.w,y:view.y+(y-rect.top)/rect.height*view.h};}
function render(){
 const r=active();if(!r)return;const baselineScore=score(state.routes[0]);for(const option of state.routes){if(option.id==='lower')option.name=score(option).index<baselineScore.index?'Lower-burden candidate':'Street-weighted candidate';if(option.id==='smooth')option.name=score(option).turns<baselineScore.turns?'Fewer-turns candidate':'Alternate street loop';}const sc=score(r),target=state.distance,delta=Math.abs(sc.length/1000-target),base=state.routes[0],baseScore=score(base);
 $('mapRouteName').textContent=r.name;
 $('routeStatus').textContent=`${n(sc.length/1000,2)} km · ${r.nodes[0]===r.nodes.at(-1)?'Loop':'Open route'} · ${sc.turns} turns · ${n(sc.repeat*100)}% repeated streets`;
 $('optionCount').textContent=state.routes.length+' routes';
 $('metrics').innerHTML=[['Burden index',n(sc.index,1),'pts',`${n(sc.index/(sc.length/1000),1)} pts/km · illustrative index`],['Est. peak officers',n(sc.peak),'','Simultaneous modeled requirement'],['Officer-hours',n(sc.officerHours,1),'h','Modeled time across review sites'],['Est. staffing cost',money(sc.cost),'',`${money(state.settings.rate)}/h · ${state.settings.mode==='full'?'full closure':'rolling estimate'}`]].map(([label,value,unit,foot])=>`<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}<span class="metric-unit">${unit}</span></div><div class="metric-foot">${foot}</div></div>`).join('');
 $('routeCards').innerHTML=state.routes.map(rt=>{const s=score(rt),diff=baseScore.index-s.index,isSelected=rt.id===r.id;return `<button class="route-card ${isSelected?'selected':''}" data-route="${escape(rt.id)}" aria-pressed="${isSelected}"><div class="route-card-top"><h3>${escape(rt.name)}</h3><span class="radio" aria-hidden="true"></span></div><div class="route-card-sub">${n(rt.length/1000,2)} km · ${s.turns} turns${diff>.5&&Math.abs(rt.length-base.length)/base.length<=.1?`<span class="route-card-tag">${n(diff/baseScore.index*100)}% lower modeled index</span>`:''}${P.constraints(net,rt,{...brief(),overrides:state.overrides[rt.id]||{}}).length?' · outside brief':''}</div><div class="route-card-metrics"><span>${n(s.index,1)}<small>burden points</small></span><span>${s.sites.length}<small>review sites</small></span><span>${n(s.peak)}<small>peak officers</small></span></div></button>`;}).join('');
 const difference=baseScore.index-sc.index;
 $('routeNote').innerHTML=(r.id===base.id?`<strong>${sc.sites.length} locations to review.</strong> ${sc.major} involve an arterial under the model. ${delta/target>state.constraints.tolerance?`This candidate is ${n(delta,2)} km from the target; revise its geometry before comparing equal-distance routes.`:'Distance is approximate; the course has not been certified.'}`:`<strong>${difference>=0?n(difference,1)+' fewer':n(-difference,1)+' more'} burden points</strong> than ${escape(base.name.toLowerCase())}. Length differs by ${n(Math.abs(r.length-base.length)/1000,2)} km. ${Math.abs(r.length-base.length)/base.length>.1?'Different distances: compare totals with care. ':''}${sc.major} arterial review sites.`)+`<br>${state.settings.mode==='rolling'?'Rolling closure estimate':'Full-route closure assumption'} · ${n(sc.barricades)} modeled barricades.`;
 $('driversList').innerHTML=sc.sites.slice().sort((a,b)=>b.points-a.points).slice(0,3).map(s=>`<button class="driver-row" data-review="${s.id}"><span><i></i>${escape(s.names.slice(0,2).join(' / '))}</span><span>${n(s.points,1)} pts ↗</span></button>`).join('')||'<p class="help-text">No side-street junctions detected. Review the imported geometry.</p>';
 renderTable(sc);renderMapOverlays();renderPlanning(sc);persist();
}
function renderTable(sc=active()?score(active()):null){
 if(!sc)return;const search=$('siteSearch').value.toLowerCase(),filter=$('siteFilter').value,overrides=state.overrides[active().id]||{};
 const filtered=sc.sites.filter(s=>(!search||s.names.join(' ').toLowerCase().includes(search))&&(filter==='all'||filter==='major'&&s.c>=2||filter==='edited'&&overrides[s.id])).sort((a,b)=>b.points-a.points||a.id-b.id),visible=showAll?filtered:filtered.slice(0,8);
 $('sitesTable').innerHTML=visible.map(s=>`<tr data-review="${s.id}" tabindex="0" aria-label="Review ${escape(s.names.join(' and '))}"><td>${escape(s.names.slice(0,3).join(' / '))}${overrides[s.id]?'<span class="edited-dot">EDITED</span>':''}</td><td><span class="class-pill ${s.c>=2?'major':''}">${M.CLASSES[s.c]}</span></td><td>${s.officers}</td><td>${s.barriers}</td><td>${time(s.startTime)} – ${time(s.endTime)}</td><td>${n(s.points,1)}</td><td>↗</td></tr>`).join('')||'<tr><td colspan="7" class="empty-row">No locations match these filters.</td></tr>';
 $('tableCount').textContent=`${visible.length} of ${filtered.length} review locations · ${sc.sites.length} total`;$('showAllSites').hidden=filtered.length<=8;$('showAllSites').textContent=showAll?'Show fewer locations ↑':'Show all locations ↓';
}
function syncControls(){
 syncBrief();
 const d=state.distance===5?'5':state.distance===10?'10':'custom';document.querySelectorAll('[data-distance]').forEach(b=>b.classList.toggle('active',b.dataset.distance===d));$('customDistanceWrap').hidden=d!=='custom';$('customDistance').value=state.distance;$('areaSelect').value=state.seed;$('characterSelect').value=state.preference;
}
async function generateRoutes(){
 if(generating)return;try{readBrief();}catch(e){toast(e.message);return;}const desired=state.distance;
 if(!Number.isFinite(desired)||desired<1||desired>15){toast('Choose a race distance between 1 and 15 km for this study area.');return;}
 if(editing)endDrawing();picking=false;$('mapStage').classList.remove('picking');$('pickStartButton').textContent='Choose start on map';
 generating=true;$('generateButton').disabled=true;$('mapLoading').hidden=false;$('loadingDetail').textContent='Comparing distance, road class and turns…';
 try{
  await new Promise(r=>requestAnimationFrame(r));
  let start=state.seed==='map'&&state.pickedStart!==null?state.pickedStart:net.nearest(...M.xy(D.seeds[Number(state.seed)||0].lon,D.seeds[Number(state.seed)||0].lat));
  let routes=await M.generate(net,{start,target:desired*1000,settings:state.settings,preference:state.preference,constraints:state.constraints,onProgress:p=>$('loadingDetail').textContent=`Sampling street loops · ${Math.round(p*100)}%`});
  if(routes[1]&&M.evaluate(net,routes[1],state.settings).index>=M.evaluate(net,routes[0],state.settings).index)routes[1].name='Street-weighted candidate';
  if(routes[2]&&M.evaluate(net,routes[2],state.settings).turns>=M.evaluate(net,routes[0],state.settings).turns)routes[2].name='Alternate street loop';
  const retained=state.routes.filter(r=>r.id.startsWith('custom-')).slice(-5);state.routes=routes.map(({score,signature,...r})=>r).concat(retained);state.selected=routes[0].id;state.overrides=Object.fromEntries(retained.map(r=>[r.id,state.overrides[r.id]||{}]));state.calibration=Object.fromEntries(retained.map(r=>[r.id,state.calibration[r.id]||[]]));recordAudit('Generated candidates for '+desired+' km brief');showAll=false;render();fitRoute();
 }catch(e){if(active())render();toast(e.message||'Route exploration could not complete. Try a different start or distance.');}finally{generating=false;$('generateButton').disabled=false;$('mapLoading').hidden=true;}
}
function openModel(){
 $('rulesTable').innerHTML=M.CLASSES.map((cls,i)=>`<tr><td>${cls}</td>${['officers','barriers','weights'].map((k,j)=>`<td><input type="number" min="0" max="100" step="${j===2?'.5':'1'}" data-rule="${k}" data-class="${i}" value="${state.settings[k][i]}" aria-label="${escape(cls)} ${k}"></td>`).join('')}</tr>`).join('');
 for(const k of ['Mode','Start','Fast','Slow','Wave','Setup','Clear','Rate','MinimumShift','SignalWeight','TrafficWeight','SpeedWeight','SignalOfficers'])$('setting'+k).value=state.settings[k[0].toLowerCase()+k.slice(1)];
 $('modelError').textContent='';$('modelDialog').showModal();
}
function saveModel(){
 const p=copy(state.settings);let valid=true;
 document.querySelectorAll('[data-rule]').forEach(el=>{const v=Number(el.value);if(el.value===''||!Number.isFinite(v)||v<0||v>100||((el.dataset.rule==='officers'||el.dataset.rule==='barriers')&&!Number.isInteger(v)))valid=false;p[el.dataset.rule][+el.dataset.class]=v;});
 for(const k of ['Fast','Slow','Wave','Setup','Clear','Rate','MinimumShift','SignalWeight','TrafficWeight','SpeedWeight','SignalOfficers']){let el=$('setting'+k),v=Number(el.value);if(el.value===''||!Number.isFinite(v)||!el.checkValidity())valid=false;p[k[0].toLowerCase()+k.slice(1)]=v;}
 p.mode=$('settingMode').value;p.start=$('settingStart').value;
 if(!valid||p.fast>p.slow||!p.start){$('modelError').textContent='Check the entered values. Staffing and barricades need whole numbers; last-finisher pace must be at least the fastest pace.';return;}
 state.settings=p;state.ruleRevision++;recordAudit('Changed global staffing/index assumptions');$('modelDialog').close();render();toast('Assumptions applied to all routes. Candidate geometry is unchanged; explore routes again to generate new options.');
}
function openSite(id){
 if(editing||generating)return;const r=active(),s=score(r).sites.find(s=>s.id===+id);if(!s)return;activeSite=s;$('mapTooltip').hidden=true;
 $('siteDialogTitle').textContent=s.names.join(' / ');$('siteClass').innerHTML=M.CLASSES.map((v,i)=>`<option value="${i}">${v}</option>`).join('');$('siteClass').value=s.c;$('siteOfficers').value=s.officers;$('siteBarriers').value=s.barriers;$('siteNote').value=s.note;
 $('siteSummary').innerHTML=`<div class="site-summary"><strong>${s.approaches} side-street approach${s.approaches===1?'':'es'} modeled</strong><br>${time(s.startTime)} – ${time(s.endTime)} · ${n(s.hours,2)} h duty window<br>${n(s.points,1)} burden points · ${n(s.officerHours,1)} officer-hours</div><div class="source-facts"><strong>GIS evidence</strong><br>Signal: ${s.facts.signal?'matched within 35 m · '+escape(s.facts.signal.location||'mapped intersection'):'unknown (no nearby match)'}<br>2025 ADT: ${s.facts.adt?n(s.facts.adt.value)+' vehicles/day · spatial match':'unknown'}<br>Posted speed: ${s.facts.speed===null?'unknown':s.facts.speed+' mph'}<br>Index components: ${Object.entries(s.parts).map(([k,v])=>escape(k)+' '+n(v,2)).join(' + ')}<br><span class="reason-codes">${s.reasons.join(' · ')} · Model ${M.VERSION} / rules r${state.ruleRevision}</span></div>`;$('siteError').textContent='';$('siteDialog').showModal();
}
function saveSite(){
 if(!activeSite)return;if(!$('siteNote').value.trim()){$('siteError').textContent='Add an override reason before saving.';return;}const officers=Number($('siteOfficers').value),barriers=Number($('siteBarriers').value);
 if(!Number.isInteger(officers)||officers<0||officers>100||!Number.isInteger(barriers)||barriers<0||barriers>100||$('siteOfficers').value===''||$('siteBarriers').value===''){$('siteError').textContent='Enter whole numbers between 0 and 100.';return;}
 const r=active();state.overrides[r.id]??={};state.overrides[r.id][activeSite.id]={class:Number($('siteClass').value),officers,barriers,note:$('siteNote').value.trim()};recordAudit('Overrode location '+activeSite.id+' on '+r.name);$('siteDialog').close();render();toast('Location updated. The route estimates now include your override.');
}
function startDrawing(){
 if(generating)return;editing=true;picking=false;drawPoints=[];drawRoute=null;$('mapStage').classList.add('drawing');$('mapStage').classList.remove('picking');$('drawBanner').hidden=false;$('mapRouteName').textContent='Your proposed route';$('drawButton').disabled=true;$('pickStartButton').textContent='Choose start on map';renderMapOverlays();toast('Click streets to add waypoints. Use Close loop to return to your starting point.');
}
function endDrawing(){editing=false;drawPoints=[];drawRoute=null;$('mapStage').classList.remove('drawing');$('drawBanner').hidden=true;$('drawButton').disabled=false;render();}
function updateDraw(){
 if(drawPoints.length<2){drawRoute=null;$('mapRouteName').textContent='Your proposed route';renderMapOverlays();return;}
 drawRoute=net.via(drawPoints,0.2);if(!drawRoute){drawPoints.pop();toast('Those points do not connect through the available street network.');drawRoute=drawPoints.length>1?net.via(drawPoints,.2):null;}
 if(drawRoute)$('mapRouteName').textContent=`Your proposed route · ${n(drawRoute.length/1000,2)} km`;
 renderMapOverlays();
}
function addRoute(r,name,kind){
 const id='custom-'+Date.now();if(state.routes.length>=8){toast('This session already has eight routes. Export it, or explore a new brief before adding more.');return;}state.routes.push({...r,id,name,kind});state.selected=id;state.overrides[id]={};showAll=false;render();fitRoute();
}
async function importFile(file){
 if(!file)return;
 try{
  if(file.size>5*1024*1024)throw new Error('Use a GPX, GeoJSON or session file smaller than 5 MB.');
  const content=await file.text();let coords=[];
  if(file.name.toLowerCase().endsWith('.gpx')||content.trim().startsWith('<')){
   const xml=new DOMParser().parseFromString(content,'application/xml');if(xml.querySelector('parsererror'))throw new Error('The GPX file could not be read.');
   let segments=[...xml.querySelectorAll('trkseg')];if(segments.length>1)throw new Error('Import one continuous GPX track segment at a time.');
   const points=[...xml.querySelectorAll('trkpt')];coords=(points.length?points:[...xml.querySelectorAll('rtept')]).map(p=>[Number(p.getAttribute('lon')),Number(p.getAttribute('lat'))]);
  }else{
   const obj=JSON.parse(content);
   if(obj.version===1&&Array.isArray(obj.routes)){const restored=validateSession(obj);state=restored;syncControls();if(!state.routes.length)await generateRoutes();else{render();fitRoute();}toast('Session loaded, including route edits and model assumptions.');return;}
   let geo=obj.type==='FeatureCollection'?obj.features.filter(f=>f.geometry?.type==='LineString'):obj.type==='Feature'?[obj]:[{geometry:obj}];
   if(geo.length!==1||geo[0].geometry?.type!=='LineString')throw new Error('Import a single GeoJSON LineString or one GPX track.');coords=geo[0].geometry.coordinates;
  }
  if(coords.length<2)throw new Error('The file does not contain enough route coordinates.');
  if(coords.some(p=>!Array.isArray(p)||p.length<2||!Number.isFinite(p[0])||!Number.isFinite(p[1])))throw new Error('The route contains invalid coordinates.');
  const points=[];let previous=null;
  for(let i=0;i<coords.length;i++){
   const p=M.xy(coords[i][0],coords[i][1]);if(previous&&Math.hypot(p[0]-previous[0],p[1]-previous[1])<45&&i<coords.length-1)continue;
   const node=net.nearest(...p,150);if(node<0)throw new Error('Part of this route is outside the bundled network or more than 150 m from a mapped street. Import a road route around the Fan or downtown Richmond.');if(points.at(-1)!==node)points.push(node);previous=p;
   if(points.length>1500)throw new Error('This track has too many waypoints for the prototype. Simplify it before importing.');
  }
  const route=net.via(points,0);if(!route||!route.edges.length)throw new Error('Could not connect this track through the street network.');
  addRoute(route,file.name.replace(/\.(gpx|geojson|json)$/i,'').slice(0,65),'Imported · snapped to streets');toast('Route imported and snapped to mapped streets. Review the resulting path; snapping can change distance and geometry.');
 }catch(e){toast(e.message||'That file could not be imported.');}finally{$('fileInput').value='';}
}
function download(name,content,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportFile(type){
 if(type==='csv'){exportWorksheet();return;}const r=active();if(!r){toast('Create a route first.');return;}
 const sc=score(r),date=new Date().toISOString().slice(0,10);$('exportMenu').hidden=true;
 if(type==='print'){window.print();return;}
 if(type==='json'){download('richmond-race-lab-session-'+date+'.json',JSON.stringify({...state,exportedAt:new Date().toISOString(),disclaimer:'Illustrative planning estimates; not an approved staffing or traffic-control plan.',source:D.source,enrichment:D.enrichment,modelVersion:M.VERSION,datasetVersion:P.DATASET,selectedAssessment:accessResult()},null,2),'application/json');toast('Session downloaded with the routes, assumptions and location edits.');return;}
 if(type==='geojson'){
  const coords=[];r.edges.forEach((ei,i)=>{let e=D.edges[ei],p=e.a===r.nodes[i]?e.p:e.p.slice().reverse();for(const v of(i?p.slice(1):p))coords.push(M.lonlat(...v).map(c=>+c.toFixed(6)));});
  const out={type:'Feature',properties:{name:r.name,distance_km:+(r.length/1000).toFixed(3),burden_index:+sc.index.toFixed(1),assumptions:state.settings,disclaimer:'Illustrative planning model. No operational approval.'},geometry:{type:'LineString',coordinates:coords}};download('richmond-race-route-'+date+'.geojson',JSON.stringify(out,null,2),'application/geo+json');toast('Route geometry downloaded.');return;
 }
 if(type==='csv'){
  const header=['Location','Road class','Side approaches','Officers (assumed)','Barricades (assumed)','Duty start','Duty end','Duty hours','Officer hours','Burden points','Overridden','Planner note','Latitude','Longitude'];
  const rows=sc.sites.map(s=>{const ll=M.lonlat(s.x,s.y);return[s.names.join(' / '),M.CLASSES[s.c],s.approaches,s.officers,s.barriers,time(s.startTime),time(s.endTime),s.hours.toFixed(2),s.officerHours.toFixed(2),s.points.toFixed(1),state.overrides[r.id]?.[s.id]?'Yes':'No',s.note,ll[1].toFixed(6),ll[0].toFixed(6)];});
  const csv=[header,...rows].map(row=>row.map(v=>{let str=String(v);if(/^[=+@\-\t\r]/.test(str))str="'"+str;return '"'+str.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');download('richmond-closure-estimates-'+date+'.csv',csv,'text/csv;charset=utf-8');toast('Closure worksheet downloaded. Figures are illustrative assumptions.');
 }
}
// Research-informed planning review. All numerical weights remain explicit assumptions.
function recordAudit(action){state.audit??=[];state.audit.push({at:new Date().toISOString(),action,ruleRevision:state.ruleRevision||1,modelVersion:M.VERSION,datasetVersion:P.DATASET});state.audit=state.audit.slice(-80);}
function brief(){return{...state.constraints,target:state.distance*1000,settings:state.settings,overrides:state.overrides[active()?.id]||{}};}
function syncBrief(){
 $('briefTolerance').value=(state.constraints.tolerance||.02)*100;$('briefAvoid').value=(state.constraints.avoid||[]).join(', ');$('briefRequired').value=(state.constraints.required||[]).join(', ');$('briefMaxPeak').value=state.constraints.maxPeak??'';
}
function readBrief(){
 const tolerance=Number($('briefTolerance').value)/100,raw=$('briefMaxPeak').value,maxPeak=raw===''?null:Number(raw),avoid=$('briefAvoid').value.split(',').map(v=>v.trim()).filter(Boolean),required=$('briefRequired').value.split(',').map(v=>v.trim()).filter(Boolean);
 if(!Number.isFinite(tolerance)||tolerance<.01||tolerance>.1)throw new Error('Choose a distance tolerance between 1% and 10%.');
 if(maxPeak!==null&&(!Number.isInteger(maxPeak)||maxPeak<0||maxPeak>500))throw new Error('The staffing cap must be a whole number from 0 to 500, or blank.');
 const known=new Set(D.edges.filter(e=>e.c>=0).map(e=>e.n.toLowerCase()));
 for(const name of [...avoid,...required])if(!known.has(name.toLowerCase()))throw new Error('Street not found: '+name+'. Use its exact name from the street list.');
 if(avoid.length>10||required.length>3)throw new Error('Use up to ten keep-open streets and three required streets.');
 if(required.some(v=>avoid.some(a=>a.toLowerCase()===v.toLowerCase())))throw new Error('A street cannot be both required and kept open.');
 state.constraints={tolerance,avoid,required,maxPeak};
}
const accessCache=new Map();
function accessKey(r){return r.edges.join(',');}
function accessResult(){const r=active();return r?accessCache.get(accessKey(r)):null;}
function renderPlanning(sc){
 $('revisionBadge').textContent=`Model v${M.VERSION} · Rules r${state.ruleRevision||1}`;
 const issues=P.constraints(net,active(),brief());
 $('briefStatus').classList.toggle('warning',issues.length>0);
 $('briefStatus').textContent=issues.length?issues.join(' '):`Within ±${n(state.constraints.tolerance*100)}% distance tolerance; specified street and modeled staffing constraints pass. Course suitability and access approval remain unassessed.`;
 const labels={hierarchy:'Road hierarchy',approaches:'Side approaches',signals:'Matched signals',traffic:'2025 ADT',speed:'Posted speed'};
 $('componentBars').innerHTML=Object.entries(sc.components).map(([key,v])=>`<div class="component-row"><span>${labels[key]}</span><div class="component-track"><div class="component-fill" style="width:${sc.index?v/sc.index*100:0}%"></div></div><b>${n(v,1)}</b></div>`).join('');
 const c=sc.coverage;
 $('coverageSummary').innerHTML=`<strong>${c.signals}/${c.total}</strong> review sites match a signal · <strong>${c.traffic}/${c.total}</strong> have a GIS-matched ADT value · <strong>${c.speed}/${c.total}</strong> have posted speed.<br>Unknown factors are unscored; a lower index can reflect missing data. Lane width, race-hour traffic and local staffing policy are not supplied. Traffic matches are spatial associations, not field verification.`;
 renderAccess();renderTimeline(sc);renderCalibration(sc);
}
function renderAccess(){
 const result=accessResult();
 if(!result){$('accessSummary').innerHTML='<div class="empty-analysis">Not run for this route. Screen mapped facilities and two cross-route distance probes.</div>';return;}
 $('accessSummary').innerHTML=`<div class="access-tiles"><div class="access-tile"><strong>${result.screened}</strong>facilities screened</div><div class="access-tile ${result.warnings.length?'warn':''}"><strong>${result.warnings.length}</strong>facility warnings</div><div class="access-tile"><strong>${result.unknown}</strong>not assessed</div></div><div class="access-message">${result.isolatedNodes} mapped road nodes separated from the largest remaining study-area component. ${result.closedEdges} selected or paired carriageway segments removed.</div>${result.warnings.length?`<ul class="access-list">${result.warnings.map(f=>`<li class="access-warning">${escape(f.name)} — ${f.status==='closed-node'?'snapped to a fully closed road node':'separated from the main study-area component'}</li>`).join('')}</ul>`:'<p class="access-message">No facility separation detected under this limited topology model. This is not confirmation of usable emergency access.</p>'}<ul class="access-list">${result.probes.map(p=>`<li><b>${p.name}</b> · ${p.before===null?'baseline not assessed':p.after===null?'no remaining path in the study graph':`${n(p.before/1000,2)} → ${n(p.after/1000,2)} km (+${n(p.added/1000,2)} km)`}</li>`).join('')}</ul><details><summary>Facility review list</summary><ul class="access-list">${result.facilities.map(f=>`<li>${escape(f.name)} · ${escape(f.kind)} · ${f.status==='connected'?'connected in undirected graph':f.status==='not-assessed'?'not assessed':f.status}</li>`).join('')}</ul></details><p class="access-message">One-way restrictions, turn rules, off-network roads, capacity and live conditions are not modeled. The facility entrance snap and GIS classification require review.</p>`;
}
async function runAccess(){
 if(!active())return;const r=active(),key=accessKey(r);$('accessButton').disabled=true;$('accessButton').textContent='Screening…';
 try{await new Promise(resolve=>requestAnimationFrame(resolve));const result=P.screenAccess(net,r);accessCache.set(key,result);recordAudit('Ran all-course-closed access screen for '+r.name);renderAccess();renderMapOverlays();persist();}catch(e){toast('Access screening could not complete: '+e.message);}finally{$('accessButton').disabled=false;$('accessButton').textContent='Run screen →';}
}
function renderFacilities(layer,scale){
 if(!$('showFacilities').checked||editing||picking)return;const result=accessResult();
 for(const f of D.facilities||[]){const [x,y]=f.p;if(x<view.x||x>view.x+view.w||y<view.y||y>view.y+view.h)continue;
  const assessed=result?.facilities.find(v=>v.kind===f.kind&&v.sourceId===f.sourceId),warn=assessed&&(assessed.status==='separated'||assessed.status==='closed-node');
  const group=svg('g',{class:'facility-marker',role:'img','aria-label':`${f.kind}: ${f.name}. ${assessed?assessed.status:'Not screened'}`});
  group.append(svg('rect',{x:x-6*scale,y:y-6*scale,width:12*scale,height:12*scale,rx:2*scale,fill:warn?'#bd8c53':'#fffef9',stroke:warn?'#a57741':'#9aaa8d','stroke-width':1,'vector-effect':'non-scaling-stroke'}));const text=svg('text',{x,y:y+2.7*scale,'text-anchor':'middle','font-size':8*scale,'font-weight':600,'font-family':'system-ui',fill:warn?'#fff':'#82956c'});text.textContent=f.kind==='Hospital'||f.kind==='EMS'?'+':f.kind==='Fire'?'F':'P';group.append(text);const title=svg('title');title.textContent=`${f.name} · ${f.kind} · ${assessed?assessed.status:'not screened'}`;group.append(title);group.addEventListener('click',ev=>{ev.stopPropagation();toast(title.textContent+' · GIS facility and entrance need verification.');});layer.append(group);
 }
}
function renderTimeline(sc){
 const sites=sc.sites.slice().sort((a,b)=>b.points-a.points).slice(0,6);if(!sites.length){$('staffingTimeline').innerHTML='<div class="empty-analysis">No modeled control locations.</div>';$('staffingCurve').innerHTML='';return;}
 const min=Math.min(...sc.sites.map(s=>s.begin)),max=Math.max(...sc.sites.map(s=>s.end)),range=Math.max(1,max-min),start=Number(state.settings.start.split(':')[0])*60+Number(state.settings.start.split(':')[1]);
 $('staffingTimeline').innerHTML=`<div class="timeline-axis">${[0,.25,.5,.75,1].map(t=>`<span>${time(start+min+range*t)}</span>`).join('')}</div>`+sites.map(s=>{const phases=[['setup',s.begin,s.control],['control',s.control,s.release],['clear',s.release,s.end]];return`<div class="timeline-row"><span title="${escape(s.names.join(' / '))}">${escape(s.names.slice(0,2).join(' / '))}</span><div class="timeline-track" role="img" aria-label="${escape(s.names.join(' / '))}, ${time(s.startTime)} to ${time(s.endTime)}, ${s.officers} officers">${phases.map(([name,a,b])=>`<span class="timeline-block ${name}" style="left:${(a-min)/range*100}%;width:${Math.max(0,b-a)/range*100}%" title="${name}: ${time(start+a)} – ${time(start+b)}"></span>`).join('')}</div><span>${s.officers} off.</span></div>`;}).join('');
 const events=sc.sites.flatMap(s=>[[s.begin,s.officers],[s.end,-s.officers]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let current=0,path='M0 56';for(const [t,d] of events){const x=(t-min)/range*600,y=56-current/Math.max(1,sc.peak)*50;path+=` L${x} ${y}`;current+=d;path+=` L${x} ${56-current/Math.max(1,sc.peak)*50}`;}path+=' L600 56';
 $('staffingCurve').innerHTML=`<div><strong>${sc.peak} estimated peak</strong><br>${n(sc.officerHours,1)} officer-hours<br>${n(sc.paidHours,1)} paid officer-hours</div><svg viewBox="0 0 600 62" preserveAspectRatio="none" role="img" aria-label="Modeled simultaneous officer assignments over time, peak ${sc.peak}"><path d="${path} L0 56Z" fill="#edf3e4"/><path d="${path}" fill="none" stroke="#789b64" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg></div>`;
}
function renderCalibration(sc){
 const records=state.calibration[active().id]||[],result=P.calibration(sc,records);
 if(!result.matched){$('calibrationSummary').innerHTML='<div class="empty-analysis"><strong>No actual staffing observations loaded.</strong><br>Accuracy has not been measured. Download this route’s worksheet, enter real observations, and import it here. No synthetic historical staffing data is supplied.</div>';$('calibrationTable').hidden=true;}
 else{
  $('calibrationSummary').innerHTML=[['Matched sites',result.matched,'observed locations'],['Officer MAE',result.metrics.officers.mae===null?'—':n(result.metrics.officers.mae,2),result.metrics.officers.count+' observations'],['Barricade MAE',result.metrics.barriers.mae===null?'—':n(result.metrics.barriers.mae,2),result.metrics.barriers.count+' observations'],['Duty-window MAE',result.metrics.hours.mae===null?'—':n(result.metrics.hours.mae*60,1)+'m',result.metrics.hours.count+' observations']].map(([label,v,foot])=>`<div class="calibration-stat">${label}<strong>${v}</strong><small>${foot}</small></div>`).join('');
  $('calibrationTable').hidden=false;$('calibrationTable').innerHTML=`<table><thead><tr><th>Observed location</th><th>Officers · est. / actual</th><th>Barricades · est. / actual</th><th>Duty h · est. / actual</th><th>Discrepancy</th></tr></thead><tbody>${result.pairs.map(({actual:a,predicted:s})=>`<tr><td>${escape(s.names.slice(0,2).join(' / '))}</td><td>${s.officers} / ${a.officers??'—'}</td><td>${s.barriers} / ${a.barriers??'—'}</td><td>${n(s.hours,2)} / ${a.hours===undefined?'—':n(a.hours,2)}</td><td>${escape(a.category)}</td></tr>`).join('')}</tbody></table>`;
 }
 const audit=(state.audit||[]).slice(-8).reverse();$('auditSummary').innerHTML=`${result.unmatched?`<p class="access-warning">${result.unmatched} observed site ID(s) were not matched and are excluded from errors. Retained in the session: ${escape(records.filter(o=>!sc.sites.some(s=>String(s.id)===String(o.site_id))).map(o=>o.site_id).join(', '))}.</p>`:''}<details><summary>Rule and review history · ${state.audit.length} recorded changes</summary><ul>${audit.map(a=>`<li>${escape(a.at)} · rules r${a.ruleRevision} · ${escape(a.action)}</li>`).join('')}</ul></details>Matched-site errors describe only the supplied observations. They do not validate unobserved sites or a different event.`;
}
async function loadActuals(file){
 if(!file)return;try{if(file.size>2*1024*1024)throw new Error('Use a CSV smaller than 2 MB.');const imported=P.importActuals(await file.text(),score(active()),active().id);state.calibration[active().id]=[...imported.records,...imported.unmatchedRecords];recordAudit('Imported '+imported.records.length+' actual staffing observations for '+active().name);render();toast(`Loaded ${imported.records.length} matched observations; ${imported.unmatched.length} unmatched site IDs. Model rules were not changed.`);}catch(e){toast(e.message);}finally{$('actualsInput').value='';}
}
function exportWorksheet(){
 const r=active();if(!r){toast('Create a route first.');return;}const sc=score(r),observed=new Map((state.calibration[r.id]||[]).map(o=>[String(o.site_id),o]));
 const header=['site_id','route_id','dataset_version','model_version','rule_revision','location','road_class','estimated_officers','estimated_barricades','estimated_hours','signal_match','matched_2025_adt','posted_speed_mph','reason_codes','actual_officers','actual_barricades','actual_hours','discrepancy_type','note'];
 const rows=sc.sites.map(s=>{const a=observed.get(String(s.id))||{};return[s.id,r.id,P.DATASET,M.VERSION,state.ruleRevision,s.names.join(' / '),M.CLASSES[s.c],s.officers,s.barriers,s.hours.toFixed(3),s.facts.signal?'GIS match':'Unknown',s.facts.adt?.value??'',s.facts.speed??'',s.reasons.join('|'),a.officers??'',a.barriers??'',a.hours??'',a.category||'',a.note||s.note];});
 for(const a of state.calibration[r.id]||[])if(!sc.sites.some(s=>String(s.id)===String(a.site_id)))rows.push([a.site_id,r.id,P.DATASET,M.VERSION,state.ruleRevision,'Unmatched observed site','','','','','','','','',a.officers??'',a.barriers??'',a.hours??'',a.category||'',a.note||'']);
 const csv=[header,...rows].map(row=>row.map(v=>{let value=String(v);if(/^[=+@\-\t\r]/.test(value))value="'"+value;return '"'+value.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');
 download('race-lab-observed-staffing-worksheet.csv',csv,'text/csv;charset=utf-8');toast('Worksheet downloaded. Fill the actual columns, preserve the site IDs, then import it for comparison.');
}
$('applyBrief').addEventListener('click',generateRoutes);
$('accessButton').addEventListener('click',runAccess);
$('showFacilities').addEventListener('change',renderMapOverlays);
$('actualTemplate').addEventListener('click',exportWorksheet);
$('importActuals').addEventListener('click',()=>$('actualsInput').click());
$('actualsInput').addEventListener('change',()=>loadActuals($('actualsInput').files[0]));
$('streetNames').innerHTML=[...new Set(D.edges.filter(e=>e.c>=0).map(e=>e.n))].sort().map(name=>`<option value="${escape(name)}"></option>`).join('');

// Workspace controls
$('generateButton').addEventListener('click',generateRoutes);
$('distanceButtons').addEventListener('click',e=>{const button=e.target.closest('[data-distance]');if(!button||generating)return;const value=button.dataset.distance;state.distance=value==='custom'?(state.distance===5||state.distance===10?7.5:Number($('customDistance').value)||7.5):Number(value);syncControls();generateRoutes();});
$('customDistance').addEventListener('change',()=>{state.distance=Number($('customDistance').value);persist();});
$('areaSelect').addEventListener('change',()=>{state.seed=$('areaSelect').value;persist();});
$('characterSelect').addEventListener('change',()=>{state.preference=$('characterSelect').value;persist();});
$('routeCards').addEventListener('click',e=>{const b=e.target.closest('[data-route]');if(b&&!editing&&!generating){state.selected=b.dataset.route;showAll=false;render();fitRoute();}});
for(const id of ['modelNav','assumptionsButton','footerSources'])$(id).addEventListener('click',openModel);
$('planNav').addEventListener('click',()=>document.querySelector('.brief').scrollIntoView({behavior:'smooth',block:'start'}));
$('saveModel').addEventListener('click',saveModel);
$('resetModel').addEventListener('click',()=>{state.settings=copy(M.DEFAULTS);state.ruleRevision++;recordAudit('Reset global assumptions to illustrative defaults');$('modelDialog').close();render();openModel();toast('Global assumptions reset. Individual location edits remain.');});
$('saveSite').addEventListener('click',saveSite);
$('siteClass').addEventListener('change',()=>{const c=+$('siteClass').value;$('siteOfficers').value=state.settings.officers[c]+(activeSite.facts.signal?state.settings.signalOfficers:0);$('siteBarriers').value=state.settings.barriers[c]*activeSite.approaches;});
$('resetSite').addEventListener('click',()=>{if(activeSite){delete(state.overrides[active().id]||{})[activeSite.id];$('siteDialog').close();render();toast('This location now uses the global model assumptions.');}});
for(const el of document.querySelectorAll('[data-close]'))el.addEventListener('click',()=>$(el.dataset.close).close());
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
$('siteSearch').addEventListener('input',()=>renderTable());$('siteFilter').addEventListener('change',()=>{showAll=false;renderTable();});$('showAllSites').addEventListener('click',()=>{showAll=!showAll;renderTable();});
for(const id of ['sitesTable','driversList'])$(id).addEventListener('click',e=>{const row=e.target.closest('[data-review]');if(row)openSite(row.dataset.review);});
$('sitesTable').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.dataset.review)openSite(e.target.dataset.review);});
$('exportButton').addEventListener('click',e=>{e.stopPropagation();$('exportMenu').hidden=!$('exportMenu').hidden;});
document.addEventListener('click',e=>{if(!e.target.closest('.export-wrap'))$('exportMenu').hidden=true;});$('exportMenu').addEventListener('click',e=>{const b=e.target.closest('[data-export]');if(b)exportFile(b.dataset.export);});
$('importButton').addEventListener('click',()=>$('fileInput').click());$('fileInput').addEventListener('change',()=>importFile($('fileInput').files[0]));
$('drawButton').addEventListener('click',startDrawing);$('cancelDraw').addEventListener('click',endDrawing);$('undoPoint').addEventListener('click',()=>{drawPoints.pop();updateDraw();});
$('closeLoop').addEventListener('click',()=>{if(drawPoints.length<2){toast('Add at least two waypoints before closing the loop.');return;}if(drawPoints.at(-1)!==drawPoints[0])drawPoints.push(drawPoints[0]);updateDraw();});
$('scoreDraw').addEventListener('click',()=>{if(!drawRoute||drawRoute.length<100){toast('Draw at least 100 m of connected streets first.');return;}const r=drawRoute;editing=false;$('mapStage').classList.remove('drawing');$('drawBanner').hidden=true;$('drawButton').disabled=false;addRoute(r,'Your proposed route','Drawn · snapped to streets');toast('Your route is scored using the same assumptions as the other candidates.');});
$('pickStartButton').addEventListener('click',()=>{if(editing||generating)return;picking=!picking;$('mapStage').classList.toggle('picking',picking);$('pickStartButton').textContent=picking?'Click a street to set the start':'Choose start on map';renderMapOverlays();});
function zoom(factor){const newW=Math.max(550,Math.min(13000,view.w*factor)),newH=newW*view.h/view.w;view.x+=(view.w-newW)/2;view.y+=(view.h-newH)/2;view.w=newW;view.h=newH;applyView();}
$('zoomIn').addEventListener('click',()=>zoom(.75));$('zoomOut').addEventListener('click',()=>zoom(1.333));$('fitMap').addEventListener('click',()=>fitRoute());
let pointer=null;
$('map').addEventListener('pointerdown',e=>{if(e.target.closest('[data-site]')&&!editing&&!picking)return;pointer={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y,moved:false};$('map').setPointerCapture(e.pointerId);});
$('map').addEventListener('pointermove',e=>{if(!pointer)return;let dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;if(Math.abs(dx)+Math.abs(dy)>5)pointer.moved=true;if(pointer.moved){const r=$('map').getBoundingClientRect();view.x=pointer.vx-dx/r.width*view.w;view.y=pointer.vy-dy/r.height*view.h;applyView();}});
$('map').addEventListener('pointerup',e=>{if(!pointer)return;const moved=pointer.moved;pointer=null;if($('map').hasPointerCapture(e.pointerId))$('map').releasePointerCapture(e.pointerId);if(moved)return;if(!editing&&!picking)return;const p=screenToWorld(e.clientX,e.clientY),nearest=net.nearest(p.x,p.y,200);if(nearest<0){toast('Choose a point closer to a mapped public street.');return;}if(editing){if(drawPoints.at(-1)!==nearest)drawPoints.push(nearest);updateDraw();}else{state.pickedStart=nearest;state.seed='map';syncControls();picking=false;$('mapStage').classList.remove('picking');$('pickStartButton').textContent='Choose start on map';toast('Start selected. Explore routes to generate candidates around this point.');persist();renderMapOverlays();}});
$('map').addEventListener('pointercancel',()=>pointer=null);
$('map').addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY>0?1.12:.89);},{passive:false});
$('map').addEventListener('keydown',e=>{if(e.key==='+'||e.key==='='){e.preventDefault();zoom(.8);}if(e.key==='-'){e.preventDefault();zoom(1.25);}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();view.x+=(e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0)*view.w*.12;view.y+=(e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0)*view.h*.12;applyView();}});
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(applyView,100);});
// Read-only diagnostic access for model inspection; the UI owns all state changes.
window.RaceLab={getSnapshot:()=>copy({state,selectedScore:active()?score(active()):null,editing,view}),networkSummary:()=>({nodes:D.nodes.length,edges:D.edges.length}),ready:false};
renderBase();syncControls();applyView();
(async()=>{if(state.routes.length){$('mapLoading').hidden=true;render();fitRoute();}else await generateRoutes();window.RaceLab.ready=true;})();
})();
