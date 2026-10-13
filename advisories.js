'use strict';
(()=>{
 const q=id=>document.getElementById(id),key='ward-weather-vessel-advisories-v1',defaults={wind:35,gust:45,sea:12};
 let settings={...defaults};
 try{const data=JSON.parse(localStorage.getItem(key));if(data&&['wind','gust','sea'].every(k=>Number.isFinite(data[k])&&data[k]>0))settings={wind:data.wind,gust:data.gust,sea:data.sea}}catch(_){}
 const get=()=>({...settings});
 function set(next){if(!['wind','gust','sea'].every(k=>Number.isFinite(next[k])&&next[k]>0))return false;settings={wind:next.wind,gust:next.gust,sea:next.sea};try{localStorage.setItem(key,JSON.stringify(settings))}catch(_){};sync();update();document.dispatchEvent(new Event('vessel-advisories-changed'));return true}
 function sync(){q('advisoryWind').value=settings.wind;q('advisoryGust').value=settings.gust;q('advisorySea').value=settings.sea;for(const [id,k] of [['limitWind','wind'],['limitGust','gust'],['limitSea','sea']])if(q(id))q(id).value=settings[k]}
 function open(){sync();q('advisoryPanel').hidden=false}
 function close(){q('advisoryPanel').hidden=true}
 q('closeAdvisories').onclick=close;
 q('saveAdvisories').onclick=()=>{
  const data={wind:Number(q('advisoryWind').value),gust:Number(q('advisoryGust').value),sea:Number(q('advisorySea').value)};
  q('advisorySaveStatus').textContent=set(data)?'Saved in this browser · thresholds applied across the workstation.':'Enter positive wind, gust and sea-height thresholds.';
 };
 function numeric(text){if(!text||text.trim()==='--')return null;const val=Number.parseFloat(text);return Number.isFinite(val)?val:null}
 function classify(vals){
  const checked=Object.entries(vals).filter(([k,v])=>v!==null&&Number.isFinite(v)).map(([k,v])=>({k,v,over:v>=settings[k]}));
  return checked.length?checked.filter(v=>v.over):null;
 }
 function update(){
  const vals={wind:numeric(q('wind')?.textContent),gust:numeric(q('gustValue')?.textContent),sea:numeric(q('waveValue')?.textContent)};
  // Only describe a forecast when the loaded grids match the selected valid UTC hour.
  if(typeof validAtFor==='function'&&((grid&&grid.validTime!==validAtFor(forecastHour))||(waveGrid&&waveGrid.validTime!==validAtFor(forecastHour)))){
   q('advisoryStrip').textContent='VESSEL ADVISORIES · Loading selected NOAA forecast';q('advisoryStrip').style.color='#a6c7d4';return
  }
  const exceed=classify(vals),strip=q('advisoryStrip');
  if(!exceed){strip.textContent='VESSEL ADVISORIES · Awaiting NOAA forecast';strip.style.color='#a6c7d4';return}
  strip.textContent=exceed.length?'⚠ VESSEL ADVISORY · '+exceed.map(x=>x.k.toUpperCase()+' '+x.v.toFixed(x.k==='sea'?1:0)+' / '+settings[x.k]+(x.k==='sea'?' ft':' kt')).join(' · '):'VESSEL ADVISORIES · Loaded conditions below selected thresholds';
  strip.style.color=exceed.length?'#f2c26a':'#75d9bd';
 }
 function flagComparison(letter){
  // Called while each comparison result is updating; defer to allow both wind and wave values to land.
  setTimeout(()=>{
   if(!q('compareResults')||q('compareResults').hidden)return;
   const fields={wind:numeric(q('comp'+letter+'wind')?.textContent),gust:numeric(q('comp'+letter+'gust')?.textContent),sea:numeric(q('comp'+letter+'sea')?.textContent)};
   for(const [k,id] of [['wind','wind'],['gust','gust'],['sea','sea']]){
    const el=q('comp'+letter+id);if(!el)continue;const flagged=fields[k]!==null&&fields[k]>=settings[k];el.style.color=flagged?'#f2c26a':'';el.title=flagged?'Exceeds vessel advisory: '+settings[k]+(k==='sea'?' ft':' kt'):'';
   }
  },0);
 }
 sync();window.vesselAdvisories={open,close,get,set,update,flagComparison};
 setTimeout(update,250);
})();
