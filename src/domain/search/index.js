export const SEARCH_INDEX_SCHEMA_VERSION=1;
export const SEARCH_DOCUMENT_SCHEMA_VERSION=1;

const SOURCE_TYPES=new Set([
  'project','route','track','checkpoint','waypoint','hotel','journal_event',
  'rider_note','location','media_reference'
]);
const SOURCE_PRIORITY=Object.freeze({
  project:0,checkpoint:1,hotel:2,route:3,track:4,waypoint:5,location:6,
  rider_note:7,journal_event:8,media_reference:9
});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const array=value=>Array.isArray(value)?value:[];

export function normalizeSearchText(value){
  return String(value??'').normalize('NFKD').replace(/\p{Diacritic}/gu,'')
    .toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}

export function tokenizeSearchText(value){
  return [...new Set(normalizeSearchText(value).split(/\s+/).filter(Boolean))];
}

export function partialTerms(value){
  const terms=new Set();
  for(const token of tokenizeSearchText(value)){
    if(token.length<3){terms.add(token);continue;}
    for(const size of [2,3]){
      for(let start=0;start+size<=token.length;start++)terms.add(token.slice(start,start+size));
    }
  }
  return [...terms].sort();
}

const flattenStrings=(value,output=[],seen=new Set())=>{
  if(typeof value==='string'){output.push(value);return output;}
  if(value===null||value===undefined||typeof value!=='object'||seen.has(value))return output;
  seen.add(value);
  for(const item of Array.isArray(value)?value:Object.values(value))flattenStrings(item,output,seen);
  return output;
};

export function createSearchDocument({
  projectId,sourceType,sourceId,title='',content='',sourceUpdatedAt=null
}){
  const normalizedProjectId=String(projectId??'').trim();
  const normalizedSourceId=String(sourceId??'').trim();
  const normalizedSourceType=String(sourceType??'').trim();
  if(!normalizedProjectId||!normalizedSourceId)throw new TypeError('projectId and sourceId are required.');
  if(!SOURCE_TYPES.has(normalizedSourceType))throw new TypeError(`Unsupported search source type: ${normalizedSourceType}`);
  const displayTitle=String(title||'').slice(0,512);
  const normalizedTitle=normalizeSearchText(displayTitle).slice(0,512);
  const normalizedContent=normalizeSearchText(content).slice(0,8192);
  const terms=partialTerms(`${normalizedTitle} ${normalizedContent}`);
  return Object.freeze({
    projectId:normalizedProjectId,sourceType:normalizedSourceType,sourceId:normalizedSourceId,
    title:displayTitle,normalizedTitle,normalizedContent,terms,
    scopedTerms:terms.map(term=>`${normalizedProjectId}\u0000${term}`),
    sourceUpdatedAt:sourceUpdatedAt?new Date(sourceUpdatedAt).toISOString():null,
    schemaVersion:SEARCH_DOCUMENT_SCHEMA_VERSION
  });
}

function featureSourceType(feature){
  const type=String(feature?.type||'').toLowerCase();
  if(type==='backbone')return 'track';
  return SOURCE_TYPES.has(type)?type:'location';
}

function featureDocument(projectId,feature,index){
  const sourceType=featureSourceType(feature);
  const sourceId=String(feature?.id||feature?.featureId||`${sourceType}-${index}`);
  const title=feature?.name||feature?.title||feature?.label||sourceId;
  const content=[
    feature?.description,feature?.notes,feature?.riderNotes,feature?.address,
    feature?.city,feature?.county,feature?.state,feature?.properties
  ].flatMap(value=>flattenStrings(value)).join(' ');
  return createSearchDocument({
    projectId,sourceType,sourceId,title,content,
    sourceUpdatedAt:feature?.updatedAt
  });
}

function noteDocument(projectId,note,index){
  const record=object(note),sourceId=String(record.noteId||record.id||`rider-note-${index}`);
  return createSearchDocument({
    projectId,sourceType:'rider_note',sourceId,
    title:record.title||`Rider note ${index+1}`,
    content:typeof note==='string'?note:flattenStrings(record).join(' '),
    sourceUpdatedAt:record.updatedAt||record.createdAt
  });
}

