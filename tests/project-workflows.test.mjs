import assert from 'node:assert/strict';
import test from 'node:test';
import {createProjectWorkflows} from '../src/application/project-workflows.js';
import {normalizeCheckpoint,rallyCheckpointNumber} from '../src/domain/checkpoints/workflow.js';

const workflows=createProjectWorkflows({
  createId:()=>`id`,
  now:()=>`2026-01-01T00:00:00.000Z`,
  parseXml:()=>{throw new Error('not used');},
  normalizeCheckpoint,
  rallyCheckpointNumber,
  filterFeatures:features=>features.filter(feature=>feature.name!=='Old Coast Road')
});
const point=(id,name,lat,lon)=>({id,name,type:'waypoint',day:0,notes:'',source:'test',visible:true,createdAt:'x',updatedAt:'x',geometry:{kind:'point',coordinates:[{lat,lon}]}});

function simpleGpxDocument(xml){
  const childNodes=(source,tag)=>[...source.matchAll(new RegExp(`<(?:[a-z0-9_-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-z0-9_-]+:)?${tag}>`,'gi'))].map(match=>({textContent:match[1].replace(/<[^>]+>/g,'')}));
  const waypointNodes=[...xml.matchAll(/<wpt\s+([^>]*)>([\s\S]*?)<\/wpt>/gi)].map(match=>({
    getAttribute(name){return match[1].match(new RegExp(`${name}="([^"]*)"`,'i'))?.[1]||null;},
    getElementsByTagName(tag){return childNodes(match[2],tag);},
    getElementsByTagNameNS(_namespace,tag){return childNodes(match[2],tag);}
  }));
  return {querySelector:()=>null,getElementsByTagName:tag=>tag==='wpt'?waypointNodes:[]};
}

test('project workflow preserves day inference and duplicate semantics',()=>{
  assert.equal(workflows.inferDay('Day 4 checkpoint'),4);
  assert.equal(workflows.inferDay('day seven route'),7);
  assert.equal(workflows.featureDuplicate(point('a','Fuel',38,-105),point('b','Other',38.0001,-105)),true);
  assert.equal(workflows.featureDuplicate(point('a','Fuel',38,-105),point('b','Fuel',39,-105)),false);
});

test('project merge updates duplicates, adds new features, and filters prohibited entries',()=>{
  const project={features:[point('existing','Fuel',38,-105)]};
  const incoming=[
    {...point('duplicate','Fuel Updated',38.0001,-105),day:2},
    point('new','Hotel',39,-105),
    point('blocked','Old Coast Road',40,-105)
  ];
  const result=workflows.applyImport(project,incoming,'merge');
  assert.deepEqual(result,{added:1,updated:1,skipped:1,unassigned:1});
  assert.equal(project.features.length,2);
  assert.equal(project.features[0].name,'Fuel Updated');
  assert.equal(project.features[0].day,2);
  assert.equal(project.features[1].name,'Hotel');
});

test('project merge matches executable objectives by stable ID only',()=>{
  const checkpoint=(id,name,lat,status='upcoming')=>normalizeCheckpoint({...point(id,name,lat,-105),type:'checkpoint',day:1,status});
  const old=checkpoint('deleted-1.2','1.2 Removed',38,'active'),project={features:[old]};
  const result=workflows.applyImport(project,[checkpoint('current-1.5','1.5 Current',38.00001)],'merge');
  assert.equal(result.updated,0);
  assert.equal(result.added,1);
  assert.deepEqual(project.features.map(feature=>feature.id),['deleted-1.2','current-1.5']);
  assert.equal(project.features[0].status,'active','additive Merge retains the old member without transferring its identity');
  assert.equal(project.features[1].status,'upcoming');

  const moved=checkpoint('deleted-1.2','1.2 Renamed',39);
  workflows.applyImport(project,[moved],'merge');
  assert.equal(project.features[0].name,'1.2 Renamed');
  assert.equal(project.features[0].geometry.coordinates[0].lat,39);
  assert.equal(project.features[0].status,'active','same stable ID preserves current execution projection');
});

