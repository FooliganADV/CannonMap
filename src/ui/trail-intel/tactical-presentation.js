const RIDER_PALETTE=Object.freeze([
  '#f97316','#38bdf8','#22c55e','#e879f9','#facc15','#fb7185',
  '#2dd4bf','#a78bfa','#f43f5e','#84cc16','#06b6d4','#f59e0b',
  '#60a5fa','#c084fc','#4ade80','#f472b6'
]);

const htmlEscape=value=>String(value??'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[char]));

const finite=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))?Number(value):null;

function colorIndex(value){
  let hash=0;
  for(const char of String(value))hash=(Math.imul(hash,31)+char.codePointAt(0))>>>0;
  return hash%RIDER_PALETTE.length;
}

/** The upstream competitor number is the tactical label; the internal id remains the data key. */
export function riderSourceLabel(rider){
  const direct=rider?.competitorNumber??rider?.number??rider?.riderNumber;
  if(direct!==undefined&&direct!==null&&String(direct).trim())return String(direct).trim().replace(/^#/,'');
  const signature=String(rider?.signature??'').trim();
  if(/^#?\d+$/.test(signature))return signature.replace(/^#/,'');
  const name=String(rider?.name??'').trim(),match=name.match(/(?:rider\s*)?#?(\d+)\b/i);
  if(match)return match[1];
  return String(rider?.id??'Unknown').trim()||'Unknown';
}

export function riderVisualIdentity(rider){
  const key=String(rider?.id??rider?.competitorId??riderSourceLabel(rider));
  const label=riderSourceLabel(rider);
  return Object.freeze({key,label,color:RIDER_PALETTE[colorIndex(label)]});
}

export function riderEmphasis(rider,selectedRiderId=null){
  const id=riderVisualIdentity(rider).key,selected=selectedRiderId===null||selectedRiderId===undefined||String(selectedRiderId)===''?null:String(selectedRiderId);
  return Object.freeze({selected:selected===id,dimmed:selected!==null&&selected!==id});
}

export function competitorMarkerIconSpec(rider,{selectedRiderId=null,displayOffset=null}={}){
  const identity=riderVisualIdentity(rider),emphasis=riderEmphasis(rider,selectedRiderId);
  const offsetX=finite(displayOffset?.x)??0,offsetY=finite(displayOffset?.y)??0;
  const classes=['competitor-rider-marker',emphasis.selected?'is-selected':'',emphasis.dimmed?'is-dimmed':''].filter(Boolean).join(' ');
  return Object.freeze({
    key:identity.key,
    label:identity.label,
    color:identity.color,
    className:classes,
    html:`<span class="competitor-rider-marker__face" style="--rider-color:${identity.color};--rider-offset-x:${offsetX}px;--rider-offset-y:${offsetY}px" aria-label="Rider ${htmlEscape(identity.label)}">${htmlEscape(identity.label)}</span>`,
    size:emphasis.selected?46:40,
    zIndexOffset:emphasis.selected?1200:emphasis.dimmed?0:500
  });
}

export function competitorTrailStyle(rider,{fresh=true,opacity=1,selectedRiderId=null}={}){
  const identity=riderVisualIdentity(rider),emphasis=riderEmphasis(rider,selectedRiderId),base=Math.max(0,Math.min(1,Number(opacity)||0));
  const emphasisOpacity=emphasis.selected ? 1 : emphasis.dimmed ? .14 : fresh ? .9 : .45;
  return Object.freeze({
    color:identity.color,
    weight:emphasis.selected?7:emphasis.dimmed?2:fresh?4:3,
    opacity:base*emphasisOpacity,
    dashArray:fresh?null:'7 7',
    pane:emphasis.selected?'activeRiderPane':'competitorTrailsPane',
    className:`competitor-rider-trail${emphasis.selected?' is-selected':''}${emphasis.dimmed?' is-dimmed':''}`
  });
}

/** Clusters are a low-zoom overview only. Useful navigation zooms retain individual markers. */
export function shouldShowTacticalCluster({zoom,riderCount,maxZoom=10}={}){
  return Number(riderCount)>1&&Number.isFinite(Number(zoom))&&Number(zoom)<=Number(maxZoom);
}

export function competitorClusterIconSpec(cluster){
  const riders=(cluster?.riders||[]).map(rider=>({id:String(rider.id),label:riderSourceLabel(rider)}));
  const count=riders.length;
  return Object.freeze({
    count,
    className:'competitor-rider-cluster',
    html:`<span class="competitor-rider-cluster__face" aria-label="${count} riders nearby"><b>${count}</b><small>RIDERS</small></span>`,
    size:48,
    riderLabels:Object.freeze(riders.map(rider=>rider.label))
  });
}

export function competitorClusterPopupHtml(cluster,{escapeHtml=htmlEscape}={}){
  const riders=(cluster?.riders||[]).map(rider=>{
    const label=riderSourceLabel(rider),status=String(rider.status||'unknown').toUpperCase();
    return `<button type="button" class="competitor-cluster-rider" data-rider-id="${escapeHtml(rider.id)}"><b>${escapeHtml(label)}</b><span>${escapeHtml(status)}</span></button>`;
  }).join('');
  return `<section class="competitor-cluster-popup"><strong>${cluster?.riders?.length||0} riders nearby</strong><div>${riders}</div><small>Tap a rider to isolate its marker and trail.</small></section>`;
}

export function headingPresentation(degrees){
  const heading=finite(degrees);
  if(heading===null)return Object.freeze({degrees:null,cardinal:'—',arrow:'·'});
  const normalized=(heading%360+360)%360,index=Math.round(normalized/45)%8;
  return Object.freeze({degrees:normalized,cardinal:['N','NE','E','SE','S','SW','W','NW'][index],arrow:['↑','↗','→','↘','↓','↙','←','↖'][index]});
}

export function freshnessPresentation(status){
  const state=String(status?.status||'offline').toLowerCase(),age=finite(status?.ageMs);
  if(state==='live')return Object.freeze({label:'LIVE',state:'live'});
  if(age!==null){
    const minutes=Math.max(0,Math.round(age/60000));
    return Object.freeze({label:minutes<60?`${minutes}m`:`${Math.floor(minutes/60)}h`,state});
  }
  return Object.freeze({label:state==='stale'?'STALE':'OFF',state});
}

function speedValue(status){
  return finite(status?.recentSpeedMph??status?.currentSpeedMph??status?.smoothedSpeedMph??status?.speedMph);
}

function paceValue(status){
  return finite(status?.rollingPaceMph??status?.paceMph??status?.recentPaceMph??status?.averageSpeedMph);
}

const mph=value=>value===null?'—':String(Math.round(Math.max(0,value)));

export function compactRiderRowModel(rider,status={},selectedRiderId=null){
  const identity=riderVisualIdentity(rider),emphasis=riderEmphasis(rider,selectedRiderId),heading=headingPresentation(status.headingDegrees??status.direction??status.heading),freshness=freshnessPresentation(status);
  const speed=speedValue(status),pace=paceValue(status);
  return Object.freeze({
    id:identity.key,label:identity.label,color:identity.color,
    speedMph:speed,paceMph:pace,speedLabel:mph(speed),paceLabel:mph(pace),
    freshness:freshness.label,freshnessState:freshness.state,
    heading:heading.cardinal,headingArrow:heading.arrow,
    selected:emphasis.selected,dimmed:emphasis.dimmed
  });
}

export function compactRiderRowHtml(rider,status={},selectedRiderId=null,{escapeHtml=htmlEscape}={}){
  const row=compactRiderRowModel(rider,status,selectedRiderId);
  return `<button type="button" class="tactical-rider-row${row.selected?' is-selected':''}${row.dimmed?' is-dimmed':''}" data-rider-id="${escapeHtml(row.id)}" aria-pressed="${row.selected?'true':'false'}" style="--rider-color:${row.color}"><b class="tactical-rider-row__id">${escapeHtml(row.label)}</b><span class="tactical-rider-row__speed"><strong>${escapeHtml(row.speedLabel)}</strong><small>mph</small></span><span class="tactical-rider-row__pace"><strong>${escapeHtml(row.paceLabel)}</strong><small>avg</small></span><span class="tactical-rider-row__freshness is-${escapeHtml(row.freshnessState)}">${escapeHtml(row.freshness)}</span><span class="tactical-rider-row__heading" aria-label="Heading ${escapeHtml(row.heading)}">${escapeHtml(row.headingArrow)}<small>${escapeHtml(row.heading)}</small></span></button>`;
}

export function compactRiderListHtml(riders,{selectedRiderId=null,statusForRider=()=>({}),escapeHtml=htmlEscape}={}){
  const rows=(riders||[]).map(rider=>compactRiderRowHtml(rider,statusForRider(rider),selectedRiderId,{escapeHtml})).join('');
  const reset=selectedRiderId===null||selectedRiderId===undefined||String(selectedRiderId)===''?'':`<button type="button" class="tactical-rider-reset" data-rider-view-all>ALL RIDERS</button>`;
  return `${reset}<div class="tactical-rider-list">${rows}</div>`;
}

/** Breadcrumb count stays available to diagnostics without entering the tactical row. */
export function competitorDiagnosticSummary(rider){
  const identity=riderVisualIdentity(rider);
  return Object.freeze({id:identity.key,label:identity.label,breadcrumbCount:Array.isArray(rider?.points)?rider.points.length:0});
}