function journalDocuments(projectId,event){
  const documents=[createSearchDocument({
    projectId,sourceType:event.eventType==='rider_note'?'rider_note':'journal_event',
    sourceId:event.eventId,title:event.title||event.eventType,
    content:[event.summary,...flattenStrings(event.metadata),...flattenStrings(event.references)].join(' '),
    sourceUpdatedAt:event.createdAt||event.timestamp
  })];
  const mediaIds=[...new Set(flattenStrings(event.attachments))];
  for(const mediaId of mediaIds)documents.push(createSearchDocument({
    projectId,sourceType:'media_reference',sourceId:`${event.eventId}:${mediaId}`,
    title:mediaId,content:`${event.title||''} ${event.summary||''}`,
    sourceUpdatedAt:event.createdAt||event.timestamp
  }));
  return documents;
}

export function buildProjectSearchIndex({project,journalEvents=[]}={}){
  const source=object(project),projectId=String(source.projectId||source.id||'').trim();
  if(!projectId)throw new TypeError('Project identity is required.');
  const documents=[createSearchDocument({
    projectId,sourceType:'project',sourceId:projectId,title:source.name||'CannonMap Project',
    content:flattenStrings({
      description:source.description,metadata:source.metadata,settings:source.settings
    }).join(' '),sourceUpdatedAt:source.updatedAt
  })];
  array(source.features).forEach((feature,index)=>documents.push(featureDocument(projectId,feature,index)));
  array(source.notes).forEach((note,index)=>documents.push(noteDocument(projectId,note,index)));
  for(const event of journalEvents){
    if(event?.projectId===projectId)documents.push(...journalDocuments(projectId,event));
  }
  const unique=new Map(documents.map(document=>[
    `${document.sourceType}\u0000${document.sourceId}`,document
  ]));
  const ordered=[...unique.values()].sort(compareSearchDocuments);
  const revision=stableRevision(ordered.map(document=>[
    document.sourceType,document.sourceId,document.sourceUpdatedAt,document.normalizedTitle,document.normalizedContent
  ]));
  return Object.freeze({projectId,indexVersion:SEARCH_INDEX_SCHEMA_VERSION,revision,documents:Object.freeze(ordered)});
}

export function rankSearchDocument(document,query){
  const tokens=tokenizeSearchText(query),normalized=normalizeSearchText(query);
  if(!tokens.length)return null;
  let score=0;
  if(document.normalizedTitle===normalized)score+=1000;
  else if(document.normalizedTitle.startsWith(normalized))score+=700;
  else if(document.normalizedTitle.includes(normalized))score+=500;
  const titleTokens=tokenizeSearchText(document.normalizedTitle);
  const contentTokens=tokenizeSearchText(document.normalizedContent);
  for(const token of tokens){
    if(titleTokens.includes(token))score+=160;
    else if(titleTokens.some(value=>value.startsWith(token)))score+=120;
    else if(titleTokens.some(value=>value.includes(token)))score+=100;
    else if(contentTokens.includes(token))score+=80;
    else if(contentTokens.some(value=>value.startsWith(token)))score+=50;
    else if(contentTokens.some(value=>value.includes(token)))score+=40;
    else return null;
  }
  return Object.freeze({...document,score});
}

export function compareSearchResults(left,right){
  return right.score-left.score||
    (SOURCE_PRIORITY[left.sourceType]??99)-(SOURCE_PRIORITY[right.sourceType]??99)||
    left.normalizedTitle.localeCompare(right.normalizedTitle)||
    left.projectId.localeCompare(right.projectId)||
    left.sourceId.localeCompare(right.sourceId);
}

export function compareSearchDocuments(left,right){
  return left.projectId.localeCompare(right.projectId)||
    (SOURCE_PRIORITY[left.sourceType]??99)-(SOURCE_PRIORITY[right.sourceType]??99)||
    left.sourceId.localeCompare(right.sourceId);
}

function stableRevision(value){
  const text=JSON.stringify(value);
  let hash=2166136261;
  for(let index=0;index<text.length;index++){
    hash^=text.charCodeAt(index);
    hash=Math.imul(hash,16777619);
  }
  return `search-v${SEARCH_INDEX_SCHEMA_VERSION}-${(hash>>>0).toString(16).padStart(8,'0')}`;
}