test('project Add regenerates a colliding stable objective ID',()=>{
  const existing=normalizeCheckpoint({...point('stable-1.1','1.1 Existing',38,-105),type:'checkpoint',day:1}),incoming=normalizeCheckpoint({...point('stable-1.1','1.1 Imported copy',39,-105),type:'checkpoint',day:1}),project={features:[existing]};
  const result=workflows.applyImport(project,[incoming],'add');
  assert.equal(result.added,1);
  assert.equal(project.features.length,2);
  assert.equal(new Set(project.features.map(feature=>feature.id)).size,2);
  assert.equal(project.features[1].id,'id');
});

test('project replace removes absent checkpoints while preserving matched stable identities',()=>{
  const checkpoint=(id,name,lat,status='upcoming')=>({...point(id,name,lat,-105),type:'checkpoint',day:1,status,scoreAwarded:status==='collected'?10:0});
  const project={features:[
    checkpoint('stable-1.1','1.1 Start',38,'collected'),
    checkpoint('deleted-1.2','1.2 Removed',38.1,'active'),
    checkpoint('stable-1.5','1.5 Current',38.5)
  ]},incoming=[
    checkpoint('stable-1.1','1.1 Start',38),
    checkpoint('stable-1.5','1.5 Current',38.5),
    checkpoint('parsed-new-1.6','1.6 New',38.6)
  ];
  const result=workflows.applyImport(project,incoming,'replace');
  assert.deepEqual(result,{added:1,updated:2,skipped:0,unassigned:0,replacementIdentity:{
    priorObjectiveCount:3,incomingObjectiveCount:3,retainedObjectiveIds:['stable-1.1','stable-1.5'],
    removedObjectiveIds:['deleted-1.2'],newObjectiveIds:['parsed-new-1.6'],requiresNewSession:false,
    requiresNewSessionDayNumbers:[]
  }});
  assert.deepEqual(project.features.map(feature=>feature.id),['stable-1.1','stable-1.5','parsed-new-1.6']);
  assert.ok(!project.features.some(feature=>feature.id==='deleted-1.2'));
});

test('project replace never reuses checkpoint identity by proximity or display name',()=>{
  const old={...point('old-1.2','1.2 Removed',38,-105),type:'checkpoint',day:1,status:'collected',scoreAwarded:10},incoming={...point('new-1.5','1.5 Current',38.00001,-105),type:'checkpoint',day:1,status:'upcoming'};
  const project={features:[old]},result=workflows.applyImport(project,[incoming],'replace');
  assert.equal(project.features[0].id,'new-1.5');
  assert.equal(project.features[0].scoreAwarded,0);
  assert.deepEqual(result.replacementIdentity,{priorObjectiveCount:1,incomingObjectiveCount:1,retainedObjectiveIds:[],removedObjectiveIds:['old-1.2'],newObjectiveIds:['new-1.5'],requiresNewSession:true,requiresNewSessionDayNumbers:[1]});
});

test('project replace reports zero stable continuity for the active day even when another day retains identity',()=>{
  const checkpoint=(id,name,day,lat)=>({...point(id,name,lat,-105),type:'checkpoint',day,status:'upcoming'});
  const project={features:[
    checkpoint('old-1.1','1.1 Removed',1,38),
    checkpoint('old-1.2','1.2 Removed',1,38.1),
    checkpoint('stable-2.1','2.1 Retained',2,39)
  ]},incoming=[
    checkpoint('new-1.5','1.5 New route',1,38.5),
    checkpoint('new-1.6','1.6 New route',1,38.6),
    checkpoint('stable-2.1','2.1 Retained',2,39)
  ];

  const result=workflows.applyImport(project,incoming,'replace');
  assert.equal(result.replacementIdentity.requiresNewSession,false,'project-wide identity is not wholly replaced because Day 2 survives');
  assert.deepEqual(result.replacementIdentity.retainedObjectiveIds,['stable-2.1']);
  assert.deepEqual(result.replacementIdentity.requiresNewSessionDayNumbers,[1],
    'an active Day 1 run must be superseded despite stable continuity on unrelated Day 2');
});

