// Official NOAA NOMADS GFS 0.25° GRIB2 ingest: 10m U and V wind.
// A failed or unavailable model file must never be replaced by fabricated weather.
module.exports=async function(req,res){
 const errors=[];
 try{
  const lat=Number(req.query.lat),lon=Number(req.query.lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>84||Math.abs(lon)>180)
   return res.status(400).json({error:'Invalid geographical position'});
  const {splitMessages,parseFields,parseProduct,parseGrid,decodeFieldValues,nearestGridpoint}=await import('@azohra/meteo.grib');
  const now=new Date(),asOf=new Date(now.getTime()-8*3600000);
  const date=asOf.toISOString().slice(0,10).replaceAll('-','');
  const cycle=String(Math.floor(asOf.getUTCHours()/6)*6).padStart(2,'0');
  const north=Math.min(89,Math.ceil(lat+11)),south=Math.max(-89,Math.floor(lat-11));
  // Work in the 0..360 longitude domain; do not let a subset silently cross its seam.
  const central=(lon+360)%360;
  if(central<12||central>348)return res.status(422).json({error:'This initial NOMADS subset does not yet support crossing 0°E longitude. No alternative model substituted.'});
  const west=Math.floor(central-11),east=Math.ceil(central+11);
  const params=new URLSearchParams({file:'gfs.t'+cycle+'z.pgrb2.0p25.f000',var_UGRD:'on',var_VGRD:'on',var_GUST:'on',lev_surface:'on',lev_10_m_above_ground:'on',subregion:'',leftlon:String(west),rightlon:String(east),toplat:String(north),bottomlat:String(south),dir:'/gfs.'+date+'/'+cycle+'/atmos'});
  const url='https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?'+params;
  const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),22000);let response;
  try{response=await fetch(url,{signal:ctrl.signal,headers:{Accept:'application/octet-stream'}})}finally{clearTimeout(timeout)}
  if(!response.ok)throw Error('NOMADS GRIB Filter HTTP '+response.status);
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length<32||String.fromCharCode(...bytes.slice(0,4))!=='GRIB')throw Error('NOAA did not return GRIB2 binary');
  if(bytes.length>12500000)throw Error('NOAA subset exceeded maximum ingest size');
  const decoded=[];
  for(const message of splitMessages(bytes)){
   for(const field of parseFields(message)){
    const product=parseProduct(field.section4);
    if(product.parameterCategory!==2||![2,3,22].includes(product.parameterNumber))continue;
    const geometry=parseGrid(field.section3);
    const {values}=decodeFieldValues(field);
    decoded.push({component:product.parameterNumber===2?'u':product.parameterNumber===3?'v':'gust',values,geometry});
   }
  }
  const u=decoded.find(x=>x.component==='u'),v=decoded.find(x=>x.component==='v'),gust=decoded.find(x=>x.component==='gust');
  if(!u||!v)throw Error('GRIB2 did not contain paired 10m U/V wind fields');
  const points=[];
  for(let y=south;y<=north;y+=1)for(let x=west;x<=east;x+=1){
   const a=nearestGridpoint(u.geometry,y,x),b=nearestGridpoint(v.geometry,y,x);
   const eastward=Number(u.values[a.index]),northward=Number(v.values[b.index]);
   if(Number.isFinite(eastward)&&Number.isFinite(northward)&&Math.abs(eastward)<160&&Math.abs(northward)<160)
    points.push({lat:y,lon:x>180?x-360:x,u:eastward,v:northward,...(gust?{gust:Number(gust.values[nearestGridpoint(gust.geometry,y,x).index])}:{})});
  }
  if(points.length<50)throw Error('Incomplete NOAA model subset');
  res.setHeader('Cache-Control','s-maxage=1200, stale-while-revalidate=600');
  res.status(200).json({points,step:1,validTime:date+' '+cycle+':00 UTC (GFS f000)',modelRun:date+'T'+cycle+':00Z',forecastHour:0,source:'NOAA NOMADS GFS 0.25° GRIB2',coverage:{north,south,west,east}});
 }catch(e){const cause=e.cause?.message||e.cause?.code||'';console.error('NOMADS GFS ingest error:',e.message,cause);res.status(503).json({error:'NOAA NOMADS GFS GRIB2 ingest unavailable: '+String(e.message).slice(0,140)})}
};