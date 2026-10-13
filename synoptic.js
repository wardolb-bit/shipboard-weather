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
 // Cubic interpolation creates a smooth visual contour through joined NOAA isoline points.
 // Closed loops receive periodic tangents, avoiding the sharp closing corner.
 // Interpolate NOAA pressure as a scalar field before tracing its contours.
 // This avoids line splines that overshoot, cross and form unnatural corners.
 function contours(data,field,levels,color){
  if(!valid(data))return [];
  const pts=data.points;
  const lats=[...new Set(pts.map(p=>p.lat))].sort((a,b)=>a-b);
  const lons=[...new Set(pts.map(p=>p.lon))].sort((a,b)=>a-b);
  const lookup=new Map(pts.map(p=>[p.lat.toFixed(4)+','+p.lon.toFixed(4),p[field]]));
  const values=lats.map(y=>lons.map(x=>lookup.get(y.toFixed(4)+','+x.toFixed(4))));
  const ny=lats.length,nx=lons.length;
  if(ny<3||nx<3)return [];
  const refined=field==='mslp'?4:2;
  const cubic=(a,b,c,d,t)=>{
   const t2=t*t,t3=t2*t;
   return .5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3);
  };
  const clamp=(v,a,b)=>Math.max(Math.min(a,b),Math.min(Math.max(a,b),v));
  const at=(i,j)=>values[Math.max(0,Math.min(ny-1,i))][Math.max(0,Math.min(nx-1,j))];
  const sample=(i,j,fy,fx)=>{
   const corners=[at(i,j),at(i,j+1),at(i+1,j),at(i+1,j+1)];
   if(!corners.every(Number.isFinite))return NaN;
   if(field!=='mslp')return corners[0]*(1-fx)*(1-fy)+corners[1]*fx*(1-fy)+corners[2]*fx*fy+corners[3]*(1-fx)*fy;
   const rows=[];
   for(let dy=-1;dy<=2;dy++){
    const vs=[-1,0,1,2].map(dx=>at(i+dy,j+dx));
    if(!vs.every(Number.isFinite))return corners[0]*(1-fx)*(1-fy)+corners[1]*fx*(1-fy)+corners[2]*fx*fy+corners[3]*(1-fx)*fy;
    rows.push(cubic(...vs,fx));
   }
   return clamp(cubic(...rows,fy),Math.min(...corners),Math.max(...corners));
  };
  const segments=new Map();
  const edges=[[0,1],[1,2],[2,3],[3,0]];
  let count=0;
  for(let i=0;i<ny-1;i++)for(let j=0;j<nx-1;j++){
   if(![at(i,j),at(i,j+1),at(i+1,j),at(i+1,j+1)].every(Number.isFinite))continue;
   const cell=Array.from({length:refined+1},(_,y)=>Array.from({length:refined+1},(_,x)=>sample(i,j,y/refined,x/refined)));
   for(let iy=0;iy<refined;iy++)for(let ix=0;ix<refined;ix++){
    const x0=lons[j]+(lons[j+1]-lons[j])*ix/refined,x1=lons[j]+(lons[j+1]-lons[j])*(ix+1)/refined;
    const y0=lats[i]+(lats[i+1]-lats[i])*iy/refined,y1=lats[i]+(lats[i+1]-lats[i])*(iy+1)/refined;
    const xy=[[y0,x0],[y0,x1],[y1,x1],[y1,x0]];
    const vs=[cell[iy][ix],cell[iy][ix+1],cell[iy+1][ix+1],cell[iy+1][ix]];
    if(!vs.every(Number.isFinite))continue;
    for(const level of levels){
     if(level<Math.min(...vs)||level>Math.max(...vs))continue;
     const hits=new Map();
     for(let e=0;e<4;e++){const [u,v]=edges[e],a=vs[u],b=vs[v];
      if((a<level&&b>=level)||(b<level&&a>=level)){
       const t=(level-a)/(b-a);
       hits.set(e,[xy[u][0]+t*(xy[v][0]-xy[u][0]),xy[u][1]+t*(xy[v][1]-xy[u][1])]);
      }
     }
     if(!hits.size)continue;
     let pairs=[];
     const keys=[...hits.keys()];
     if(keys.length===2)pairs=[[keys[0],keys[1]]];
     else if(keys.length===4){
      // Resolve saddle cells using the bilinear central value, not arbitrary crossing.
      const center=vs.reduce((a,b)=>a+b,0)/4;
      pairs=(vs[0]>=level)===(center>=level)?[[0,1],[2,3]]:[[0,3],[1,2]];
     }
     for(const [u,v] of pairs){
      if(++count>80000)break;
      if(!segments.has(level))segments.set(level,[]);
      segments.get(level).push([hits.get(u),hits.get(v)]);
     }
    }
   }
  }
  const key=p=>p[0].toFixed(6)+','+p[1].toFixed(6);
  const items=[];
  for(const [,segmentsAtLevel] of segments){
   const adjacency=new Map();
   segmentsAtLevel.forEach((seg,i)=>seg.forEach(p=>{const k=key(p);if(!adjacency.has(k))adjacency.set(k,[]);adjacency.get(k).push(i)}));
   const visited=new Set();
   for(let i=0;i<segmentsAtLevel.length;i++){
    if(visited.has(i))continue;visited.add(i);
    const line=[...segmentsAtLevel[i]];
    for(const prepend of [false,true]){
     while(true){const end=prepend?line[0]:line.at(-1);
      const neighbor=(adjacency.get(key(end))||[]).find(id=>!visited.has(id));
      if(neighbor===undefined)break;
      visited.add(neighbor);
      const segment=segmentsAtLevel[neighbor],point=key(segment[0])===key(end)?segment[1]:segment[0];
      if(prepend)line.unshift(point);else line.push(point);
     }
    }
    if(line.length<2)continue;
    items.push(L.polyline(line.map(p=>[p[0],wrap(p[1],map.getCenter().lng)]),{color,weight:field==='mslp'?1.5:1.25,opacity:.9,interactive:false,smoothFactor:0}));
   }
  }
  return items;
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
