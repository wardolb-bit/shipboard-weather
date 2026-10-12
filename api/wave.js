// NOAA GFS Wave global 0.25° f000. GRIB2 fields are decoded on demand.
module.exports=async function(req,res){
 try{
 const forecastHour=Number(req.query.hour??0);if(!Number.isInteger(forecastHour)||forecastHour<0||forecastHour>72||forecastHour%3!==0)return res.status(400).json({error:'Unsupported forecast hour'});
 const lat=Number(req.query.lat),lon=Number(req.query.lon);
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>84||Math.abs(lon)>180)return res.status(400).json({error:'Invalid position'});
 const {splitMessages,parseFields,parseProduct,parseGrid,decodeFieldValues,nearestGridpoint}=await import('@azohra/meteo.grib');
 const run=new Date(Date.now()-8*3600000),date=run.toISOString().slice(0,10).replaceAll('-',''),cycle=String(Math.floor(run.getUTCHours()/6)*6).padStart(2,'0');
 const center=(lon+360)%360;if(center<12||center>348)return res.status(422).json({error:'Longitude seam subset support pending'});
 const north=Math.min(89,Math.ceil(lat+11)),south=Math.max(-89,Math.floor(lat-11)),west=Math.floor(center-11),east=Math.ceil(center+11);
 const params=new URLSearchParams({file:'gfswave.t'+cycle+'z.global.0p25.f'+String(forecastHour).padStart(3,'0')+'.grib2',dir:'/gfs.'+date+'/'+cycle+'/wave/gridded',subregion:'',leftlon:String(west),rightlon:String(east),toplat:String(north),bottomlat:String(south),var_HTSGW:'on',var_PERPW:'on',var_DIRPW:'on',var_SWELL:'on',var_SWPER:'on',var_SWDIR:'on',lev_surface:'on',lev_1_in_sequence:'on'});
 const url='https://nomads.ncep.noaa.gov/cgi-bin/filter_gfswave.pl?'+params;
 const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),22000);let resp;
 try{resp=await fetch(url,{signal:ctrl.signal})}finally{clearTimeout(timeout)}
 if(!resp.ok)throw Error('NOAA GFS Wave HTTP '+resp.status);
 const bytes=new Uint8Array(await resp.arrayBuffer());if(bytes.length<32||String.fromCharCode(...bytes.slice(0,4))!=='GRIB')throw Error('GFS Wave did not return GRIB2');if(bytes.length>12500000)throw Error('GFS Wave subset exceeds size limit');
 const fields={};
 for(const message of splitMessages(bytes))for(const f of parseFields(message)){
  if(f.discipline!==10)continue;
  const p=parseProduct(f.section4);if(p.parameterCategory!==0||![3,7,8,9,10,11].includes(p.parameterNumber))continue;
  const name=({3:'height',7:'swellDirection',8:'swell',9:'swellPeriod',10:'direction',11:'period'})[p.parameterNumber];
  if(fields[name])continue;
  const geometry=parseGrid(f.section3),decoded=decodeFieldValues(f);
  fields[name]={geometry,values:decoded.values};
 }
 if(!fields.height)throw Error('GFS Wave HTSGW missing from decoded GRIB2');
 const points=[];for(let y=south;y<=north;y++)for(let x=west;x<=east;x++){
  const obj={lat:y,lon:x>180?x-360:x};
  for(const [key,f] of Object.entries(fields)){const v=Number(f.values[nearestGridpoint(f.geometry,y,x).index]);if(Number.isFinite(v)&&v>=0&&v<(key.toLowerCase().includes('direction')?361:key.toLowerCase().includes('period')?61:41))obj[key]=v}
  if(Number.isFinite(obj.height))points.push(obj);
 }
 if(points.length<10)throw Error('NOAA returned insufficient marine wave grid points');
 res.setHeader('Cache-Control','s-maxage=1200, stale-while-revalidate=600');
 return res.status(200).json({points,step:1,validTime:new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(4,6))-1,Number(date.slice(6,8)),Number(cycle)+forecastHour)).toISOString()+' (GFS Wave f'+String(forecastHour).padStart(3,'0')+')',source:'NOAA NOMADS GFS Wave',modelRun:date+'T'+cycle+':00Z',forecastHour});
 }catch(e){console.error('NOAA GFS Wave ingest:',e.message,e.cause?.message||'');return res.status(503).json({error:'NOAA GFS Wave unavailable: '+String(e.message).slice(0,130)})}
};