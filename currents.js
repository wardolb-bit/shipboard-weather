'use strict';
(()=>{
 const area=document.querySelector('.maparea');if(!area||typeof map==='undefined')return;
 const button=document.createElement('button');button.id='currentsToggle';button.textContent='CURRENTS · OFF';button.title='Surface currents (Open-Meteo Marine model, not NOAA or tidal navigation data)';
 const toolbar=document.querySelector('.mapbar');toolbar?.appendChild(button);
 const tag=document.createElement('div');tag.id='currentsStatus';tag.style.cssText='position:absolute;left:12px;bottom:12px;z-index:450;padding:6px 9px;background:#102b3fe8;border:1px solid #446276;border-radius:6px;font-size:11px;color:#c9e7f4;pointer-events:none';tag.hidden=true;area.appendChild(tag);
 let enabled=false,layer=null,seq=0,timer=null,current=null;
 window.currentGuidance={get value(){return current},nearest(location){
  if(!current?.points?.length||current.validTime!==validAtFor(forecastHour))return null;
  let best=null,d=Infinity;for(const p of current.points){const delta=Math.hypot(p.lat-location.lat,longitudeDelta(p.lon,location.lng)*Math.max(.2,Math.cos(location.lat*Math.PI/180)));if(delta<d){d=delta;best=p}}
  return d<=Math.max(5,current.step*1.2)?best:null;
 }};
 function clear(){if(layer){map.removeLayer(layer);layer=null}}
 function draw(data){
  clear();const items=[],size=map.getSize(),used=new Set();
  for(const p of data.points){
   const lon=lonNear(p.lon,map.getCenter().lng),pixel=map.latLngToContainerPoint([p.lat,lon]);
   if(pixel.x<0||pixel.y<0||pixel.x>size.x||pixel.y>size.y)continue;
   const key=Math.floor(pixel.x/48)+','+Math.floor(pixel.y/48);if(used.has(key))continue;used.add(key);
   const speed=p.speed,red=Math.round(Math.min(230,35+speed*115)),blue=Math.round(Math.max(85,210-speed*35));
   const arrow='<div style="transform:rotate('+p.direction+'deg);font-size:23px;line-height:24px;font-weight:800;color:rgb('+red+',210,'+blue+');text-shadow:0 1px 3px #001821">↑</div>';
   items.push(L.marker([p.lat,lon],{interactive:false,icon:L.divIcon({className:'',html:arrow,iconSize:[26,26],iconAnchor:[13,13]})}));
  }
  layer=L.layerGroup(items).addTo(map);
  tag.textContent='CURRENT SET → '+data.available+'/'+data.requested+' samples · '+data.source+' · '+data.validTime.slice(0,16).replace('T',' ')+'Z · coastal accuracy limited';
  document.dispatchEvent(new Event('weather-grid-updated'));
 }
 async function load(){
  if(!enabled)return;
  const request=++seq,b=map.getBounds();tag.hidden=false;tag.textContent='Loading ocean-current forecast…';
  try{
   const params=new URLSearchParams({south:String(b.getSouth()),north:String(b.getNorth()),west:String(b.getWest()),east:String(b.getEast()),validAt:validAtFor(forecastHour)});
   const response=await fetch('/api/currents?'+params);
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'Current data unavailable');
   if(request!==seq||!enabled)return;
   current=result;draw(result);
  }catch(error){if(request!==seq)return;current=null;clear();tag.textContent='Currents unavailable · '+String(error.message).slice(0,90);document.dispatchEvent(new Event('weather-grid-updated'))}
 }
 button.addEventListener('click',()=>{enabled=!enabled;button.textContent='CURRENTS · '+(enabled?'ON':'OFF');if(enabled)load();else{++seq;clear();tag.hidden=true;current=null;document.dispatchEvent(new Event('weather-grid-updated'))}});
 function queue(){if(!enabled)return;clearTimeout(timer);timer=setTimeout(load,600)}
 map.on('moveend',queue);document.addEventListener('weather-hour-changed',queue);
})();
