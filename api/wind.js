// Official NOAA NOMADS GFS 0.25° GRIB2 ingest: 10m U and V wind.
// A failed or unavailable model file must never be replaced by fabricated weather.
module.exports=async function(req,res){
 const forecastHour=Number(req.query.hour??0);if(!Number.isInteger(forecastHour)||forecastHour<0||forecastHour>72||forecastHour%3!==0)return res.status(400).json({error:'Unsupported forecast hour'});
 try{
  const lat=Number(req.query.lat),lon=Number(req.query.lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>84||Math.abs(lon)>180)
   return res.status(400).json({error:'Invalid geographical position'});
  const {splitMessages,parseFields,parseProduct,parseGrid,decodeFieldValues,nearestGridpoint}=await import('@azohra/meteo.grib');
  // Forecast +0 is current UTC hour, following NavDash's valid-time convention.
  const requested=String(req.query.validAt||'');const target=requested?new Date(requested):new Date();if(!Number.isFinite(target.getTime()))return res.status(400).json({error:'Invalid forecast UTC time'});target.setUTCMinutes(0,0,0);if(!requested)target.setUTCHours(target.getUTCHours()+forecastHour);
  const anchor=new Date();anchor.setUTCMinutes(0,0,0);anchor.setUTCHours(Math.floor(anchor.getUTCHours()/6)*6);
  let run=null,modelForecastHour=null;
  for(let i=0;i<8;i++){
   const t=new Date(anchor.getTime()-i*6*3600000),h=Math.round((target-t)/3600000);
   if(h<0||h>120)continue;
   const d=t.toISOString().slice(0,10).replaceAll('-',''),c=String(t.getUTCHours()).padStart(2,'0'),name='gfs.t'+c+'z.pgrb2.0p25.f'+String(h).padStart(3,'0');
   try{
    const idx=await fetch('https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/gfs.'+d+'/'+c+'/atmos/'+name+'.idx',{signal:AbortSignal.timeout(4500),headers:{Accept:'text/plain'}});
    if(!idx.ok)continue;
    const listing=await idx.text();
    if(listing.includes(':UGRD:10 m above ground:')&&listing.includes(':VGRD:10 m above ground:')){run={date:d,cycle:c};modelForecastHour=h;break}
   }catch(e){console.warn('GFS run check',c,String(e.message).slice(0,80))}
  }
  if(!run)throw Error('No published GFS run for requested UTC valid time');
  const {date,cycle}=run;
  const central=(lon+360)%360,west=Math.floor(central-11),east=Math.ceil(central+11);
  const north=Math.min(89,Math.ceil(lat+11)),south=Math.max(-89,Math.floor(lat-11));
  const file='gfs.t'+cycle+'z.pgrb2.0p25.f'+String(modelForecastHour).padStart(3,'0');
  const base={file,var_UGRD:'on',var_VGRD:'on',var_GUST:'on',var_PRMSL:'on',lev_mean_sea_level:'on',lev_surface:'on',lev_10_m_above_ground:'on',subregion:'',toplat:String(north),bottomlat:String(south),dir:'/gfs.'+date+'/'+cycle+'/atmos'};
  const filter='https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?';
  // NOAA's 0..360° seam: request each side separately and sample from its own GRIB geometry.
  const regions=west<0?[[west+360,359.99],[0,east]]:east>360?[[west,359.99],[0,east-360]]:[[west,east]];
  const segments=await Promise.all(regions.map(async([left,right])=>{
   const q=new URLSearchParams({...base,leftlon:String(left),rightlon:String(right)});
   const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),22000);let response;
   try{response=await fetch(filter+q,{signal:ctrl.signal})}finally{clearTimeout(timer)}
   if(!response.ok)throw Error('NOAA GRIB filter HTTP '+response.status);
   const bytes=new Uint8Array(await response.arrayBuffer());
   if(bytes.length<32||String.fromCharCode(...bytes.slice(0,4))!=='GRIB'||bytes.length>12500000)throw Error('Invalid NOAA GRIB subset');
   return {bytes,left,right};
  }));
  const inRegion=(x,r)=>x>=r.left-0.01&&x<=r.right+0.01;
  const sourceLongitude=x=>((x%360)+360)%360;
  const segmentFields=segments.map(segment=>{
   const decoded=[];
   for(const message of splitMessages(segment.bytes))for(const field of parseFields(message)){
    const product=parseProduct(field.section4);
    if(!((product.parameterCategory===2&&[2,3,22].includes(product.parameterNumber))||(product.parameterCategory===3&&product.parameterNumber===1)))continue;
    const geometry=parseGrid(field.section3),{values}=decodeFieldValues(field);
    decoded.push({component:product.parameterCategory===3?'mslp':product.parameterNumber===2?'u':product.parameterNumber===3?'v':'gust',values,geometry});
   }
   const u=decoded.find(x=>x.component==='u'),v=decoded.find(x=>x.component==='v'),gust=decoded.find(x=>x.component==='gust');
   if(!u||!v)throw Error('GRIB2 missing paired 10m wind fields');
   return {...segment,u,v,gust};
  });
  const points=[];
  const at=(y,x)=>{const nx=sourceLongitude(x),segment=segmentFields.find(r=>inRegion(nx,r));if(!segment)return null;
   const {u,v,gust,mslp}=segment,ui=nearestGridpoint(u.geometry,y,nx),vi=nearestGridpoint(v.geometry,y,nx);
   const eastward=Number(u.values[ui.index]),northward=Number(v.values[vi.index]);
   if(!Number.isFinite(eastward)||!Number.isFinite(northward)||Math.abs(eastward)>=160||Math.abs(northward)>=160)return null;
   return {lat:y,lon:x-360*Math.round((x-lon)/360),u:eastward,v:northward,...(gust?{gust:Number(gust.values[nearestGridpoint(gust.geometry,y,nx).index])}:{}),...(mslp?{mslp:Number(mslp.values[nearestGridpoint(mslp.geometry,y,nx).index])/100}:{})};
  };
  for(let y=south;y<=north;y++)for(let x=west;x<=east;x++){const p=at(y,x);if(p)points.push(p)}
  if(points.length<50)throw Error('Incomplete NOAA model subset');
  const shipSample=at(lat,central);
  if(shipSample){const segment=segmentFields.find(r=>inRegion(central,r));const nearest=nearestGridpoint(segment.u.geometry,lat,central);shipSample.sampleLat=nearest.latitude;shipSample.sampleLon=nearest.longitude}
  res.setHeader('Cache-Control','s-maxage=1200, stale-while-revalidate=600');
  res.status(200).json({points,step:1,validTime:target.toISOString(),modelRun:date+'T'+cycle+':00Z',forecastHour,modelForecastHour,shipSample,source:'NOAA NOMADS GFS 0.25° GRIB2',coverage:{north,south,west,east}});
 }catch(e){const cause=e.cause?.message||e.cause?.code||'';console.error('NOMADS GFS ingest error:',e.message,cause);res.status(503).json({error:'NOAA NOMADS GFS GRIB2 ingest unavailable: '+String(e.message).slice(0,140)})}
};