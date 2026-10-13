'use strict';
const $=id=>document.getElementById(id);
let lat=33.9,lon=-77.96,map,ship,ws,grid=null,gradient=null,arrows=null,windOn=true,arrowsOn=true,sequence=0,debounce,waveGrid=null,mode='wind',waveRequest=0,forecastHour=0;
const timelineBase=new Date();timelineBase.setUTCMinutes(0,0,0);
const requestCache=new Map(),CACHE_TTL_MS=20*60*1000;
const renderedFrames=new WeakMap(),hourFrames=new Map();
function frameLocation(){const p=positionAtHour(forecastHour);return encounterMode==='encounter'?p:map.getCenter()}
function frameKey(hour,point){return hour+'|'+Math.round(point.lat*2)/2+'|'+Math.round((point.lng??point.lon)*2)/2}
function saveHourFrame(){const point=frameLocation();if(!point||!grid||!waveGrid||grid.validTime!==validAtFor(forecastHour)||waveGrid.validTime!==validAtFor(forecastHour))return;hourFrames.set(frameKey(forecastHour,point),{wind:grid,wave:waveGrid,at:Date.now()});if(hourFrames.size>24)hourFrames.delete(hourFrames.keys().next().value);if(hourFrames.size===1)setTimeout(preloadNearby,2000)}
let preloading=false;
async function preloadNearby(){if(preloading||hourFrames.size===0)return;preloading=true;const selected=forecastHour;const candidates=[6,12,24,18,36,48,72,0].filter(h=>h!==selected);for(const h of candidates.slice(0,3)){const p=encounterMode==='encounter'?positionAtHour(h):map.getCenter();if(!p)continue;const c={lat:p.lat,lng:p.lng??p.lon};if(hourFrames.has(frameKey(h,c)))continue;await Promise.allSettled([forecastData('wind',c,h),forecastData('wave',c,h)]);await new Promise(resolve=>setTimeout(resolve,500))}preloading=false}
function restoreHourFrame(){const point=frameLocation();if(!point)return false;const entry=hourFrames.get(frameKey(forecastHour,point));if(!entry||Date.now()-entry.at>CACHE_TTL_MS)return false;grid=entry.wind;waveGrid=entry.wave;updateMarineCards();updateProjection();render();$('status').textContent='Cached NOAA forecast · instant frame';$('validTime').textContent='Valid: '+validAtFor(forecastHour);return true}

function validAtFor(hour=forecastHour){return new Date(timelineBase.getTime()+hour*3600000).toISOString()}
function forecastLabel(hour){return validAtFor(hour).slice(5,16).replace('T',' ')+' UTC'}
function cacheKey(type,c,h){return type+'|'+validAtFor(h)+'|'+Math.round(c.lat*2)/2+'|'+Math.round(c.lng*2)/2}
async function forecastData(type,c,h){
 const key=cacheKey(type,c,h),found=requestCache.get(key);
 if(found&&Date.now()-found.at<CACHE_TTL_MS)return found.value;
 const url='/api/'+type+'?hour='+h+'&validAt='+encodeURIComponent(validAtFor(h))+'&lat='+encodeURIComponent(c.lat)+'&lon='+encodeURIComponent(c.lng);
 const response=await fetch(url),data=await response.json();
 if(!response.ok||!data.points?.length)throw Error(data.error||'No NOAA forecast grid returned');
 if(data.validTime!==validAtFor(h))throw Error('NOAA valid time did not match selected timeline hour');
 requestCache.set(key,{at:Date.now(),value:data});
 if(requestCache.size>35)requestCache.delete(requestCache.keys().next().value);
 return data;
}

