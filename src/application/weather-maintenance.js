const TEN_MINUTES=10*60*1000,TEN_MILES_METERS=10*1609.344;
export const WEATHER_CACHE_KEY='cannonmap.weather.context.v1';

export function createWeatherMaintenance({fetchWeather,storage,clock={now:()=>Date.now()},distanceMeters,online=()=>navigator.onLine,visible=()=>document.visibilityState==='visible',onContext=()=>{}}={}){
  if(typeof fetchWeather!=='function'||typeof distanceMeters!=='function')throw new TypeError('Weather fetch and distance dependencies are required.');
  let context=null,inFlight=null,lastMovingRefresh=0;
  const persist=value=>{context=value;try{storage?.setItem(WEATHER_CACHE_KEY,JSON.stringify(value));}catch{}onContext(value);return value;};
  const restore=()=>{try{const value=JSON.parse(storage?.getItem(WEATHER_CACHE_KEY)||'null');if(value?.fetchedAt){context={...value,cached:true,offline:!online()};onContext(context);}}catch{}return context;};
  const refresh=async(point,reason)=>{if(!point||!online()||inFlight)return context;inFlight=(async()=>{const value=await fetchWeather(point);return persist({...value,provider:value.provider||'Open-Meteo',requestCoordinates:{lat:point.lat,lon:point.lon},fetchedAt:new Date(clock.now()).toISOString(),cached:false,offline:false,refreshReason:reason});})();try{return await inFlight;}finally{inFlight=null;}};
  const stale=(maxAge=TEN_MINUTES)=>!context?.fetchedAt||clock.now()-Date.parse(context.fetchedAt)>=maxAge;
  const onGps=(point,{moving=false}={})=>{if(!visible())return Promise.resolve(context);const displaced=context?.requestCoordinates&&distanceMeters(point,context.requestCoordinates)>=TEN_MILES_METERS;const timed=moving&&clock.now()-lastMovingRefresh>=TEN_MINUTES;if(displaced||timed||!context){if(moving)lastMovingRefresh=clock.now();return refresh(point,displaced?'distance':context?'time':'startup');}return Promise.resolve(context);};
  const onArrival=point=>stale()?refresh(point,'arrival'):Promise.resolve(context);
  return Object.freeze({restore,refresh,onGps,onArrival,getContext:()=>context,isStale:stale});
}
