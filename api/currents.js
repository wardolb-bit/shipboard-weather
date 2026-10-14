// Surface-current guidance from Open-Meteo Marine. No vessel location sent automatically.
module.exports=async function(req,res){
 try{
  const vals=['south','north','west','east'].map(k=>Number(req.query[k]));
  let [south,north,west,east]=vals;const validAt=new Date(String(req.query.validAt||''));
  if(vals.some(v=>!Number.isFinite(v))||!Number.isFinite(validAt.getTime())||south>=north||Math.abs(south)>85||Math.abs(north)>85||east<=west||east-west>360)return res.status(400).json({error:'Invalid chart bounds or valid time'});
  south=Math.max(-80,south);north=Math.min(80,north);
  const step=Math.max(3,Math.ceil(Math.sqrt((north-south)*(east-west)/110)));
  const locations=[];for(let y=Math.ceil(south/step)*step;y<=north;y+=step)for(let x=Math.ceil(west/step)*step;x<=east;x+=step)locations.push({lat:y,lon:((x+180)%360+360)%360-180});
  if(!locations.length)return res.status(422).json({error:'No ocean-current sample positions in visible chart'});
  const requestedHour=validAt.toISOString().slice(0,13)+':00';
  const points=[];let matched=0;
  for(let i=0;i<locations.length;i+=24){
   const group=locations.slice(i,i+24);
   const query=new URLSearchParams({latitude:group.map(p=>p.lat).join(','),longitude:group.map(p=>p.lon).join(','),hourly:'ocean_current_velocity,ocean_current_direction',wind_speed_unit:'kn',timezone:'UTC',forecast_days:'4',cell_selection:'sea'});
   const reply=await fetch('https://marine-api.open-meteo.com/v1/marine?'+query,{signal:AbortSignal.timeout(18000)});
   if(!reply.ok)throw Error('Current model HTTP '+reply.status);
   const decoded=await reply.json(),records=Array.isArray(decoded)?decoded:[decoded];
   for(let j=0;j<records.length;j++){
    const record=records[j],times=record.hourly?.time||[],index=times.indexOf(requestedHour);
    if(index<0)continue;matched++;
    const speed=Number(record.hourly.ocean_current_velocity?.[index]),dir=Number(record.hourly.ocean_current_direction?.[index]);
    if(!Number.isFinite(speed)||!Number.isFinite(dir)||speed<0||speed>15)continue;
    // Open-Meteo direction is the direction TO which the water travels.
    const angle=dir*Math.PI/180,position=group[j];
    points.push({lat:position.lat,lon:position.lon,u:speed*Math.sin(angle),v:speed*Math.cos(angle),speed,direction:dir});
   }
  }
  if(!matched)throw Error('Current forecast unavailable for selected UTC hour');
  if(!points.length)throw Error('Current model returned no valid ocean samples');
  res.setHeader('Cache-Control','s-maxage=900, stale-while-revalidate=300');
  return res.status(200).json({points,validTime:validAt.toISOString(),source:'Open-Meteo Marine ocean current model',step,requested:locations.length,available:points.length,units:'knots',directionConvention:'TO'});
 }catch(error){return res.status(503).json({error:String(error.message||error).slice(0,180)})}
};
