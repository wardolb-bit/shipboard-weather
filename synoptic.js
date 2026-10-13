'use strict';
// Synoptic layers: NOAA GFS pressure, wind and NOAA GFS Wave model points only.
(()=>{
 const flags={barbs:false,pressure:false,centers:false,waves:false,swell:false};
 const layers={};let schedule=null;
 const remove=name=>{if(layers[name]){map.removeLayer(layers[name]);delete layers[name]}};
 const wrap=(x,ref)=>lonNear(x,ref);
 const valid=data=>data?.validTime===validAtFor(forecastHour)&&Array.isArray(data.points);
 function plot(name,items){remove(name);if(items.length)layers[name]=L.layerGroup(items).addTo(map)}
 function windBarbs(){
  if(!flags.barbs||!valid(grid)){remove('barbs');return}
  const items=[],seen=new Set(),size=map.getSize();let stride=Math.max(2,Math.ceil(5/Math.max(.35,map.getZoom()/6)));
  for(const p of grid.points){if(p.lat%stride||Math.round(p.lon)%stride)continue;
   const point=map.latLngToContainerPoint([p.lat,wrap(p.lon,map.getCenter().lng)]);if(point.x<0||point.x>size.x||point.y<0||point.y>size.y)continue;
   const key=Math.round(point.x/65)+','+Math.round(point.y/65);if(seen.has(key))continue;seen.add(key);
   if(!Number.isFinite(p.u)||!Number.isFinite(p.v))continue;
   const speed=Math.round(Math.hypot(p.u,p.v)*1.943844/5)*5;
   const heading=(Math.atan2(-p.u,-p.v)*180/Math.PI+360)%360;
   let rest=speed,pennants=Math.floor(rest/50);rest%=50;const full=Math.floor(rest/10);rest%=10;const half=rest>=5;
   let shapes='<path d="M0 16 V-15" stroke="#fff" stroke-width="1.7" fill="none"/>';
   let y=-15;
   for(let k=0;k<pennants;k++){shapes+='<path d="M0 '+y+' L11 '+(y+5)+' L0 '+(y+9)+' Z" fill="#fff"/>';y+=10}
   for(let k=0;k<full;k++){shapes+='<path d="M0 '+y+' L11 '+(y+7)+'" stroke="#fff" stroke-width="1.7"/>';y+=5}
   if(half)shapes+='<path d="M0 '+y+' L6 '+(y+4)+'" stroke="#fff" stroke-width="1.7"/>';
   const html='<svg width="38" height="38" viewBox="-19 -19 38 38" style="transform:rotate('+heading+'deg);filter:drop-shadow(0 1px 2px #00111b)"><g>'+shapes+'</g></svg>';
   items.push(L.marker([p.lat,wrap(p.lon,map.getCenter().lng)],{icon:L.divIcon({className:'',html,iconSize:[38,38],iconAnchor:[19,19]}),interactive:false}))
  }
  plot('barbs',items)
 }
 // Marching squares yields short, accurate isopleth segments from actual gridded values.
 // Join marching-square segments by shared endpoints, then smooth their display geometry.
 // NOAA pressure values and contour levels stay unchanged.
 function smoothContour(points){
  if(points.length<3)return points;
  let line=points;
  for(let pass=0;pass<2;pass++){
   const next=[line[0]];
   for(let i=0;i<line.length-1;i++){
    const a=line[i],b=line[i+1];
    next.push([.75*a[0]+.25*b[0],.75*a[1]+.25*b[1]],[.25*a[0]+.75*b[0],.25*a[1]+.75*b[1]]);
   }
   next.push(line[line.length-1]);line=next;
  }
  return line
 }
 function contours(data,field,levels,color){
  const items=[];if(!valid(data))return items;
  const pts=data.points,lookup=new Map(pts.map(p=>[p.lat.toFixed(3)+','+p.lon.toFixed(3),p]));
  const at=(a,b)=>lookup.get(a.toFixed(3)+','+b.toFixed(3));
  const lats=[...new Set(pts.map(p=>p.lat))].sort((a,b)=>a-b),lons=[...new Set(pts.map(p=>p.lon))].sort((a,b)=>a-b);
  const edges=[[0,1],[1,2],[2,3],[3,0]],segments=new Map();
  let count=0;
  for(let i=0;i<lats.length-1;i++)for(let j=0;j<lons.length-1;j++){
   const a=lats[i],b=lats[i+1],c=lons[j],d=lons[j+1],xy=[[a,c],[a,d],[b,d],[b,c]];
   const ps=xy.map(x=>at(...x));if(ps.some(p=>!Number.isFinite(p?.[field])))continue;
   const vs=ps.map(p=>p[field]);
   for(const level of levels){
    const crossings=[];
    for(const [x,y] of edges){
     const v1=vs[x],v2=vs[y];
     if((v1<level&&v2>=level)||(v2<level&&v1>=level)){
      const t=(level-v1)/(v2-v1);
      crossings.push([xy[x][0]+t*(xy[y][0]-xy[x][0]),xy[x][1]+t*(xy[y][1]-xy[x][1])]);
     }
    }
    for(let k=0;k+1<crossings.length;k+=2){
     if(++count>10000)break;
     if(!segments.has(level))segments.set(level,[]);
     segments.get(level).push([crossings[k],crossings[k+1]]);
    }
   }
  }
  const key=p=>p[0].toFixed(5)+','+p[1].toFixed(5);
  for(const [level,edgesForLevel] of segments){
   const adjacency=new Map();
   edgesForLevel.forEach((edge,i)=>edge.forEach(p=>{const k=key(p);if(!adjacency.has(k))adjacency.set(k,[]);adjacency.get(k).push(i)}));
   const used=new Set();
   for(let i=0;i<edgesForLevel.length;i++){
    if(used.has(i))continue;
    used.add(i);const line=[...edgesForLevel[i]];
    for(const head of [false,true]){
     while(true){
      const end=head?line[0]:line[line.length-1],candidate=(adjacency.get(key(end))||[]).find(j=>!used.has(j));
      if(candidate===undefined)break;
      used.add(candidate);const edge=edgesForLevel[candidate],other=key(edge[0])===key(end)?edge[1]:edge[0];
      if(head)line.unshift(other);else line.push(other);
     }
    }
    if(line.length<2)continue;
    const smooth=field==='mslp'?smoothContour(line):line;
    items.push(L.polyline(smooth.map(p=>[p[0],wrap(p[1],map.getCenter().lng)]),{color,weight:field==='mslp'?1.6:1.25,opacity:.9,interactive:false,smoothFactor:.5}));
   }
  }
  return items
 }
 function pressure(){
  if(!flags.pressure){remove('pressure');return}
  const data=grid;
  if(valid(data)&&!data.points.some(p=>Number.isFinite(p.mslp))){remove('pressure');$('status').textContent='NOAA pressure field unavailable · isobars not shown';return}
  plot('pressure',contours(data,'mslp',Array.from({length:81},(_,i)=>920+i*2),'#edf3ff'))
 }
 function waveContours(){
  if(!flags.waves){remove('waves');return}
  // Height remains meters in NOAA GRIB; levels converted from 3-ft increments.
  plot('waves',contours(waveGrid,'height',Array.from({length:15},(_,i)=>(i+1)*3/3.28084),'#7ddbe7'))
 }
 function centers(){
  if(!flags.centers||!valid(grid)){remove('centers');return}
  const items=[],pts=grid.points;
  const by=new Map(pts.map(p=>[p.lat.toFixed(3)+','+p.lon.toFixed(3),p]));
  const seen=[];
  for(const p of pts){if(!Number.isFinite(p.mslp))continue;
   const neighborhood=[];for(const dy of [-2,-1,0,1,2])for(const dx of [-2,-1,0,1,2]){if(!dx&&!dy)continue;const q=by.get((p.lat+dy).toFixed(3)+','+(p.lon+dx).toFixed(3));if(q&&Number.isFinite(q.mslp))neighborhood.push(q.mslp)}
   if(neighborhood.length<16||seen.some(q=>Math.abs(q.lat-p.lat)<5&&longitudeDelta(q.lon,p.lon)<5))continue;
   const high=neighborhood.every(v=>v<p.mslp),low=neighborhood.every(v=>v>p.mslp);
   if(!high&&!low)continue;seen.push(p);
   const letter=high?'H':'L',color=high?'#78baf5':'#f68c8c';
   items.push(L.marker([p.lat,wrap(p.lon,map.getCenter().lng)],{icon:L.divIcon({className:'',html:'<div style="font-size:22px;font-weight:bold;color:'+color+';text-shadow:0 1px 3px #001">'+letter+'<small style="font-size:10px">'+Math.round(p.mslp)+'</small></div>',iconSize:[65,32],iconAnchor:[17,15]}),interactive:false}))
  }
  plot('centers',items)
 }
 function swell(){
  if(!flags.swell||!valid(waveGrid)){remove('swell');return}
  const items=[],seen=new Set();
  for(const p of waveGrid.points){if(!Number.isFinite(p.swellDirection))continue;
   const pixel=map.latLngToContainerPoint([p.lat,wrap(p.lon,map.getCenter().lng)]),size=map.getSize();
   if(pixel.x<0||pixel.y<0||pixel.x>size.x||pixel.y>size.y)continue;
   const key=Math.floor(pixel.x/90)+','+Math.floor(pixel.y/90);if(seen.has(key))continue;seen.add(key);
   // NOAA SWDIR is direction waves are coming FROM; glyph points toward propagation.
   const heading=(p.swellDirection+180)%360;
   items.push(L.marker([p.lat,wrap(p.lon,map.getCenter().lng)],{icon:L.divIcon({className:'',html:'<div style="transform:rotate('+heading+'deg);color:#b0f2eb;font-size:20px;text-shadow:0 1px 2px #000">↑</div>',iconSize:[20,22],iconAnchor:[10,11]}),interactive:false}))
  }
  plot('swell',items)
 }
 function update(){clearTimeout(schedule);schedule=setTimeout(()=>{windBarbs();pressure();waveContours();centers();swell()},65)}
 function toggle(name){flags[name]=!flags[name];update()}
 function preset(name){
  const next=name==='synoptic'?{barbs:true,pressure:true,centers:true,waves:false,swell:false}:name==='clean'?{barbs:false,pressure:false,centers:false,waves:false,swell:false}:{barbs:false,pressure:false,centers:false,waves:false,swell:false};
  Object.assign(flags,next);
  if(name==='clean'){windOn=false;clearLayers()}else {windOn=true;selectMode(name==='marine'?'wind':'wind')}
  update()
 }
 function frontsInfo(){$('status').textContent='Official frontal boundaries are not available from the NOAA GFS field feed. No synthetic fronts drawn.'}
 map.on('zoomend moveend',update);
 window.synoptic={flags,update,toggle,preset,frontsInfo};
})();
