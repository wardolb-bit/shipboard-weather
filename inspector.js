'use strict';
// Read-only NOAA map inspector; does not trigger network requests.
(()=>{
 const area=document.querySelector('.maparea');if(!area||typeof map==='undefined')return;
 const card=document.createElement('section');card.id='weatherInspector';card.className='weather-inspector';card.hidden=true;
 card.innerHTML='<div class="wi-head"><strong>◎ WEATHER INSPECTOR</strong><button type="button" id="wiClose" title="Unpin inspector" aria-label="Unpin inspector">×</button></div><div id="wiLocation" class="wi-location"></div><div id="wiMetrics" class="wi-metrics"></div><div id="wiValid" class="wi-valid"></div>';
 area.appendChild(card);
 const close=card.querySelector('#wiClose');let pinned=null,last=null;
 const rad=Math.PI/180;
 const closest=(data,where)=>{
  if(!data?.points?.length||data.validTime!==validAtFor(forecastHour))return null;
  let best=null,d=Infinity;
  for(const p of data.points){const dist=Math.hypot(p.lat-where.lat,longitudeDelta(p.lon,where.lng)*Math.max(.15,Math.cos(where.lat*rad)));if(dist<d){best=p;d=dist}}
  return d<=2?best:null;
 };
 const val=(n,digits=0)=>Number.isFinite(n)?n.toFixed(digits):'--';
 const dir=n=>Number.isFinite(n)?Math.round(n%360)+'° FROM':'--';
 const metric=(name,value,detail)=>'<div class="wi-metric"><span>'+name+'</span><strong>'+value+'</strong><small>'+detail+'</small></div>';
 function show(point){
  if(!point)return;
  last=point;const w=closest(grid,point),v=closest(waveGrid,point);
  card.hidden=false;
  card.querySelector('#wiLocation').textContent=nauticalCoord(point.lat,true)+' · '+nauticalCoord(normalizeLon(point.lng),false)+(pinned?' · PINNED':'');
  const from=w?((Math.atan2(-w.u,-w.v)*180/Math.PI+360)%360):NaN;
  card.querySelector('#wiMetrics').innerHTML=
   metric('WIND',w&&Number.isFinite(w.u)&&Number.isFinite(w.v)?val(Math.hypot(w.u,w.v)*1.943844)+' kt':'--',dir(from))+
   metric('GUST',w&&Number.isFinite(w.gust)?val(w.gust*1.943844)+' kt':'--','10m GFS')+
   metric('COMBINED SEAS',v&&Number.isFinite(v.height)?val(v.height*3.28084,1)+' ft':'--',v&&Number.isFinite(v.period)?val(v.period)+' s period':'--')+
   metric('PRIMARY SWELL',v&&Number.isFinite(v.swell)?val(v.swell*3.28084,1)+' ft':'--',v?(dir(v.swellDirection)+' · '+(Number.isFinite(v.swellPeriod)?val(v.swellPeriod)+' s':'--')):'--')+
   metric('PRESSURE',w&&Number.isFinite(w.mslp)?val(w.mslp)+' hPa':'--','Mean sea level');
  card.querySelector('#wiValid').textContent='NOAA GFS · +'+forecastHour+'h · '+validAtFor(forecastHour).slice(0,16).replace('T',' ')+' UTC · nearest 1° model sample';
  card.classList.toggle('wi-pinned',!!pinned);
 }
 map.on('mousemove',e=>{if(!pinned)show(e.latlng)});
 map.on('mouseout',()=>{if(!pinned)card.hidden=true});
 map.on('click',e=>{pinned=e.latlng;show(pinned)});
 close.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();pinned=null;card.hidden=true});
 card.addEventListener('click',e=>e.stopPropagation());
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&pinned){pinned=null;card.hidden=true}});
 document.addEventListener('weather-hour-changed',()=>{if(pinned)show(pinned);else if(last&&!card.hidden)show(last)});
 map.on('moveend',()=>{if(pinned)show(pinned)});
})();