const longitudeDelta=(a,b)=>Math.abs((((a-b+540)%360)+360)%360-180);
const lonNear=(value,reference)=>value+360*Math.round((reference-value)/360);
function nauticalCoord(value,isLat){const hemi=isLat?(value<0?'S':'N'):(value<0?'W':'E');let degrees=Math.floor(Math.abs(value)),minutes=(Math.abs(value)-degrees)*60;if(minutes>=59.9995){degrees++;minutes=0}return String(degrees).padStart(isLat?2:3,'0')+'° '+minutes.toFixed(3).padStart(6,'0')+'′ '+hemi}
// A projected vessel is a forecast aid; AIS position remains the actual vessel marker.
let encounterMode='fixed',liveCog=null,liveSog=null,projected=null,projectedTrack=null;
function normalizeLon(v){return ((v+180)%360+360)%360-180}
function positionAtHour(hours){
 if(encounterMode!=='encounter'||hours===0)return {lat,lon};
 const manual=$('manualMotion').checked;
 const course=manual?Number($('motionCog').value):liveCog,speed=manual?Number($('motionSog').value):liveSog;
 if(!Number.isFinite(course)||!Number.isFinite(speed)||course<0||course>=360||speed<0||speed>60||(manual&&(!$('motionCog').value||!$('motionSog').value)))return null;
 const distance=speed*hours/3440.065,theta=course*Math.PI/180,phi1=lat*Math.PI/180,lambda1=lon*Math.PI/180;
 const phi2=Math.asin(Math.sin(phi1)*Math.cos(distance)+Math.cos(phi1)*Math.sin(distance)*Math.cos(theta));
 const lambda2=lambda1+Math.atan2(Math.sin(theta)*Math.sin(distance)*Math.cos(phi1),Math.cos(distance)-Math.sin(phi1)*Math.sin(phi2));
 return {lat:phi2*180/Math.PI,lon:normalizeLon(lambda2*180/Math.PI)};
}
function updateProjection(){
 if(projected){map.removeLayer(projected);projected=null}if(projectedTrack){map.removeLayer(projectedTrack);projectedTrack=null}
 const p=positionAtHour(forecastHour),enabled=encounterMode==='encounter';
 $('encounterControls').style.display=enabled?'inline-flex':'none';$('chartControls').hidden=!(enabled&&!comparing);
 $('timeStatus').textContent='Selected '+forecastLabel(forecastHour)+(enabled?(p?' · predicted '+nauticalCoord(p.lat,true)+' '+nauticalCoord(p.lon,false):' · enter valid COG / SOG to project'):' · fixed vessel position');
 if(!enabled||!p||!map||!forecastHour)return p;
 const locations=[];for(let i=0;i<=24;i++){const step=forecastHour*i/24,q=positionAtHour(step);if(q)locations.push([q.lat,lonNear(q.lon,lon)])}
 projectedTrack=L.polyline(locations,{color:'#f7c56c',weight:2,dashArray:'6 7',opacity:.85,interactive:false}).addTo(map);
 projected=L.circleMarker([p.lat,lonNear(p.lon,lon)],{radius:7,color:'#f7c56c',fillColor:'#f7c56c',fillOpacity:.5,weight:2}).bindTooltip('PREDICTED +'+forecastHour+'h · '+nauticalCoord(p.lat,true)+' '+nauticalCoord(p.lon,false)).addTo(map);
 return p;
}
function reloadEncounter(){
 sequence++;waveRequest++;updateProjection();
 const p=positionAtHour(forecastHour);
 if(encounterMode==='encounter'&&!p){$('wind').textContent='--';$('direction').textContent='Set valid COG and SOG';updateMarineCards();return}
 $('wind').textContent='--';$('direction').textContent='Loading forecast';
 refresh(p.lat,p.lon,true);loadWave(p.lat,p.lon);
}
$('encounterMode').onchange=()=>{encounterMode=$('encounterMode').value;reloadEncounter()};
$('manualMotion').onchange=()=>{const manual=$('manualMotion').checked;$('motionCog').disabled=!manual;$('motionSog').disabled=!manual;reloadEncounter()};
for(const id of ['motionCog','motionSog'])$(id).onchange=()=>{if($('manualMotion').checked)reloadEncounter()};

