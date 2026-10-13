'use strict';
// Planning extension: requires only actual position and user-entered route/speed.
// Uses official NOAA forecast endpoints, never substitutes fabricated conditions.
(()=>{
 const q=id=>document.getElementById(id);
 let waypoints=[],adding=false,routeLine=null,markers=[],projection=null,analysisToken=0,records=[];
 const hours=[0,6,12,18,24,36,48,72];
 const radians=x=>x*Math.PI/180;
 const normalize=x=>((x+180)%360+360)%360-180;
 function angle(a,b){const x=radians(a.lat),y=radians(b.lat),d=radians(normalize(b.lon-a.lon));return Math.acos(Math.max(-1,Math.min(1,Math.sin(x)*Math.sin(y)+Math.cos(x)*Math.cos(y)*Math.cos(d))))}
 function miles(a,b){return angle(a,b)*3440.065}
 function interpolate(a,b,ratio){
  const d=angle(a,b);if(d<1e-9)return {...a};
  const A=Math.sin((1-ratio)*d)/Math.sin(d),B=Math.sin(ratio*d)/Math.sin(d);
  const x=A*Math.cos(radians(a.lat))*Math.cos(radians(a.lon))+B*Math.cos(radians(b.lat))*Math.cos(radians(b.lon));
  const y=A*Math.cos(radians(a.lat))*Math.sin(radians(a.lon))+B*Math.cos(radians(b.lat))*Math.sin(radians(b.lon));
  const z=A*Math.sin(radians(a.lat))+B*Math.sin(radians(b.lat));
  return {lat:Math.atan2(z,Math.hypot(x,y))*180/Math.PI,lon:normalize(Math.atan2(y,x)*180/Math.PI)}
 }
 function start(){return {lat,lon}}
 function path(){return [start(),...waypoints]}
 function routeAt(hour){
  let nm=Number(q('routeSpeed').value)*hour;const pts=path();
  for(let i=1;i<pts.length;i++){const leg=miles(pts[i-1],pts[i]);if(leg<=0)continue;if(nm<=leg)return {point:interpolate(pts[i-1],pts[i],nm/leg),leg:i};nm-=leg}
  return {point:pts.at(-1),leg:pts.length-1,finished:true}
 }
 function validSpeed(){const field=q('routeSpeed');const speed=Number(field.value);return field.value!==''&&speed>0&&speed<=50}
 function erase(){if(routeLine)map.removeLayer(routeLine);routeLine=null;for(const m of markers)map.removeLayer(m);markers=[];if(projection)map.removeLayer(projection);projection=null}
 function redraw(){
  erase();const pts=path();q('routeWaypoints').textContent='Start '+nauticalCoord(lat,true)+' '+nauticalCoord(lon,false)+' · '+waypoints.length+' waypoint(s) · '+pts.slice(1).reduce((acc,p,i)=>acc+miles(pts[i],p),0).toFixed(0)+' NM';
  if(pts.length===1)return;
  const coords=[pts[0]];for(let i=1;i<pts.length;i++)for(let t=1;t<=12;t++)coords.push(interpolate(pts[i-1],pts[i],t/12));
  routeLine=L.polyline(coords.map(p=>[p.lat,lonNear(p.lon,lon)]),{color:'#75e4c1',weight:2,dashArray:'7 5',interactive:false}).addTo(map);
  for(let i=0;i<waypoints.length;i++)markers.push(L.circleMarker([waypoints[i].lat,lonNear(waypoints[i].lon,lon)],{radius:5,color:'#75e4c1',fillColor:'#092c34',fillOpacity:1}).bindTooltip('WP '+(i+1)).addTo(map));
  drawProjection();
 }
 function drawProjection(){
  if(projection)map.removeLayer(projection);projection=null;
  if(!waypoints.length||!validSpeed())return;
  const p=routeAt(forecastHour).point;
  projection=L.circleMarker([p.lat,lonNear(p.lon,lon)],{radius:7,color:'#f2c26a',fillColor:'#f2c26a',fillOpacity:.7}).bindTooltip('Route ETA +'+forecastHour+'h').addTo(map);
 }
 function open(){q('routePanel').hidden=false;redraw()}
 function close(){q('routePanel').hidden=true;adding=false;map.getContainer().style.cursor='';}
 q('closeRoute').onclick=close;
 q('routeAdd').onclick=()=>{adding=!adding;map.getContainer().style.cursor=adding?'crosshair':'';q('routeAdd').textContent=adding?'CLICK MAP TO ADD WP':'+ ADD WP ON CHART'};
 map.on('click',e=>{if(!adding)return;if(waypoints.length>=24){q('routeSummary').textContent='Maximum 24 waypoints';return}waypoints.push({lat:e.latlng.lat,lon:normalize(e.latlng.lng)});redraw()});
 q('routeUndo').onclick=()=>{waypoints.pop();redraw()};
 q('routeClear').onclick=()=>{waypoints=[];records=[];analysisToken++;q('routeTimeline').replaceChildren();q('routeSummary').textContent='Route cleared';redraw()};
 q('routeSpeed').onchange=redraw;
 document.addEventListener('weather-hour-changed',()=>{if(!q('routePanel').hidden)drawProjection()});
 function closest(data,pos){
  if(!data?.points?.length)return null;let best=null,dist=Infinity;
  for(const p of data.points){const d=Math.abs(p.lat-pos.lat)+longitudeDelta(p.lon,pos.lon)*Math.cos(radians(pos.lat));if(d<dist){dist=d;best=p}}
  return dist<=1.5?best:null
 }
 const fromWind=w=>(Math.atan2(-w.u,-w.v)*180/Math.PI+360)%360;
 function bearing(a,b){const p1=radians(a.lat),p2=radians(b.lat),delta=radians(normalize(b.lon-a.lon));return (Math.atan2(Math.sin(delta)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(delta))*180/Math.PI+360)%360}
 function sector(direction,course){if(!Number.isFinite(direction)||!Number.isFinite(course))return '--';const r=((direction-course+540)%360)-180,a=Math.abs(r);return a<=22.5?'Head':a<=67.5?'Bow '+(r<0?'port':'stbd'):a<=112.5?'Beam '+(r<0?'port':'stbd'):a<=157.5?'Quarter '+(r<0?'port':'stbd'):'Following'}
 function limits(){return {wind:Number(q('limitWind').value),gust:Number(q('limitGust').value),sea:Number(q('limitSea').value)}}
 function summarize(){
  const summary=q('routeSummary'),lim=limits();
  const highs=key=>{const vals=records.map(r=>r[key]).filter(Number.isFinite);return vals.length?Math.max(...vals):null};
  const peakWind=highs('wind'),peakGust=highs('gust'),peakSea=highs('sea');
  summary.textContent='Max sampled: wind '+(peakWind===null?'--':peakWind.toFixed(0)+' kt')+' · gust '+(peakGust===null?'--':peakGust.toFixed(0)+' kt')+' · seas '+(peakSea===null?'--':peakSea.toFixed(1)+' ft')+'. Advisory flags mark forecast values exceeding your settings.';
  const table=document.createElement('table');table.innerHTML='<thead><tr><th>+UTC</th><th>WIND</th><th>GUST</th><th>SEAS</th><th>REL SEA</th></tr></thead><tbody></tbody>';
  const tbody=table.tBodies[0];for(const r of records){
   const row=tbody.insertRow();row.dataset.hour=String(r.hour);
   const entries=[String(r.hour)+'h',Number.isFinite(r.wind)?r.wind.toFixed(0):'--',Number.isFinite(r.gust)?r.gust.toFixed(0):'--',Number.isFinite(r.sea)?r.sea.toFixed(1):'--',r.sector];
   entries.forEach((value,i)=>{const td=row.insertCell();td.textContent=value;if((i===1&&r.wind>=lim.wind)||(i===2&&r.gust>=lim.gust)||(i===3&&r.sea>=lim.sea))td.className='exceed'});
   row.onclick=()=>{const step=[...q('steps').children].find(b=>Number(b.dataset.hour)===r.hour);step?.click();map.panTo([r.point.lat,lonNear(r.point.lon,map.getCenter().lng)])};
  }
  q('routeTimeline').replaceChildren(table);
 }
 async function analyze(){
  if(!waypoints.length){q('routeSummary').textContent='Add at least one waypoint first';return}
  if(!validSpeed()){q('routeSummary').textContent='Enter a planned speed from 0.1 to 50 kt';return}
  const lim=limits();if(Object.values(lim).some(v=>!Number.isFinite(v)||v<=0)){q('routeSummary').textContent='Enter positive advisory thresholds';return}
  const token=++analysisToken;records=[];q('routeSummary').textContent='Retrieving NOAA forecasts for the route…';q('routeTimeline').replaceChildren();
  const jobs=hours.map(hour=>({hour,...routeAt(hour)}));let completed=0;
  async function worker(){
   while(jobs.length&&token===analysisToken){
    const job=jobs.shift(),pos=job.point,c={lat:pos.lat,lng:pos.lon};
    const [w,a]=await Promise.allSettled([forecastData('wind',c,job.hour),forecastData('wave',c,job.hour)]);
    if(token!==analysisToken)return;
    const wind=w.status==='fulfilled'?(w.value.shipSample||closest(w.value,pos)):null;
    const sea=a.status==='fulfilled'?closest(a.value,pos):null;
    const track=path(),course=track.length>1?bearing(track[Math.max(0,job.leg-1)],track[Math.max(1,job.leg)]):NaN;
    records.push({hour:job.hour,point:pos,wind:wind?Math.hypot(wind.u,wind.v)*1.943844:NaN,gust:Number.isFinite(wind?.gust)?wind.gust*1.943844:NaN,sea:Number.isFinite(sea?.height)?sea.height*3.28084:NaN,sector:sector(sea?.direction,course)});
    q('routeSummary').textContent='NOAA sampling '+(++completed)+' / '+hours.length+' · '+validAtFor(job.hour);
   }
  }
  await Promise.all([worker(),worker()]);if(token!==analysisToken)return;
  records.sort((a,b)=>a.hour-b.hour);summarize();
 }
 q('routeAnalyze').onclick=analyze;
 for(const id of ['limitWind','limitGust','limitSea'])q(id).onchange=()=>{if(records.length)summarize()};
 window.routePlanner={open,close,redraw};
})();
