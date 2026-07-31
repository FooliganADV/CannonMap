export const JOURNAL_SCHEMA_VERSION=1;
export const JOURNAL_EVENT_SCHEMA_VERSION=1;

export const BUILT_IN_JOURNAL_EVENT_TYPES=Object.freeze([
  'ride_started','ride_finished','day_started','day_finished',
  'checkpoint_completed','hotel_arrival','route_recalculated',
  'weather_alert','road_hazard','photo_added','video_added',
  'voice_note','rider_note','emergency_event','system_event'
]);

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clone=value=>structuredClone(value);
const object=(value,name)=>{
  if(value===undefined||value===null)return {};
  if(typeof value!=='object'||Array.isArray(value))throw new TypeError(`${name} must be an object.`);
  return clone(value);
};
const requiredString=(value,name)=>{
  const normalized=String(value??'').trim();
  if(!normalized)throw new TypeError(`${name} is required.`);
  return normalized;
};
const utc=value=>{
  const date=new Date(value);
  if(Number.isNaN(date.valueOf()))throw new TypeError('timestamp must be a valid date.');
  return date.toISOString();
};

function containsEmbeddedMedia(value,seen=new Set()){
  if(value===null||value===undefined)return false;
  if(typeof value==='string')return /^data:(?:image|video|audio)\//i.test(value);
  if(typeof Blob!=='undefined'&&value instanceof Blob)return true;
  if(value instanceof ArrayBuffer||ArrayBuffer.isView(value))return true;
  if(typeof value!=='object'||seen.has(value))return false;
  seen.add(value);
  return Object.values(value).some(item=>containsEmbeddedMedia(item,seen));
}

/**
 * Event-type registries are composition-scoped. Built-in definitions are
 * always recognized; plugins can register names without mutating global state.
 * Unknown types remain valid so journals survive newer producers.
 */
export function createJournalEventTypeRegistry(additionalTypes=[]){
  const types=new Set(BUILT_IN_JOURNAL_EVENT_TYPES);
  const register=eventType=>{
    const normalized=requiredString(eventType,'eventType');
    types.add(normalized);
    return normalized;
  };
  for(const type of additionalTypes)register(type);
  return Object.freeze({
    register,
    has:eventType=>types.has(String(eventType)),
    list:()=>Object.freeze([...types].sort())
  });
}

export function createJournalEvent(input,{createId,clock}={}){
  if(typeof createId!=='function')throw new TypeError('createId is required.');
  const eventId=String(input?.eventId||createId());
  if(!UUID.test(eventId))throw new TypeError('eventId must be a UUID.');
  const timestamp=utc(input?.timestamp??clock?.iso?.()??new Date().toISOString());
  const createdAt=utc(input?.createdAt??clock?.iso?.()??timestamp);
  const attachments=object(input?.attachments,'attachments');
  if(containsEmbeddedMedia(attachments))throw new TypeError('attachments may contain references only, not embedded media.');
  const eventType=requiredString(input?.eventType,'eventType');
  return Object.freeze({
    eventId,
    projectId:requiredString(input?.projectId,'projectId'),
    timestamp,
    eventType,
    source:requiredString(input?.source,'source'),
    title:String(input?.title??''),
    summary:String(input?.summary??''),
    metadata:object(input?.metadata,'metadata'),
    references:object(input?.references,'references'),
    attachments,
    createdAt,
    schemaVersion:Number(input?.schemaVersion||JOURNAL_EVENT_SCHEMA_VERSION)
  });
}

export function createRallyJournal(projectId,events=[]){
  const normalizedProjectId=requiredString(projectId,'projectId');
  const ordered=[...events].sort(compareJournalEvents);
  if(ordered.some(event=>event.projectId!==normalizedProjectId)){
    throw new TypeError('Every journal event must belong to the journal project.');
  }
  return Object.freeze({
    projectId:normalizedProjectId,
    schemaVersion:JOURNAL_SCHEMA_VERSION,
    events:Object.freeze(ordered.map(event=>Object.freeze(clone(event))))
  });
}

export function compareJournalEvents(left,right){
  return String(left.timestamp).localeCompare(String(right.timestamp))||
    String(left.createdAt).localeCompare(String(right.createdAt))||
    String(left.eventId).localeCompare(String(right.eventId));
}