test('GPX export retains checkpoint extensions and route/track geometry',()=>{
  const features=[
    normalizeCheckpoint({...point('cp','Checkpoint',38,-105),type:'checkpoint',day:1,status:'deferred',points:21,extreme:true,sequence:4,deferReason:'Hotel bailout'}),
    {id:'route',name:'Route',type:'route',notes:'',geometry:{kind:'line',coordinates:[{lat:38,lon:-105},{lat:39,lon:-106}]}},
    {id:'track',name:'Track',type:'track',notes:'',geometry:{kind:'line',coordinates:[{lat:40,lon:-107},{lat:41,lon:-108}]}}
  ];
  const xml=workflows.buildGpx({project:{name:'Golden'},features,appVersion:'0.7.1',exportedAt:'2026-01-01T00:00:00.000Z'});
  assert.match(xml,/<cannonmap:status>deferred<\/cannonmap:status>/);
  assert.match(xml,/<cannonmap:checkpointId>cp<\/cannonmap:checkpointId>/);
  assert.match(xml,/<cannonmap:day>1<\/cannonmap:day>/);
  assert.match(xml,/<cannonmap:points>21<\/cannonmap:points>/);
  assert.match(xml,/<rtept lat="38.00000000" lon="-105.00000000"/);
  assert.match(xml,/<trkpt lat="40.00000000" lon="-107.00000000"/);
});

test('portable project and duplication workflows preserve compatibility and strip secrets',()=>{
  const source=point('source','Waypoint',38,-105);
  const copy=workflows.duplicateFeature(source);
  assert.equal(copy.name,'Waypoint copy');
  assert.deepEqual(copy.geometry.coordinates,[{lat:38.002,lon:-104.998}]);
  assert.notEqual(copy,source);
  const payload=workflows.createPortableProject({
    project:{name:'Project',features:[source]},settings:{dayFilter:'1',tomtomApiKey:'secret'},
    appVersion:'0.7.1',build:'build',exportedAt:'2026-01-01T00:00:00.000Z'
  });
  assert.equal(payload.schemaVersion,1);
  assert.equal(payload.settings.tomtomApiKey,undefined);
  assert.deepEqual(workflows.readPortableProject(payload),{project:payload.project,settings:payload.settings});
  assert.throws(()=>workflows.readPortableProject({project:{}}),/not a valid CannonMap project/);
});

test('CannonMap GPX roundtrip preserves ambiguous objective type and stable ID',()=>{
  const roundtrip=createProjectWorkflows({...{
    createId:()=>`parsed-id`,now:()=>`2026-01-01T00:00:00.000Z`,parseXml:simpleGpxDocument,
    normalizeCheckpoint,rallyCheckpointNumber,filterFeatures:features=>features
  }}),features=[
    normalizeCheckpoint({...point('stable-score','R01 SCORE',38,-105),type:'checkpoint',day:1}),
    normalizeCheckpoint({...point('stable-hotel','Overnight',39,-106),type:'hotel',day:1})
  ],xml=roundtrip.buildGpx({project:{name:'Roundtrip'},features,appVersion:'0.7.18',exportedAt:'2026-08-26T00:00:00.000Z'}),parsed=roundtrip.parseGpx(xml,'roundtrip.gpx').features;
  assert.deepEqual(parsed.map(feature=>({id:feature.id,type:feature.type,name:feature.name,day:feature.day})),[
    {id:'stable-score',type:'checkpoint',name:'R01 SCORE',day:1},
    {id:'stable-hotel',type:'hotel',name:'Overnight',day:1}
  ]);
});

test('duplicating a completed checkpoint creates a clean upcoming objective without score or evidence',()=>{
  const source={...point('completed','1.1 Complete',38,-105),type:'checkpoint',day:1,status:'collected',scoreAwarded:10,completedAt:'2026-08-26T12:00:00.000Z',photoStatus:'complete',photoEvidenceState:'complete',checkpointEvidence:{completion:{state:'completed',pointsAwarded:10}},photoPair:{pairId:'pair-1'}};
  const copy=workflows.duplicateFeature(source);
  assert.equal(copy.status,'upcoming');
  assert.equal(copy.scoreAwarded,0);
  assert.equal(copy.completedAt,null);
  assert.equal(copy.photoEvidenceState,'not_attempted');
  assert.equal(copy.finalCompletionState,'pending');
  assert.equal(copy.checkpointEvidence.arrival.state,'not_confirmed');
  assert.equal(copy.checkpointEvidence.photo.state,'not_attempted');
  assert.equal(copy.checkpointEvidence.completion.state,'pending');
  assert.equal(copy.checkpointEvidence.completion.pointsAwarded,0);
  assert.equal(copy.photoPair,undefined);
  assert.equal(copy.photoStatus,'required_pending');
});
