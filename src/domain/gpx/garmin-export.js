const GPX_NS='http://www.topografix.com/GPX/1/1';
const GPXX_NS='http://www.garmin.com/xmlschemas/GpxExtensions/v3';
const WPTX1_NS='http://www.garmin.com/xmlschemas/WaypointExtension/v1';

export const GARMIN_NAME_PRESETS=Object.freeze({
  name:'{name}',dayName:'{day}-{name}',namePoints:'{name}-{points}',dayNamePoints:'{day}-{name}-{points}'
});

export const DEFAULT_GARMIN_EXPORT_OPTIONS=Object.freeze({
  scope:'all',currentDay:0,selectedDays:[],namePreset:'name',
  include:Object.freeze({checkpoint:true,waypoint:true,fuel:true,hotel:true,start:true,finish:true,route:true,track:true,backbone:true})
});

export function xmlEscape(value){
  return String(value??'').replace(/[<>&'\"]/g,character=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','\"':'&quot;'}[character]));
}

export function garminSymbol(feature){
  const type=String(feature?.type||'waypoint').toLowerCase();
  return Object.freeze({checkpoint:'Flag, Blue',fuel:'Gas Station',hotel:'Lodging',waypoint:'Waypoint',start:'Flag, Green',finish:'Flag, Red'})[type]||'Waypoint';
}

const displayType=feature=>{
  const type=String(feature?.type||'waypoint').trim();
  return type?type.charAt(0).toUpperCase()+type.slice(1):'Waypoint';
};
const explicitPoints=feature=>Number.isFinite(Number(feature?.points))?Number(feature.points):null;
const templateValue=(feature,placeholder)=>({
  name:String(feature?.name||'').trim(),day:Number(feature?.day)>0?`D${Number(feature.day)}`:'',
  points:explicitPoints(feature)===null?'':String(explicitPoints(feature)),type:displayType(feature),
  status:String(feature?.status||'').trim(),sequence:Number.isFinite(Number(feature?.sequence))?String(Number(feature.sequence)):''
})[placeholder]??'';

export function formatGarminWaypointName(feature,preset='name'){
  const template=GARMIN_NAME_PRESETS[preset]||GARMIN_NAME_PRESETS.name;
  const rendered=template.replace(/\{(name|day|points|type|status|sequence)\}/g,(_,key)=>templateValue(feature,key));
  const cleaned=rendered.replace(/[\s_-]*[-_][\s_-]*/g,'-').replace(/^[\s_-]+|[\s_-]+$/g,'').replace(/\s+/g,' ').trim();
  return cleaned||String(feature?.name||displayType(feature)||'Waypoint').trim()||'Waypoint';
}

export function garminCategories(feature){
  const categories=[];
  if(Number(feature?.day)>0)categories.push(`Day ${Number(feature.day)}`);
  categories.push(displayType(feature));
  return [...new Set(categories.filter(Boolean))];
}

export function garminDescription(feature){
  const parts=[displayType(feature),String(feature?.name||'').trim()];
  if(Number(feature?.day)>0)parts.push(`Day ${Number(feature.day)}`);
  const points=explicitPoints(feature);if(points!==null)parts.push(`${points} points`);
  return parts.filter(Boolean).join(' | ');
}

function selectedByScope(feature,options){
  const day=Number(feature?.day)||0;
  if(options.scope==='current')return day===Number(options.currentDay);
  if(options.scope==='selected')return new Set((options.selectedDays||[]).map(Number)).has(day);
  return true;
}

function selectedByType(feature,include){
  const kind=feature?.geometry?.kind,type=String(feature?.type||'waypoint').toLowerCase();
  if(kind==='point')return include[type]??include.waypoint??false;
  if(kind==='line')return type==='route'?include.route!==false:type==='backbone'?include.backbone!==false:include.track!==false;
  return false;
}

export function selectGarminFeatures(features,options={}){
  const resolved={...DEFAULT_GARMIN_EXPORT_OPTIONS,...options,include:{...DEFAULT_GARMIN_EXPORT_OPTIONS.include,...options.include}};
  return (features||[]).filter(feature=>selectedByScope(feature,resolved)&&selectedByType(feature,resolved.include));
}

