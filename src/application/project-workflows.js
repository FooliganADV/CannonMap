import {distancePointToSegmentMiles,haversineMeters,lineDistanceMiles,validPoint} from '../domain/geo/geometry.js';

const textOf=(element,tag)=>{
  const node=element.getElementsByTagName(tag)[0]||element.getElementsByTagNameNS?.('*',tag)?.[0];
  return node?node.textContent.trim():'';
};

export function createProjectWorkflows({createId,now,parseXml,normalizeCheckpoint,rallyCheckpointNumber,filterFeatures}){
  if(typeof createId!=='function'||typeof now!=='function'||typeof parseXml!=='function')throw new TypeError('Project workflow dependencies are required.');

  function inferDay(text,fallback=0){
    const value=String(text||'').replace(/<[^>]*>/g,' ').trim();
    const wordDays={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8};
    const patterns=[/\bday[\s_:#-]*0?([1-8])\b/i,/\bd[\s_:#-]*0?([1-8])\b/i,/^\s*0?([1-8])\s*[.\-_]/,/\b0?([1-8])\s*[.\-_]\s*\d+\b/,/\b0?([1-8])[\s_-]*(?:start|finish|route|track|checkpoint|cp)\b/i];
    for(const pattern of patterns){const match=value.match(pattern);if(match)return Number(match[1]);}
    const wordMatch=value.match(/\bday\s+(one|two|three|four|five|six|seven|eight)\b/i);
    return wordMatch?wordDays[wordMatch[1].toLowerCase()]||fallback:fallback;
  }

  function nearestAssignedDay(point,lines){
    let best={day:0,d:Infinity};
    for(const line of lines){
      const points=line.geometry.coordinates,stride=Math.max(1,Math.floor(points.length/500));
      for(let index=stride;index<points.length;index+=stride){
        const distance=distancePointToSegmentMiles(point,points[Math.max(0,index-stride)],points[index]);
        if(distance<best.d)best={day:line.day,d:distance};
      }
    }
    return best.d<=45?best.day:0;
  }

  function assignLineDays(features){
    let changed=0;
    const lines=features.filter(feature=>feature.geometry.kind==='line');
    for(const feature of lines){
      if(feature.day)continue;
      const explicit=inferDay(`${feature.name} ${feature.notes} ${feature.source}`,0);
      if(explicit){feature.day=explicit;feature.assignmentMethod='explicit';changed++;}
    }
    const remaining=lines.filter(feature=>!feature.day);
    if(remaining.length===8)remaining.forEach((feature,index)=>{feature.day=index+1;feature.assignmentMethod='line-order';changed++;});
    return changed;
  }

  function assignWaypointDays(features,onlyUnassigned=true){
    let changed=assignLineDays(features);
    const assignedLines=features.filter(feature=>feature.geometry.kind==='line'&&feature.day>=1&&feature.day<=8);
    for(const feature of features.filter(feature=>feature.geometry.kind==='point'&&(!onlyUnassigned||!feature.day))){
      if(onlyUnassigned&&feature.day)continue;
      const explicit=inferDay(`${feature.name} ${feature.notes} ${feature.source}`,0);
      if(explicit){
        if(feature.day!==explicit){feature.day=explicit;changed++;}
        feature.assignmentMethod='explicit';
        continue;
      }
      const day=nearestAssignedDay(feature.geometry.coordinates[0],assignedLines);
      if(day){
        if(feature.day!==day){feature.day=day;changed++;}
        feature.assignmentMethod='route-proximity';
      }
    }
    return changed;
  }

  function classifyPoint(name,notes,symbol=''){
    const value=`${name} ${notes} ${symbol}`.toLowerCase();
    if(/\bfuel\b|\bgas\b|gasoline|service station/.test(value))return 'fuel';
    if(/\bhotel\b|\bmotel\b|\blodging\b|\binn\b/.test(value))return 'hotel';
    if(/checkpoint|\bcp\s*\d*\b|\bstart\b|\bfinish\b|\bdirt\b|\bextreme\b|type\s+(standard|dirt|extreme|finish)/.test(value))return 'checkpoint';
    return rallyCheckpointNumber(name)?'checkpoint':'waypoint';
  }

  function parseGpx(xmlText,filename){
    const document=parseXml(xmlText);
    if(document.querySelector('parsererror'))throw new Error('The file is not valid GPX/XML.');
    const features=[];let sourceOrder=0;
    const base=(name,type,notes,geometry)=>({id:createId(),name,type,day:inferDay(`${name} ${notes} ${filename}`),assignmentMethod:'',notes,visible:true,source:filename,sourceOrder:sourceOrder++,createdAt:now(),updatedAt:now(),geometry});
    [...document.getElementsByTagName('rte')].forEach((route,index)=>{
      const name=textOf(route,'name')||`${filename} route ${index+1}`,notes=textOf(route,'desc')||textOf(route,'cmt');
      const coordinates=[...route.getElementsByTagName('rtept')].map(point=>({lat:Number(point.getAttribute('lat')),lon:Number(point.getAttribute('lon'))})).filter(validPoint);
      if(coordinates.length)features.push(base(name,'route',notes,{kind:'line',coordinates}));
    });
    [...document.getElementsByTagName('trk')].forEach((track,index)=>{
      const name=textOf(track,'name')||`${filename} track ${index+1}`,notes=textOf(track,'desc')||textOf(track,'cmt'),segments=[...track.getElementsByTagName('trkseg')];
      segments.forEach((segment,segmentIndex)=>{
        const coordinates=[...segment.getElementsByTagName('trkpt')].map(point=>({lat:Number(point.getAttribute('lat')),lon:Number(point.getAttribute('lon'))})).filter(validPoint);
        if(coordinates.length)features.push(base(segments.length>1?`${name} segment ${segmentIndex+1}`:name,'track',notes,{kind:'line',coordinates}));
      });
    });
    [...document.getElementsByTagName('wpt')].forEach((waypoint,index)=>{
      const name=textOf(waypoint,'name')||`${filename} waypoint ${index+1}`,notes=textOf(waypoint,'desc')||textOf(waypoint,'cmt'),symbol=textOf(waypoint,'sym');
      const point={lat:Number(waypoint.getAttribute('lat')),lon:Number(waypoint.getAttribute('lon'))};
      if(!validPoint(point))return;
      const type=classifyPoint(name,notes,symbol),feature=base(name,type,notes,{kind:'point',coordinates:[point]});
      if(type==='checkpoint'){
        const read=tag=>textOf(waypoint,tag);
        Object.assign(feature,{status:read('status')||'planned',points:read('points')?Number(read('points')):undefined,extreme:/^(true|1|yes)$/i.test(read('extreme')),sequence:read('sequence')?Number(read('sequence')):undefined,completedAt:read('completedAt')||null,deferredAt:read('deferredAt')||null,deferReason:read('deferReason')||null,restoredAt:read('restoredAt')||null});
      }
      features.push(feature);
    });
    const safe=filterFeatures(features,`GPX ${filename}`).map(normalizeCheckpoint);
    return {features:safe,auto:assignWaypointDays(safe,true)};
  }

  const normalizedName=value=>String(value||'').toLowerCase().replace(/<[^>]*>/g,' ').replace(/[^a-z0-9]+/g,' ').trim();
  function featureDuplicate(imported,existing){
    if(imported.geometry.kind!==existing.geometry.kind)return false;
    const sameName=normalizedName(imported.name)===normalizedName(existing.name);
    if(imported.geometry.kind==='point'){
      const distance=haversineMeters(imported.geometry.coordinates[0],existing.geometry.coordinates[0]);
      return distance<=40||(sameName&&distance<=805);
    }
    if(imported.type!==existing.type&&!sameName)return false;
    const ia=imported.geometry.coordinates[0],ib=imported.geometry.coordinates.at(-1),ea=existing.geometry.coordinates[0],eb=existing.geometry.coordinates.at(-1);
    return sameName&&Math.min(haversineMeters(ia,ea)+haversineMeters(ib,eb),haversineMeters(ia,eb)+haversineMeters(ib,ea))<=1609;
  }

  function applyImport(project,features,mode){
    let added=0,updated=0,skipped=0;
    if(mode==='replace'){project.features=filterFeatures(features,'GPX replace').map(normalizeCheckpoint);added=features.length;}
    else if(mode==='add'){project.features.push(...filterFeatures(features,'GPX add').map(normalizeCheckpoint));added=features.length;}
    else for(const incoming of features){
      const existing=project.features.find(item=>featureDuplicate(incoming,item));
      if(existing){
        Object.assign(existing,{name:incoming.name||existing.name,type:incoming.type||existing.type,notes:incoming.notes||existing.notes,source:incoming.source||existing.source,geometry:incoming.geometry,updatedAt:now()});
        if(incoming.day)existing.day=incoming.day;
        updated++;
      }else if(filterFeatures([incoming],'GPX merge').length){project.features.push(normalizeCheckpoint(incoming,project.features.length));added++;}
    }
    assignWaypointDays(project.features,true);
    return {added,updated,skipped,unassigned:project.features.filter(feature=>!feature.day).length};
  }

  const xmlEscape=value=>String(value??'').replace(/[<>&'"]/g,character=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[character]));
  function buildGpx({project,features,appVersion,exportedAt}){
    const waypoints=features.filter(feature=>feature.geometry.kind==='point').map(feature=>{
      const point=feature.geometry.coordinates[0];
      const extensions=feature.type==='checkpoint'?`<extensions><cannonmap:status>${xmlEscape(feature.status||'planned')}</cannonmap:status><cannonmap:points>${Number(feature.points)||10}</cannonmap:points><cannonmap:extreme>${feature.extreme?'true':'false'}</cannonmap:extreme><cannonmap:sequence>${Number(feature.sequence)||0}</cannonmap:sequence>${feature.completedAt?`<cannonmap:completedAt>${xmlEscape(feature.completedAt)}</cannonmap:completedAt>`:''}${feature.deferredAt?`<cannonmap:deferredAt>${xmlEscape(feature.deferredAt)}</cannonmap:deferredAt>`:''}${feature.deferReason?`<cannonmap:deferReason>${xmlEscape(feature.deferReason)}</cannonmap:deferReason>`:''}${feature.restoredAt?`<cannonmap:restoredAt>${xmlEscape(feature.restoredAt)}</cannonmap:restoredAt>`:''}</extensions>`:'';
      return `  <wpt lat="${point.lat.toFixed(8)}" lon="${point.lon.toFixed(8)}"><name>${xmlEscape(feature.name)}</name><desc>${xmlEscape(feature.notes||'')}</desc><type>${xmlEscape(feature.type)}</type>${extensions}</wpt>`;
    }).join('\n');
    const routes=features.filter(feature=>feature.type==='route'&&feature.geometry.kind==='line').map(feature=>`  <rte><name>${xmlEscape(feature.name)}</name><desc>${xmlEscape(feature.notes||'')}</desc>\n${feature.geometry.coordinates.map(point=>`    <rtept lat="${point.lat.toFixed(8)}" lon="${point.lon.toFixed(8)}" />`).join('\n')}\n  </rte>`).join('\n');
    const tracks=features.filter(feature=>feature.type!=='route'&&feature.geometry.kind==='line').map(feature=>`  <trk><name>${xmlEscape(feature.name)}</name><desc>${xmlEscape(feature.notes||'')}</desc><trkseg>\n${feature.geometry.coordinates.map(point=>`    <trkpt lat="${point.lat.toFixed(8)}" lon="${point.lon.toFixed(8)}" />`).join('\n')}\n  </trkseg></trk>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="CannonMap ${appVersion}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:cannonmap="https://cannonmap.pages.dev/schema/1">\n<metadata><name>${xmlEscape(project.name)}</name><time>${exportedAt}</time></metadata>\n${waypoints}\n${routes}\n${tracks}\n</gpx>`;
  }

  function duplicateFeature(feature){
    const copy=JSON.parse(JSON.stringify(feature,(key,value)=>key==='_layer'?undefined:value));
    copy.id=createId();copy.name=`${copy.name} copy`;copy.createdAt=now();copy.updatedAt=copy.createdAt;
    copy.geometry.coordinates=copy.geometry.coordinates.map(point=>({lat:point.lat+.002,lon:point.lon+.002}));
    return copy;
  }

  function createPortableProject({project,settings,appVersion,build,exportedAt}){
    const safeSettings=JSON.parse(JSON.stringify(settings));
    delete safeSettings.tomtomApiKey;
    return {format:'CannonMap Project',schemaVersion:1,appVersion,build,exportedAt,project:JSON.parse(JSON.stringify(project,(key,value)=>key==='_layer'?undefined:value)),settings:safeSettings};
  }

  function readPortableProject(payload){
    const project=payload?.project||payload;
    if(!project||!Array.isArray(project.features))throw new Error('This is not a valid CannonMap project file.');
    return {project,settings:payload?.settings||null};
  }

  function buildManifestRows(features){
    const typeOrder={checkpoint:1,fuel:2,hotel:3,waypoint:4,route:5,track:6,backbone:7};
    return features.map((feature,index)=>{
      const point=feature.geometry.coordinates[0]||{},distance=feature.geometry.kind==='line'?lineDistanceMiles(feature.geometry.coordinates):0;
      return {
        Day:feature.day||'Unassigned',Sequence:feature.sequence||index+1,Name:feature.name,Type:feature.type,
        Latitude:Number.isFinite(point.lat)?point.lat:'',Longitude:Number.isFinite(point.lon)?point.lon:'',
        'Point Count':feature.geometry.coordinates.length,'Distance (mi)':Number(distance.toFixed(2)),
        Status:feature.type==='checkpoint'?(feature.status||'planned'):'',Points:feature.type==='checkpoint'?(Number(feature.points)||(feature.extreme?21:10)):'',Extreme:feature.type==='checkpoint'?(feature.extreme?'Yes':'No'):'',
        'Completed At':feature.completedAt||'','Deferred At':feature.deferredAt||'','Defer Reason':feature.deferReason||'','Restored At':feature.restoredAt||'',Notes:feature.notes||'','Source GPX':feature.source||'',Visible:feature.visible?'Yes':'No',
        'Assignment Method':feature.assignmentMethod||'','Updated At':feature.updatedAt||''
      };
    }).sort((a,b)=>(Number(a.Day)||99)-(Number(b.Day)||99)||(typeOrder[a.Type]||99)-(typeOrder[b.Type]||99)||a.Sequence-b.Sequence);
  }

  return Object.freeze({
    inferDay,nearestAssignedDay,assignLineDays,assignWaypointDays,classifyPoint,parseGpx,featureDuplicate,
    applyImport,buildGpx,duplicateFeature,createPortableProject,readPortableProject,buildManifestRows
  });
}
