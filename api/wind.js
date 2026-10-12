// NOAA GFS 10 m wind vector endpoint. Keeps model retrieval separate from map rendering.
module.exports=async function(req,res){
 try{
  const lat=Number(req.query.lat),lon=Number(req.query.lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85||Math.abs(lon)>180)return res.status(400).json({error:'Invalid position'});
  const north=Math.min(89.5,Math.round((lat+19)*2)/2),south=Math.max(-89.5,Math.round((lat-19)*2)/2);
  const mid=(lon+360)%360,west=Math.max(0,Math.round((mid-24)*2)/2),east=Math.min(359.5,Math.round((mid+24)*2)/2);
  if(west>=east)return res.status(422).json({error:'Area crosses NOAA longitude seam; select a nearby area'});
  const slice='[(last)][('+north+'):4:('+south+')][('+west+'):4:('+east+')]';
  // NOAA CoastWatch may be unavailable even while cached forecast data remains valid.
  // Fall back to NOAA Upwell's mirrored GFS dataset without fabricating a field.
  const query=encodeURIComponent('ugrd10m'+slice+',vgrd10m'+slice);
  const sources=[
   {name:'NOAA CoastWatch',url:'https://coastwatch.pfeg.noaa.gov/erddap/griddap/NCEP_Global_Best.json?'+query},
   {name:'NOAA Upwell',url:'https://upwell.pfeg.noaa.gov/erddap/griddap/ncep_global.json?'+query}
  ];
  let response,sourceName,errors=[];
  for(const source of sources){
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
   try{
    const candidate=await fetch(source.url,{signal:controller.signal,headers:{Accept:'application/json'}});
    if(!candidate.ok)throw Error('HTTP '+candidate.status);
    response=candidate;sourceName=source.name;break;
   }catch(err){
    const reason=err.cause?.code||err.cause?.message||err.message;
    console.error('GFS source failed',source.name,String(reason).slice(0,140));
    errors.push(source.name+': '+String(reason).slice(0,90));
   }finally{clearTimeout(timeout)}
  }
  if(!response)throw Error('Both NOAA sources failed. '+errors.join('; '));
  const data=await response.json(),columns=data.table?.columnNames||[],rows=data.table?.rows||[];
  const ix=['latitude','longitude','ugrd10m','vgrd10m','time'].map(key=>columns.indexOf(key));
  if(ix.some(i=>i<0))throw Error('NOAA changed its gridded response schema');
  const points=rows.map(r=>({lat:Number(r[ix[0]]),lon:Number(r[ix[1]])>180?Number(r[ix[1]])-360:Number(r[ix[1]]),u:Number(r[ix[2]]),v:Number(r[ix[3]])})).filter(p=>[p.lat,p.lon,p.u,p.v].every(Number.isFinite)&&Math.abs(p.u)<150&&Math.abs(p.v)<150);
  if(points.length<6)throw Error('NOAA returned insufficient wind samples');
  res.setHeader('Cache-Control','s-maxage=900, stale-while-revalidate=600');
  return res.status(200).json({points,validTime:rows[0][ix[4]],step:2,source:sourceName});
 }catch(error){console.error('NOAA wind upstream failure',String(error.message));return res.status(503).json({error:'NOAA wind temporarily unavailable: '+String(error.message).slice(0,180)})}
}