// Independent two-course comparison; single-track Vessel Encounter remains unchanged.
let comparing=false,compareLayers=[],compareSequence=0;
const compareColors=['#4fc9e0','#f5c66c'];
function compareInputs(i){
 const suffix=i===0?'A':'B',cEl=$('compareCog'+suffix),sEl=$('compareSog'+suffix);
 const course=Number(cEl.value),sog=Number(sEl.value);
 return cEl.value!==''&&sEl.value!==''&&Number.isFinite(course)&&Number.isFinite(sog)&&course>=0&&course<360&&sog>=0&&sog<=60?{course,sog}:null;
}
function projectedCoursePosition(hours,motion){
 const theta=motion.course*Math.PI/180,d=motion.sog*hours/3440.065,phi=lat*Math.PI/180,lambda=lon*Math.PI/180;
 const nextPhi=Math.asin(Math.sin(phi)*Math.cos(d)+Math.cos(phi)*Math.sin(d)*Math.cos(theta));
 const nextLon=lambda+Math.atan2(Math.sin(theta)*Math.sin(d)*Math.cos(phi),Math.cos(d)-Math.sin(phi)*Math.sin(nextPhi));
 return {lat:nextPhi*180/Math.PI,lon:normalizeLon(nextLon*180/Math.PI)};
}
function clearComparisonMap(){for(const layer of compareLayers)map.removeLayer(layer);compareLayers=[]}
function drawComparison(){
 clearComparisonMap();if(!comparing)return;
 for(let i=0;i<2;i++){
  const motion=compareInputs(i);if(!motion)continue;
  const pts=[];for(let j=0;j<=24;j++){const p=projectedCoursePosition(forecastHour*j/24,motion);pts.push([p.lat,lonNear(p.lon,lon)])}
  const color=compareColors[i],pos=projectedCoursePosition(forecastHour,motion);
  if(forecastHour>0){
   compareLayers.push(L.polyline(pts,{color,weight:2.5,dashArray:'7 6',interactive:false}).addTo(map));
   compareLayers.push(L.circleMarker([pos.lat,lonNear(pos.lon,lon)],{color,radius:7,weight:2,fillColor:color,fillOpacity:.6}).bindTooltip('COURSE '+(i?'B':'A')+' +'+forecastHour+'h').addTo(map));
  }
 }
}
function compareClosest(data,pos){
 if(!data?.points?.length)return null;
 let closest=null,best=Infinity;
 for(const p of data.points){const d=Math.abs(pos.lat-p.lat)+longitudeDelta(pos.lon,p.lon)*Math.cos(pos.lat*Math.PI/180);if(d<best){closest=p;best=d}}
 return best<1.5?closest:null;
}
async function refreshComparison(){
 if(!comparing)return;const request=++compareSequence;
 const motions=[compareInputs(0),compareInputs(1)];
 drawComparison();$('compareValid').textContent='Valid '+validAtFor(forecastHour);
 for(const letter of ['A','B'])for(const field of ['wind','gust','sea','swell','dir','waveDir','pos'])$('comp'+letter+field).textContent='--';
 if(motions.some(x=>!x)){$('compareStatus').textContent='Enter COG 0–359.9° and SOG 0–60 kt for both courses.';return}
 $('compareStatus').textContent='Retrieving NOAA forecasts at both projected positions…';
 await Promise.all(motions.map(async(motion,i)=>{
  const letter=i?'B':'A',pos=projectedCoursePosition(forecastHour,motion),c={lat:pos.lat,lng:pos.lon};
  $('comp'+letter+'pos').textContent=nauticalCoord(pos.lat,true)+' '+nauticalCoord(pos.lon,false);
  const [w,sea]=await Promise.allSettled([forecastData('wind',c,forecastHour),forecastData('wave',c,forecastHour)]);
  if(request!==compareSequence||!comparing)return;
  if(w.status==='fulfilled'){
   const wind=w.value.shipSample||compareClosest(w.value,pos);
   if(wind){$('comp'+letter+'wind').textContent=speed(wind).toFixed(0)+' kt';$('comp'+letter+'gust').textContent=Number.isFinite(wind.gust)?(wind.gust*1.943844).toFixed(0)+' kt':'--';$('comp'+letter+'dir').textContent=Math.round((Math.atan2(-wind.u,-wind.v)*180/Math.PI+360)%360)+'°'}
  }
  if(sea.status==='fulfilled'){
   const p=compareClosest(sea.value,pos);
   if(p){$('comp'+letter+'sea').textContent=Number.isFinite(p.height)?(p.height*3.28084).toFixed(1)+' ft':'--';$('comp'+letter+'swell').textContent=Number.isFinite(p.swell)?(p.swell*3.28084).toFixed(1)+' ft':'--';$('comp'+letter+'waveDir').textContent=Number.isFinite(p.direction)?Math.round(p.direction)+'°':'--'}
  }
  if(w.status==='rejected'||sea.status==='rejected')$('compareStatus').textContent='Partial NOAA coverage; unavailable fields shown as --.';
 }));
 if(request===compareSequence&&$('compareStatus').textContent.startsWith('Retrieving'))$('compareStatus').textContent='NOAA forecast sampled at both projected positions.';
}
function setComparison(enabled){
 comparing=enabled;compareSequence++;
 $('comparePanel').hidden=!enabled;$('compareResults').hidden=!enabled;$('singleWeather').style.display=enabled?'none':'';
 $('compareBtn').classList.toggle('active',enabled);$('chartControls').hidden=enabled||encounterMode!=='encounter';
 if(enabled){$('compareValid').textContent=validAtFor(forecastHour);drawComparison();refreshComparison()}
 else clearComparisonMap();
}
$('compareBtn').onclick=()=>setComparison(!comparing);
$('closeCompare').onclick=()=>setComparison(false);
$('applyCompare').onclick=refreshComparison;
const speed=p=>Math.hypot(p.u,p.v)*1.943844;
const palette=['#124d9e','#09b9f4','#13d0ba','#b5df37','#ffe052','#fa8639','#ec3670','#aa27bd'];
const colorScales={
 wind:{title:'10m WIND SPEED · KNOTS',stops:[0,8,15,23,30,40,50,65],ticks:['0','15','30','45','65+']},
 gust:{title:'SURFACE WIND GUSTS · KNOTS',stops:[0,10,20,30,40,50,65,80],ticks:['0','20','40','60','80+']},
 wave:{title:'SIGNIFICANT WAVE HEIGHT · FEET',stops:[0,3,6,10,15,20,30,40],ticks:['0','6','15','25','40+']}
};
function rgb(value,layer=mode){const stops=colorScales[layer].stops;for(let i=1;i<stops.length;i++)if(value<=stops[i]){const t=Math.max(0,(value-stops[i-1])/(stops[i]-stops[i-1]));return [1,3,5].map(j=>Math.round(parseInt(palette[i-1].slice(j,j+2),16)*(1-t)+parseInt(palette[i].slice(j,j+2),16)*t))}return [170,39,189]}
function updateLegend(){
 const scale=colorScales[mode],range=scale.stops.at(-1);
 $('legendTitle').textContent=scale.title;
 $('legendGradient').style.background='linear-gradient(90deg,'+palette.map((color,i)=>color+' '+(scale.stops[i]/range*100).toFixed(2)+'%').join(',')+')';
 $('legendTicks').replaceChildren(...scale.ticks.map(value=>{const el=document.createElement('span');el.textContent=value;return el}));
}
function clock(){$('clock').textContent=new Date().toISOString().slice(11,19)+' UTC'}clock();setInterval(clock,1000);
if(window.L){map=L.map('map',{worldCopyJump:true}).setView([lat,lon],5);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:19}).addTo(map);ship=L.marker([lat,lon],{icon:L.divIcon({className:'',iconSize:[32,32],iconAnchor:[16,16],html:'<svg viewBox="0 0 32 32" width="32"><path d="M16 2 27 29 16 24 5 29Z" fill="#41d5ec" stroke="white" stroke-width="2.5"/></svg>'})}).addTo(map);map.on('moveend',()=>{if(windOn){if(mode==='wave')loadWave(map.getCenter().lat,map.getCenter().lng);else refresh()}})}
function nearestToVessel(data){if(!data?.points?.length)return null;const pos=positionAtHour(forecastHour);if(!pos)return null;const {lat:sampleLat,lon:sampleLon}=pos;let best=null,d=Infinity;for(const p of data.points){const distance=Math.abs(p.lat-sampleLat)+longitudeDelta(p.lon,sampleLon)*Math.cos(sampleLat*Math.PI/180);if(distance<d){d=distance;best=p}}return d<3?best:null}
function updateMarineCards(){
 const pos=positionAtHour(forecastHour)||{lat,lon};const sampleLat=pos.lat,sampleLon=pos.lon;
 const w=grid?.shipSample&&Math.abs(grid.shipSample.lat-sampleLat)<0.15&&longitudeDelta(grid.shipSample.lon,sampleLon)<0.15?grid.shipSample:nearestToVessel(grid),sea=nearestToVessel(waveGrid);
 $('gustValue').textContent=w&&Number.isFinite(w.gust)?(w.gust*1.943844).toFixed(0)+' kt':'--';
 $('gustInfo').textContent=w&&Number.isFinite(w.gust)?'NOAA GFS surface gust':'No NOAA gust value available';
 $('waveValue').textContent=sea&&Number.isFinite(sea.height)?(sea.height*3.28084).toFixed(1)+' ft':'--';
 $('waveInfo').textContent=sea&&Number.isFinite(sea.height)?'Combined wind waves + swell':'Wave grid not available';
 $('swellValue').textContent=sea&&Number.isFinite(sea.swell)?(sea.swell*3.28084).toFixed(1)+' ft':'--';
 $('swellInfo').textContent=sea&&Number.isFinite(sea.period)?'Period '+sea.period.toFixed(0)+' s'+(Number.isFinite(sea.direction)?' · '+Math.round(sea.direction)+'°':''):'Primary swell component pending';
}
function sampleAtShip(){updateMarineCards();if(!grid)return;const pos=positionAtHour(forecastHour);if(!pos)return;const sampleLat=pos.lat,sampleLon=pos.lon;let nearest=null,d=Infinity;for(const p of grid.points){const delta=Math.abs(p.lat-sampleLat)+longitudeDelta(p.lon,sampleLon)*Math.cos(sampleLat*Math.PI/180);if(delta<d){d=delta;nearest=p}}const exact=grid.shipSample;const selected=exact&&Math.abs(exact.lat-sampleLat)<0.15&&longitudeDelta(exact.lon,sampleLon)<0.15?exact:nearest;if(selected&&(selected===exact||d<3)){$('wind').textContent=speed(selected).toFixed(0)+' kt';$('direction').textContent=Math.round((Math.atan2(-selected.u,-selected.v)*180/Math.PI+360)%360)+'° FROM · NOAA GFS'}else{$('wind').textContent='--';$('direction').textContent='Vessel outside forecast grid'}}
function clearLayers(){if(gradient){map.removeLayer(gradient);gradient=null}if(arrows){map.removeLayer(arrows);arrows=null}}
function render(){clearLayers();if(!grid||!windOn)return;const active=mode==='wave'?waveGrid:grid; if(!active)return;const pts=active.points,step=active.step||2;if(pts.length<6)throw Error('Insufficient NOAA grid points');
const north=Math.max(...pts.map(p=>p.lat)),south=Math.min(...pts.map(p=>p.lat)),west=Math.min(...pts.map(p=>p.lon)),east=Math.max(...pts.map(p=>p.lon)),worldShift=360*Math.round((map.getCenter().lng-(west+east)/2)/360);
const lookup=new Map(pts.map(p=>[p.lat.toFixed(3)+','+p.lon.toFixed(3),p]));
const get=(a,b)=>lookup.get(a.toFixed(3)+','+b.toFixed(3));
const cached=renderedFrames.get(active)?.[mode];let imageUrl=cached; if(!imageUrl){
const W=Math.max(256,Math.min(600,Math.ceil((east-west)*10))),H=Math.max(200,Math.min(550,Math.ceil((north-south)*10))),canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(W,H);
for(let y=0;y<H;y++){const la=north-y/(H-1)*(north-south),la0=Math.max(south,Math.min(north-step,south+Math.floor((la-south)/step)*step)),la1=la0+step,fy=Math.max(0,Math.min(1,(la-la0)/step));for(let x=0;x<W;x++){const lo=west+x/(W-1)*(east-west),lo0=Math.max(west,Math.min(east-step,west+Math.floor((lo-west)/step)*step)),lo1=lo0+step,fx=Math.max(0,Math.min(1,(lo-lo0)/step));const a=get(la0,lo0),b=get(la0,lo1),c=get(la1,lo0),d=get(la1,lo1);if(!a||!b||!c||!d)continue;const mix=(k)=>a[k]*(1-fx)*(1-fy)+b[k]*fx*(1-fy)+c[k]*(1-fx)*fy+d[k]*fx*fy; if(mode==='wave'&&![a.height,b.height,c.height,d.height].every(Number.isFinite))continue;if(mode==='gust'&&![a.gust,b.gust,c.gust,d.gust].every(Number.isFinite))continue;const value=mode==='wave'?mix('height')*3.28084:mode==='gust'?mix('gust')*1.943844:Math.hypot(mix('u'),mix('v'))*1.943844,col=rgb(value),off=(y*W+x)*4;pixels.data[off]=col[0];pixels.data[off+1]=col[1];pixels.data[off+2]=col[2];pixels.data[off+3]=185}}
ctx.putImageData(pixels,0,0);imageUrl=canvas.toDataURL('image/png');const prior=renderedFrames.get(active)||{};prior[mode]=imageUrl;renderedFrames.set(active,prior);}
gradient=L.imageOverlay(imageUrl,[[south,west+worldShift],[north,east+worldShift]],{interactive:false,opacity:.85}).addTo(map);
if(arrowsOn&&mode==='wind'){arrows=L.layerGroup();const marks=[];for(const p of pts){const pixel=map.latLngToContainerPoint([p.lat,p.lon+worldShift]),size=map.getSize();if(pixel.x<0||pixel.y<0||pixel.x>size.x||pixel.y>size.y||marks.some(q=>Math.hypot(q.x-pixel.x,q.y-pixel.y)<70))continue;marks.push(pixel);const angle=Math.atan2(p.u,p.v)*180/Math.PI;const icon=L.divIcon({className:'',iconSize:[24,24],iconAnchor:[12,12],html:'<svg width="24" height="24" viewBox="0 0 24 24" style="transform:rotate('+angle+'deg);filter:drop-shadow(0 1px 2px #00131b)"><path d="M12 3 L12 20 M6 10 L12 3 L18 10" fill="none" stroke="#f3faff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'});L.marker([p.lat,p.lon+worldShift],{icon,interactive:false,keyboard:false}).addTo(arrows)}arrows.addTo(map)}
sampleAtShip()}
let lastWaveRequestPosition=null,lastWindRequestPosition=null;
function updateShip(a,b,cog,sog){if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a)>90||Math.abs(b)>180)return;lat=a;lon=b;if(Number.isFinite(Number(cog))&&cog!==null&&cog!==''&&Number(cog)>=0&&Number(cog)<360)liveCog=Number(cog);if(Number.isFinite(Number(sog))&&sog!==null&&sog!==''&&Number(sog)>=0&&Number(sog)<=60)liveSog=Number(sog);ship?.setLatLng([a,b]);const angle=Number(cog);if(cog!==null&&cog!==undefined&&cog!==''&&Number.isFinite(angle)&&angle>=0&&angle<360){const svg=ship?.getElement()?.querySelector('svg');if(svg)svg.style.transform='rotate('+angle+'deg)'}$('positionText').textContent=nauticalCoord(a,true)+'  '+nauticalCoord(b,false);if(comparing)drawComparison();updateProjection();sampleAtShip();if(encounterMode==='encounter'&&forecastHour>0){const p=positionAtHour(forecastHour);if(p&&(!nearestToVessel(grid)||!nearestToVessel(waveGrid))){refresh(p.lat,p.lon,true);loadWave(p.lat,p.lon)}return}if(!nearestToVessel(grid)||grid?.forecastHour!==forecastHour){const d=lastWindRequestPosition;if(!d||Math.abs(a-d.lat)>2||longitudeDelta(b,d.lon)>2){lastWindRequestPosition={lat:a,lon:b};refresh(a,b,true)}}if(waveGrid?.forecastHour!==forecastHour||!nearestToVessel(waveGrid)){const d=lastWaveRequestPosition;if(!d||Math.abs(a-d.lat)>2||Math.abs(b-d.lon)>2){lastWaveRequestPosition={lat:a,lon:b};loadWave(a,b)}}}
try{ws=new WebSocket('wss://ais.wardlab.dev');ws.onopen=()=>$('bridge').textContent='BRIDGE CONNECTED';ws.onclose=()=>$('bridge').textContent='BRIDGE OFFLINE';ws.onerror=()=>$('bridge').textContent='BRIDGE UNAVAILABLE';ws.onmessage=e=>{try{const v=JSON.parse(e.data);if(v.source==='AIVDO'||v.type==='ownship')updateShip(Number(v.lat??v.latitude),Number(v.lon??v.longitude),v.cog??v.courseOverGround??v.course_over_ground??v.course,v.sog??v.speedOverGround??v.speed_over_ground??v.speed)}catch{}}}catch{$('bridge').textContent='BRIDGE UNAVAILABLE'}
function insideGrid(){if(grid?.forecastHour!==forecastHour||!grid?.points?.length)return false;const b=map.getBounds(),p=grid.points;const n=Math.max(...p.map(x=>x.lat)),s=Math.min(...p.map(x=>x.lat)),w=Math.min(...p.map(x=>x.lon)),e=Math.max(...p.map(x=>x.lon));const shifted=360*Math.round(((w+e)/2-b.getCenter().lng)/360);return b.getNorth()<n-2&&b.getSouth()>s+2&&b.getWest()+shifted>w+2&&b.getEast()+shifted<e-2}function refresh(targetLat=null,targetLon=null,force=false){if(!map||!windOn)return;if(!force&&encounterMode==='fixed'&&insideGrid()){render();$('status').textContent='NOAA GFS · using loaded forecast grid';return}clearTimeout(debounce);debounce=setTimeout(async()=>{const request=++sequence,c=force?{lat:targetLat,lng:targetLon}:(encounterMode==='encounter'?(()=>{const p=positionAtHour(forecastHour);return p?{lat:p.lat,lng:p.lon}:map.getCenter()})():map.getCenter());$('status').textContent='Refreshing NOAA GFS wind…';try{const data=await forecastData('wind',c,forecastHour);if(request!==sequence)return;const previous=grid;grid=data;saveHourFrame();updateMarineCards();sampleAtShip();try{render()}catch(e){grid=previous;render();throw e}$('validTime').textContent='Valid: '+data.validTime+' · Run '+data.modelRun+' · f'+String(data.modelForecastHour).padStart(3,'0')+' · sample '+(data.shipSample?data.shipSample.sampleLat.toFixed(2)+'°, '+data.shipSample.sampleLon.toFixed(2)+'°':'unavailable');$('status').textContent='NOAA GFS · interpolated wind + direction';$('info').textContent='NOAA GFS forecast valid '+data.validTime+'. White arrows show wind TO direction; meteorological FROM direction appears in the inspector. Interpolation is display smoothing, not higher model resolution.'}catch(error){if(request!==sequence)return;$('status').textContent='NOAA refresh unavailable · '+String(error.message).slice(0,80);$('info').textContent=grid?'Last successfully loaded NOAA grid retained. Refresh failed: '+error.message:'NOAA wind unavailable: '+error.message;if(!grid){$('wind').textContent='--';$('direction').textContent='Unavailable'}}},500)}
async function loadWave(targetLat=positionAtHour(forecastHour)?.lat??lat,targetLon=positionAtHour(forecastHour)?.lon??lon){
 const request=++waveRequest,c={lat:targetLat,lng:targetLon};$('status').textContent='Loading official NOAA GFS Wave…';
 try{
  const data=await forecastData('wave',c,forecastHour);
  if(request!==waveRequest)return;
  
  waveGrid=data;saveHourFrame();updateMarineCards();if(mode==='wave'){render();$('status').textContent='NOAA GFS Wave · significant combined seas';$('validTime').textContent='Valid: '+data.validTime}
 }catch(e){if(request!==waveRequest)return;$('status').textContent='NOAA GFS Wave unavailable · '+String(e.message).slice(0,72);$('waveInfo').textContent='Wave request failed';$('swellInfo').textContent='Wave request failed';if(mode==='wave'){clearLayers();$('info').textContent='No wave colors shown: '+e.message}}
}
function selectMode(next){mode=next;updateLegend();for(const key of ['wind','gust','wave']){$(key==='wind'?'windBtn':key==='gust'?'gustBtn':'waveBtn').style.opacity=key===mode?'1':'.55'}
 if(mode==='wave'&&(!waveGrid||waveGrid.forecastHour!==forecastHour)){clearLayers();loadWave(map.getCenter().lat,map.getCenter().lng);return}
 if(mode==='gust'&&!grid?.points?.some(p=>Number.isFinite(p.gust))){clearLayers();$('status').textContent='NOAA gust field not available';return}
 render();$('status').textContent=mode==='wave'?'NOAA GFS Wave significant wave height':mode==='gust'?'NOAA GFS wind gusts':'NOAA GFS wind';}
