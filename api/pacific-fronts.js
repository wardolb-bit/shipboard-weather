// NOAA OPC experimental PGEN XML frontal lines; do not use stale source files.
const base='https://ftp.ocean.weather.gov/pgen/Pacific_HS_Surface.F';
module.exports=async function(req,res){
 const hour=Number(req.query.hour);
 const lead=hour<=12?'000':hour<=36?'024':'048';
 try{
  const response=await fetch(base+lead+'.xml',{signal:AbortSignal.timeout(14000),headers:{Accept:'application/xml,text/xml'}});
  if(!response.ok)throw Error('OPC product HTTP '+response.status);
  const xml=await response.text();
  if(xml.length<1000||xml.length>2500000||!/<Products\b/i.test(xml))throw Error('Invalid OPC PGEN document');
  const modified=response.headers.get('last-modified');
  if(!modified||!Number.isFinite(Date.parse(modified)))throw Error('OPC publication time unavailable');
  const ageHours=(Date.now()-Date.parse(modified))/3600000;
  if(ageHours>36||ageHours< -2)throw Error('OPC source stale ('+Math.round(ageHours)+' hours old)');
  res.setHeader('Cache-Control','s-maxage=900, stale-while-revalidate=300');
  res.setHeader('Content-Type','application/xml; charset=utf-8');
  return res.status(200).send(xml);
 }catch(e){console.error('OPC Pacific fronts:',String(e.message));return res.status(503).json({error:'OPC Pacific vector fronts unavailable: '+String(e.message).slice(0,150)})}
};
