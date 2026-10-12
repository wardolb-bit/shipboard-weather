// NOAA GFS 10 m wind vector endpoint. Keeps model retrieval separate from map rendering.
module.exports=async function(req,res){
 try{
  const lat=Number(req.query.lat),lon=Number(req.query.lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85||Math.abs(lon)>180)return res.status(400).json({error:'Invalid position'});
  const north=Math.min(89.5,Math.round((lat+19)*2)/2),south=Math.max(-89.5,Math.round((lat-19)*2)/2);
  const mid=(lon+360)%360,west=Math.max(0,Math.round((mid-24)*2)/2),east=Math.min(359.5,Math.round((mid+24)*2)/2);
  if(west>=east)return res.status(422).json({error:'Area crosses NOAA longitude seam; select a nearby area'});
  const slice='[(last)][('+north+'):4:('+south+')][('+west+'):4:('+east+')]';
  const url='https://coastwatch.pfeg.noaa.gov/erddap/griddap/NCEP_Global_Best.json?'+encodeURIComponent('ugrd10m'+slice+',vgrd10m'+slice);
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),18000);let response;
  try{response=await fetch(url,{signal:controller.signal})}finally{clearTimeout(timeout)}
  if(!response.ok)throw Error('NOAA ERDDAP HTTP '+response.status);
  const data=await response.json(),columns=data.table?.columnNames||[],rows=data.table?.rows||[];
  const ix=['latitude','longitude','ugrd10m','vgrd10m','time'].map(key=>columns.indexOf(key));
  if(ix.some(i=>i<0))throw Error('NOAA changed its gridded response schema');
  const points=rows.map(r=>({lat:Number(r[ix[0]]),lon:Number(r[ix[1]])>180?Number(r[ix[1]])-360:Number(r[ix[1]]),u:Number(r[ix[2]]),v:Number(r[ix[3]])})).filter(p=>[p.lat,p.lon,p.u,p.v].every(Number.isFinite)&&Math.abs(p.u)<150&&Math.abs(p.v)<150);
  if(points.length<6)throw Error('NOAA returned insufficient wind samples');
  res.setHeader('Cache-Control','s-maxage=900, stale-while-revalidate=600');
  return res.status(200).json({points,validTime:rows[0][ix[4]],step:2});
 }catch(error){return res.status(503).json({error:'NOAA wind temporarily unavailable: '+String(error.message).slice(0,120)})}
}