$('gustBtn').onclick=()=>selectMode('gust');$('waveBtn').onclick=()=>selectMode('wave');
$('windBtn').onclick=()=>{windOn=!windOn;$('windBtn').style.opacity=windOn?'1':'.5';if(windOn){if(grid)render();else refresh()}else{sequence++;clearLayers();$('status').textContent='Wind overlay disabled'}};
$('directionBtn').onclick=()=>{arrowsOn=!arrowsOn;$('directionBtn').textContent='DIRECTION ▸ '+(arrowsOn?'ON':'OFF');if(grid&&windOn)render()};
$('center').onclick=$('center2').onclick=()=>map.setView([lat,lon],6);
const panels={layers:'<p>NOAA GFS U/V winds. Interpolated colors and wind-to direction arrows. Last valid model field is retained during failed refreshes.</p><button id="refresh">Refresh forecast</button>',position:'<div class="fields"><label>Latitude<input id="manualLat" type="number" step="any"></label><label>Longitude<input id="manualLon" type="number" step="any"></label></div><button id="setPosition">Set position</button>',grib:'<p>NOAA GFS GRIB2 · NOMADS direct download</p><div class="fields"><label>Run date UTC<input type="date" id="date"></label><label>Cycle (0,6,12,18)<input type="number" id="cycle" value="0"></label><label>Forecast hour<input type="number" id="hour" value="24"></label><label>North<input type="number" id="north" value="40"></label><label>South<input type="number" id="south" value="20"></label><label>West (0–360°E)<input type="number" id="west" value="270"></label><label>East (0–360°E)<input type="number" id="east" value="300"></label></div><label><input id="uv" type="checkbox" checked> Wind U/V</label><label><input id="gust" type="checkbox" checked> Gust</label><label><input id="mslp" type="checkbox" checked> Pressure</label><button id="download">Open NOAA download</button><p id="downloadStatus" class="muted"></p><a id="downloadLink" target="_blank" rel="noopener noreferrer"></a>'};
function openPanel(type){$('drawer').classList.add('open');$('panelTitle').textContent=type.toUpperCase();$('panelBody').innerHTML=panels[type];if(type==='layers')$('refresh').onclick=refresh;if(type==='position'){$('manualLat').value=lat;$('manualLon').value=lon;$('setPosition').onclick=()=>{const a=Number($('manualLat').value),b=Number($('manualLon').value);if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a)>90||Math.abs(b)>180)return alert('Invalid coordinates');updateShip(a,b);map.setView([a,b],5)}}if(type==='grib'){const d=new Date(Date.now()-10*3600000);$('date').value=d.toISOString().slice(0,10);$('cycle').value=String(Math.floor(d.getUTCHours()/6)*6);$('download').onclick=downloadGrib}}
document.querySelectorAll('[data-panel]').forEach(b=>b.onclick=()=>openPanel(b.dataset.panel));$('close').onclick=()=>$('drawer').classList.remove('open');
function downloadGrib(){const date=$('date').value.replaceAll('-',''),c=Number($('cycle').value),h=Number($('hour').value),n=Number($('north').value),s=Number($('south').value),w=Number($('west').value),e=Number($('east').value);if(!/^20\d{6}$/.test(date)||![0,6,12,18].includes(c)||!Number.isInteger(h)||h<0||h>168||!(n<=90&&s>=-90&&n>s&&w>=0&&e<=360&&w<e))return $('downloadStatus').textContent='Invalid download settings';const cycle=String(c).padStart(2,'0'),q=new URLSearchParams({file:'gfs.t'+cycle+'z.pgrb2.0p25.f'+String(h).padStart(3,'0'),dir:'/gfs.'+date+'/'+cycle+'/atmos',subregion:'',leftlon:String(w),rightlon:String(e),toplat:String(n),bottomlat:String(s)});if($('uv').checked){q.set('var_UGRD','on');q.set('var_VGRD','on');q.set('lev_10_m_above_ground','on')}if($('gust').checked){q.set('var_GUST','on');q.set('lev_surface','on')}if($('mslp').checked){q.set('var_PRMSL','on');q.set('lev_mean_sea_level','on')}if(!($('uv').checked||$('gust').checked||$('mslp').checked))return $('downloadStatus').textContent='Select at least one variable';const link='https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?'+q;$('downloadLink').href=link;$('downloadLink').textContent='Open official NOAA GRIB2 link';$('downloadStatus').textContent='Direct NOAA download';window.open(link,'_blank','noopener,noreferrer')}