function uniqueWaypointNames(features,preset){
  const counts=new Map();
  return new Map(features.map(feature=>{
    const base=formatGarminWaypointName(feature,preset),key=base.toLocaleLowerCase(),count=(counts.get(key)||0)+1;
    counts.set(key,count);return [feature,count===1?base:`${base}-${count}`];
  }));
}

const coordinate=(tag,point,indent='    ')=>`${indent}<${tag} lat="${Number(point.lat).toFixed(8)}" lon="${Number(point.lon).toFixed(8)}" />`;
const standardMetadata=feature=>`${feature.notes?`<cmt>${xmlEscape(feature.notes)}</cmt>`:''}<desc>${xmlEscape(garminDescription(feature))}</desc>`;

function waypointXml(feature,name){
  const point=feature.geometry.coordinates[0],categories=garminCategories(feature);
  const categoryXml=categories.map(category=>`          <gpxx:Category>${xmlEscape(category)}</gpxx:Category>`).join('\n');
  return `  <wpt lat="${Number(point.lat).toFixed(8)}" lon="${Number(point.lon).toFixed(8)}">
    <name>${xmlEscape(name)}</name>
    ${standardMetadata(feature)}
    <sym>${xmlEscape(garminSymbol(feature))}</sym>
    <type>${xmlEscape(displayType(feature))}</type>
    <extensions>
      <gpxx:WaypointExtension>
        <gpxx:Categories>
${categoryXml}
        </gpxx:Categories>
      </gpxx:WaypointExtension>
    </extensions>
  </wpt>`;
}

function routeXml(feature){
  const points=feature.geometry.coordinates||[];
  return `  <rte>
    <name>${xmlEscape(feature.name)}</name>
    ${standardMetadata(feature)}
${points.map(point=>coordinate('rtept',point)).join('\n')}
  </rte>`;
}

function trackXml(feature){
  const segments=Array.isArray(feature.geometry.segments)&&feature.geometry.segments.length?feature.geometry.segments:[feature.geometry.coordinates||[]];
  return `  <trk>
    <name>${xmlEscape(feature.name)}</name>
    ${standardMetadata(feature)}
${segments.map(segment=>`    <trkseg>
${segment.map(point=>coordinate('trkpt',point,'      ')).join('\n')}
    </trkseg>`).join('\n')}
  </trk>`;
}

export function buildGarminGpx({project,features,appVersion,exportedAt,options={}}={}){
  const resolved={...DEFAULT_GARMIN_EXPORT_OPTIONS,...options,include:{...DEFAULT_GARMIN_EXPORT_OPTIONS.include,...options.include}};
  const selected=selectGarminFeatures(features,resolved);
  if(!selected.length)throw new Error('No features match the Garmin export selection.');
  const points=selected.filter(feature=>feature.geometry?.kind==='point'),names=uniqueWaypointNames(points,resolved.namePreset);
  const body=[
    ...points.map(feature=>waypointXml(feature,names.get(feature))),
    ...selected.filter(feature=>feature.geometry?.kind==='line'&&feature.type==='route').map(routeXml),
    ...selected.filter(feature=>feature.geometry?.kind==='line'&&feature.type!=='route').map(trackXml)
  ].join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="CannonMap ${xmlEscape(appVersion)}"
  xmlns="${GPX_NS}"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:gpxx="${GPXX_NS}"
  xmlns:wptx1="${WPTX1_NS}"
  xsi:schemaLocation="${GPX_NS} ${GPX_NS}/gpx.xsd ${GPXX_NS} http://www8.garmin.com/xmlschemas/GpxExtensionsv3.xsd ${WPTX1_NS} http://www8.garmin.com/xmlschemas/WaypointExtensionv1.xsd">
  <metadata><name>${xmlEscape(project?.name||'CannonMap Garmin Export')}</name><time>${xmlEscape(exportedAt)}</time></metadata>
${body}
</gpx>`;
}
