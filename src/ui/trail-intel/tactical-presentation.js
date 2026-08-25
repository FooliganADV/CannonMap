const htmlEscape=value=>String(value??'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[char]));

const RIDER_PALETTE=Object.freeze([
  '#f97316','#38bdf8','#22c55e','#e879f9','#facc15','#fb7185','#2dd4bf','#a78bfa',
  '#f43f5e','#84cc16','#06b6d4','#f59e0b','#60a5fa','#c084fc','#4ade80','#f472b6',
  '#fb923c','#0ea5e9','#10b981','#d946ef','#eab308','#e11d48','#14b8a6','#8b5cf6'
]);

const finite=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))?Number(value):null;

function stableHash(value){
  let hash=2166136261;
  for(const char of String(value)){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619)>>>0;}
  return hash;
}

/** The upstream rider number is the tactical label; the stable stream id remains the data key. */
export function riderSourceLabel(rider){
  const direct=rider?.competitorNumber??rider?.competitor_number??rider?.number??rider?.riderNumber??rider?.rider_number;
  if(direct!==undefined&&direct!==null&&String(direct).trim())return String(direct).trim().replace(/^#/,'');
  const signature=String(rider?.signature??'').trim();
  if(/^#?\d+$/.test(signature))return signature.replace(/^#/,'');
  // A number embedded in an arbitrary name (for example, "Team 2026") is not
  // an upstream rider number. Only accept an explicit Rider/# label fallback.
  const name=String(rider?.name??'').trim(),match=name.match(/(?:^|\b)(?:rider\s*#?|#)(\d+)\b/i);
  if(match)return match[1];
  return String(rider?.id??rider?.competitorId??'Unknown').trim()||'Unknown';
}

export function assignRiderColors(riders,{registry=new Map()}={}){
  const allocation=registry instanceof Map?registry:new Map(),keys=[...new Set((riders||[]).map(rider=>String(rider?.id??rider?.competitorId??riderSourceLabel(rider))))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),used=new Set(allocation.values()),result=new Map();
  for(const key of keys){
    if(allocation.has(key)){result.set(key,allocation.get(key));continue;}
    const start=stableHash(key)%RIDER_PALETTE.length;let color=null;
    for(let offset=0;offset<RIDER_PALETTE.length;offset++){const candidate=RIDER_PALETTE[(start+offset)%RIDER_PALETTE.length];if(!used.has(candidate)){color=candidate;break;}}
    if(!color){let attempt=0;do{const hue=(stableHash(key)+attempt*137)%360,lightness=[50,58,66][Math.floor(attempt/360)%3];color=`hsl(${hue} 82% ${lightness}%)`;attempt++;}while(used.has(color)&&attempt<1080);}
    used.add(color);allocation.set(key,color);result.set(key,color);
  }
  return result;
}

export function riderVisualIdentity(rider,{color=null}={}){
  const key=String(rider?.id??rider?.competitorId??riderSourceLabel(rider)),label=riderSourceLabel(rider);
  // Color follows immutable stream identity, so a delayed standings/number update cannot recolor the rider.
  return Object.freeze({key,label,color:color||RIDER_PALETTE[stableHash(key)%RIDER_PALETTE.length]});
}

export function riderEmphasis(rider,selectedRiderId=null){
  const id=riderVisualIdentity(rider).key,selected=selectedRiderId===null||selectedRiderId===undefined||String(selectedRiderId)===''?null:String(selectedRiderId);
  return Object.freeze({selected:selected===id,dimmed:selected!==null&&selected!==id});
}

export function competitorMarkerIconSpec(rider,{selectedRiderId=null,displayOffset=null,color=null}={}){
  const identity=riderVisualIdentity(rider,{color}),emphasis=riderEmphasis(rider,selectedRiderId);
  const offsetX=finite(displayOffset?.x)??0,offsetY=finite(displayOffset?.y)??0;
  const classes=['competitor-rider-marker',emphasis.selected?'is-selected':'',emphasis.dimmed?'is-dimmed':''].filter(Boolean).join(' ');
  return Object.freeze({
    key:identity.key,label:identity.label,color:identity.color,className:classes,
    html:`<span class="competitor-rider-marker__face" style="--rider-color:${identity.color};--rider-offset-x:${offsetX}px;--rider-offset-y:${offsetY}px" aria-label="Rider ${htmlEscape(identity.label)}">${htmlEscape(identity.label)}</span>`,
    size:emphasis.selected?46:40,zIndexOffset:emphasis.selected?1200:emphasis.dimmed?0:500
  });
}

export function competitorTrailStyle(rider,{fresh=true,opacity=1,selectedRiderId=null,color=null}={}){
  const identity=riderVisualIdentity(rider,{color}),emphasis=riderEmphasis(rider,selectedRiderId),base=Math.max(0,Math.min(1,Number(opacity)||0));
  const emphasisOpacity=emphasis.selected ? 1 : emphasis.dimmed ? .14 : fresh ? .9 : .45;
  return Object.freeze({
    color:identity.color,weight:emphasis.selected?7:emphasis.dimmed?2:fresh?4:3,opacity:base*emphasisOpacity,
    dashArray:fresh?null:'7 7',pane:emphasis.selected?'activeRiderPane':'competitorTrailsPane',
    className:`competitor-rider-trail${emphasis.selected?' is-selected':''}${emphasis.dimmed?' is-dimmed':''}`
  });
}

/** Clusters are an overview aid only; tactical/navigation zooms retain individual rider markers. */
export function shouldShowTacticalCluster({zoom,riderCount,maxZoom=10}={}){
  return Number(riderCount)>1&&Number.isFinite(Number(zoom))&&Number(zoom)<=Number(maxZoom);
}

export function competitorClusterIconSpec(cluster){
  const riders=(cluster?.riders||[]).map(rider=>({id:String(rider.id),label:riderSourceLabel(rider)})),count=riders.length;
  return Object.freeze({
    count,className:'competitor-rider-cluster',
    html:`<span class="competitor-rider-cluster__face" aria-label="${count} riders nearby"><b>${count}</b><small>RIDERS</small></span>`,
    size:48,riderLabels:Object.freeze(riders.map(rider=>rider.label))
  });
}

export function competitorClusterPopupHtml(cluster,{escapeHtml=htmlEscape}={}){
  const riders=(cluster?.riders||[]).map(rider=>{
    const label=riderSourceLabel(rider),status=String(rider.status||'unknown').toUpperCase();
    return `<button type="button" class="competitor-cluster-rider" data-rider-id="${escapeHtml(rider.id)}"><b>${escapeHtml(label)}</b><span>${escapeHtml(status)}</span></button>`;
  }).join('');
  return `<section class="competitor-cluster-popup"><strong>${cluster?.riders?.length||0} riders nearby</strong><div>${riders}</div><small>Tap a rider to isolate its marker and trail.</small></section>`;
}

/** Keep cluster reconciliation independent of each rider's bounded-but-large trail history. */
export function clusterPresentationRider(rider={},clusterRow={}){
  return Object.freeze({
    id:String(clusterRow.id??rider.id??rider.competitorId??''),
    name:String(rider.name??clusterRow.name??''),
    number:rider.number??null,
    competitor_number:rider.competitor_number??null,
    competitorNumber:rider.competitorNumber??null,
    riderNumber:rider.riderNumber??null,
    rider_number:rider.rider_number??null,
    signature:rider.signature??null,
    status:String(clusterRow.status??'unknown'),
    motion:String(clusterRow.motion??'unknown'),
    lastUpdate:clusterRow.lastUpdate??null
  });
}

/** Fingerprint only map/presentation state; never stringify breadcrumb arrays. */
export function competitorClusterFingerprint(cluster={}){
  return JSON.stringify({
    id:String(cluster.id??''),
    center:{lat:finite(cluster.center?.lat),lon:finite(cluster.center?.lon)},
    latestUpdate:cluster.latestUpdate??null,
    riders:(cluster.riders||[]).map(rider=>({
      id:String(rider.id??''),label:riderSourceLabel(rider),name:String(rider.name??''),
      status:String(rider.status??'unknown'),motion:String(rider.motion??'unknown'),lastUpdate:rider.lastUpdate??null
    }))
  });
}

export function headingPresentation(degrees){
  const heading=finite(degrees);
  if(heading===null)return Object.freeze({degrees:null,cardinal:'—',arrow:'·'});
  const normalized=(heading%360+360)%360,index=Math.round(normalized/45)%8;
  return Object.freeze({degrees:normalized,cardinal:['N','NE','E','SE','S','SW','W','NW'][index],arrow:['↑','↗','→','↘','↓','↙','←','↖'][index]});
}

export function freshnessPresentation(status){
  const state=String(status?.status||'offline').toLowerCase();
  if(state==='live')return Object.freeze({label:'LIVE',state:'live'});
  if(state==='stale')return Object.freeze({label:'STALE',state:'stale'});
  return Object.freeze({label:'OFFLINE',state:'offline'});
}

const speedValue=status=>finite(status?.currentSpeedMph??status?.recentSpeedMph??status?.smoothedSpeedMph??status?.speedMph);
const rollingValue=status=>finite(status?.rollingPaceMph??status?.paceMph??status?.recentPaceMph);
const sustainedValue=status=>finite(status?.sustainedPaceMph);
const mph=value=>value===null?'—':String(Math.round(Math.max(0,value)));

export function compactRiderRowModel(rider,status={},selectedRiderId=null,{color=null}={}){
  const identity=riderVisualIdentity(rider,{color}),emphasis=riderEmphasis(rider,selectedRiderId),heading=headingPresentation(status.headingDegrees??status.direction??status.heading),freshness=freshnessPresentation(status);
  const speed=speedValue(status),rolling=rollingValue(status),sustained=sustainedValue(status),rawMotion=String(status.motion||'unknown').toLowerCase();
  const motion=['stationary','stopped'].includes(rawMotion)?'STOPPED':rawMotion==='moving'?'MOVING':'UNKNOWN',gaps=Math.max(0,Math.floor(finite(status.trailGapCount??status.gapCount)??0));
  return Object.freeze({
    id:identity.key,label:identity.label,color:identity.color,speedMph:speed,rollingPaceMph:rolling,sustainedPaceMph:sustained,
    speedLabel:mph(speed),rollingLabel:mph(rolling),sustainedLabel:mph(sustained),freshness:freshness.label,freshnessState:freshness.state,
    motion,gapCount:gaps,headingDegrees:heading.degrees,heading:status.headingCardinal||heading.cardinal,headingArrow:status.headingArrow||heading.arrow,
    selected:emphasis.selected,dimmed:emphasis.dimmed
  });
}

export function compactRiderRowHtml(rider,status={},selectedRiderId=null,{escapeHtml=htmlEscape,color=null}={}){
  const row=compactRiderRowModel(rider,status,selectedRiderId,{color}),gapLabel=row.gapCount?`${row.gapCount} GAP${row.gapCount===1?'':'S'}`:'';
  return `<button type="button" class="tactical-rider-row${row.selected?' is-selected':''}${row.dimmed?' is-dimmed':''}" data-rider-id="${escapeHtml(row.id)}" aria-pressed="${row.selected?'true':'false'}" style="--rider-color:${row.color}"><span class="tactical-rider-row__identity"><b>${escapeHtml(row.label)}</b><small class="is-${escapeHtml(row.freshnessState)}">${escapeHtml(row.freshness)}</small></span><span><strong>${escapeHtml(row.speedLabel)}</strong><small>NOW</small></span><span><strong>${escapeHtml(row.rollingLabel)}</strong><small>3 MIN</small></span><span><strong>${escapeHtml(row.sustainedLabel)}</strong><small>15 MIN</small></span><span class="tactical-rider-row__heading" aria-label="Heading ${escapeHtml(row.heading)}"><strong>${escapeHtml(row.headingArrow)}</strong><small>${escapeHtml(row.heading)}</small></span><span class="tactical-rider-row__motion"><strong>${escapeHtml(row.motion)}</strong><small>${escapeHtml(gapLabel||'TRACK')}</small></span></button>`;
}

export function compactRiderListHtml(riders,{selectedRiderId=null,statusForRider=()=>({}),colorForRider=()=>null,escapeHtml=htmlEscape}={}){
  const rows=(riders||[]).map(rider=>compactRiderRowHtml(rider,statusForRider(rider),selectedRiderId,{escapeHtml,color:colorForRider(rider)})).join('');
  const reset=selectedRiderId===null||selectedRiderId===undefined||String(selectedRiderId)===''?'':`<button type="button" class="tactical-rider-reset" data-rider-view-all>ALL RIDERS</button>`;
  return `${reset}<div class="tactical-rider-list">${rows}</div>`;
}

/** Pure deterministic screen-space fan-out for overlapping markers. */
export function deterministicMarkerOffsets(markers,{project=point=>point,minimumSeparationPx=46}={}){
  const rows=(markers||[]).map(marker=>({id:String(marker.id),screen:project(marker.point),offset:{x:0,y:0}})).filter(row=>finite(row.screen?.x)!==null&&finite(row.screen?.y)!==null),visited=new Set();
  for(let start=0;start<rows.length;start++){
    if(visited.has(start))continue;
    const group=[],queue=[start];visited.add(start);
    while(queue.length){
      const index=queue.shift(),current=rows[index];group.push(current);
      for(let candidate=0;candidate<rows.length;candidate++){
        if(visited.has(candidate))continue;const point=rows[candidate].screen;
        if(Math.hypot(current.screen.x-point.x,current.screen.y-point.y)<minimumSeparationPx){visited.add(candidate);queue.push(candidate);}
      }
    }
    group.sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
    if(group.length===2){group[0].offset={x:-24,y:0};group[1].offset={x:24,y:0};continue;}
    if(group.length>2){
      // Six positions per ring-step keeps neighboring 40 px markers separated,
      // including dense same-coordinate feeds, without order-dependent jitter.
      const ringStep=Math.max(48,minimumSeparationPx+2);let cursor=0,ring=1;
      while(cursor<group.length){
        const capacity=ring*6,count=Math.min(capacity,group.length-cursor),radius=ring*ringStep,phase=ring%2?0:Math.PI/capacity;
        for(let index=0;index<count;index++){const angle=-Math.PI/2+phase+index*2*Math.PI/count;group[cursor+index].offset={x:Math.round(Math.cos(angle)*radius),y:Math.round(Math.sin(angle)*radius)};}
        cursor+=count;ring++;
      }
    }
  }
  return new Map(rows.map(row=>[row.id,Object.freeze(row.offset)]));
}

export function competitorDiagnosticSummary(rider){
  const identity=riderVisualIdentity(rider);
  return Object.freeze({id:identity.key,label:identity.label,breadcrumbCount:Array.isArray(rider?.points)?rider.points.length:0});
}