function closeContextMenu(){$('contextMenu').hidden=true}
function showContextMenu(event){
 event.preventDefault();
 const menu=$('contextMenu');menu.replaceChildren();
 const heading=text=>{const label=document.createElement('div');label.className='menu-heading';label.textContent=text;menu.appendChild(label)};
 const separator=()=>{const line=document.createElement('div');line.className='menu-separator';menu.appendChild(line)};
 const item=(name,action)=>{const button=document.createElement('button');button.type='button';button.textContent=name;button.onclick=()=>{closeContextMenu();action()};menu.appendChild(button)};
 heading('WEATHER LAYERS');
 item((mode==='wind'?'✓ ':'')+'Wind',()=>{windOn=true;selectMode('wind')});
 item((mode==='gust'?'✓ ':'')+'Gusts',()=>{windOn=true;selectMode('gust')});
 item((mode==='wave'?'✓ ':'')+'Waves',()=>{windOn=true;selectMode('wave')});
 item('Wind direction: '+(arrowsOn?'ON':'OFF'),()=>$('directionBtn').click());
 item('Weather overlay: '+(windOn?'ON':'OFF'),()=>$('windBtn').click());
 separator();heading('FORECAST TOOLS');
 item('Fixed position',()=>{if(comparing)setComparison(false);$('encounterMode').value='fixed';$('encounterMode').dispatchEvent(new Event('change'))});
 item('Vessel encounter',()=>{if(comparing)setComparison(false);$('encounterMode').value='encounter';$('encounterMode').dispatchEvent(new Event('change'))});
 item((comparing?'✓ ':'')+'Compare courses',()=>$('compareBtn').click());
 item('Course / speed settings',()=>{if(comparing)setComparison(false);$('encounterMode').value='encounter';$('encounterMode').dispatchEvent(new Event('change'));$('manualMotion').checked=true;$('manualMotion').dispatchEvent(new Event('change'))});
 separator();heading('MAP & DATA');
 item('Center on vessel',()=>$('center').click());
 item('Refresh forecast',()=>{const p=positionAtHour(forecastHour);if(p){refresh(p.lat,p.lon,true);loadWave(p.lat,p.lon)}});
 item('Download NOAA GRIB',()=>openPanel('grib'));
 menu.hidden=false;
 const area=document.querySelector('.maparea').getBoundingClientRect();
 const x=Math.max(5,Math.min(event.clientX-area.left,area.width-menu.offsetWidth-5));
 const y=Math.max(5,Math.min(event.clientY-area.top,area.height-menu.offsetHeight-5));
 menu.style.left=x+'px';menu.style.top=y+'px';
}
$('map').addEventListener('contextmenu',showContextMenu);
document.querySelector('.maparea').addEventListener('contextmenu',event=>{if(event.target.closest('#contextMenu, #chartControls, #comparePanel, #drawer'))return;showContextMenu(event)});
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#contextMenu'))closeContextMenu()});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeContextMenu()});


for(const h of [0,6,12,18,24,36,48,72]){const b=document.createElement('button');b.textContent='+'+h+'h · '+forecastLabel(h);b.title=validAtFor(h);b.dataset.hour=String(h);b.onclick=()=>{
 if(forecastHour===h)return;forecastHour=h;sequence++;waveRequest++;clearTimeout(debounce);const instant=restoreHourFrame();if(!instant){$('status').textContent='Loading NOAA forecast · retaining previous map until ready';$('wind').textContent='--';$('direction').textContent='Loading NOAA forecast'};
 $('timeStatus').textContent='Selected '+forecastLabel(h)+' · retrieving NOAA wind and waves';
 for(const btn of $('steps').children)btn.style.borderColor=btn===b?'#6de0f8':'#376077';
 if(!instant)reloadEncounter();else updateProjection();if(comparing)refreshComparison();
 };if(h===0)b.style.borderColor='#6de0f8';$('steps').appendChild(b)}
$('timeStatus').textContent='Selected '+forecastLabel(0)+' · NOAA forecast valid time';updateLegend();updateProjection();refresh();setTimeout(loadWave,1500);