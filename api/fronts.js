// Official WPC frontal features. WPC day products are NOT time-synchronized GFS forecasts.
const SERVICE='https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/natl_fcst_wx_chart/MapServer';
module.exports=async function(req,res){
 const day=Number(req.query.day);
 if(![1,2,3].includes(day))return res.status(400).json({error:'Day must be 1, 2 or 3'});
 const layer={1:2,2:14,3:26}[day];
 try{
  const qs=new URLSearchParams({where:'1=1',outFields:'feat,idp_filedate,idp_ingestdate',returnGeometry:'true',outSR:'4326',f:'geojson'});
  const response=await fetch(SERVICE+'/'+layer+'/query?'+qs,{signal:AbortSignal.timeout(13000)});
  if(!response.ok)throw Error('NOAA WPC HTTP '+response.status);
  const data=await response.json();
  if(data.error)throw Error(data.error.message||'NOAA query error');
  if(data.type!=='FeatureCollection'||!Array.isArray(data.features))throw Error('No valid WPC geometry');
  const features=data.features.filter(x=>x.geometry&&['LineString','MultiLineString'].includes(x.geometry.type)).slice(0,1900);
  res.setHeader('Cache-Control','s-maxage=900, stale-while-revalidate=900');
  return res.json({day,source:'NOAA WPC National Forecast Chart',product:'Day '+day+' fronts (not GFS-hour-valid)',fetchedAt:new Date().toISOString(),features});
 }catch(e){console.error('NOAA WPC front ingest',String(e));return res.status(503).json({error:'Official WPC frontal data unavailable: '+String(e.message).slice(0,140)})}
};
