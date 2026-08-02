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
  assert.deepEqual(result,{added:1,updated:1,skipped:0,unassigned:1});
  assert.equal(project.features.length,2);
  assert.equal(project.features[0].name,'Fuel Updated');
  assert.equal(project.features[0].day,2);
  assert.equal(project.features[1].name,'Hotel');
});

test('GPX export retains checkpoint extensions and route/track geometry',()=>{
  const features=[
    normalizeCheckpoint({...point('cp','Checkpoint',38,-105),type:'checkpoint',status:'deferred',points:21,extreme:true,sequence:4,deferReason:'Hotel bailout'}),
    {id:'route',name:'Route',type:'route',notes:'',geometry:{kind:'line',coordinates:[{lat:38,lon:-105},{lat:39,lon:-106}]}},
    {id:'track',name:'Track',type:'track',notes:'',geometry:{kind:'line',coordinates:[{lat:40,lon:-107},{lat:41,lon:-108}]}}
  ];
  const xml=workflows.buildGpx({project:{name:'Golden'},features,appVersion:'0.7.1',exportedAt:'2026-01-01T00:00:00.000Z'});
  assert.match(xml,/<cannonmap:status>deferred<\/cannonmap:status>/);
  assert.match(xml,/<cannonmap:points>21<\/cannonmap:points>/);
  assert.match(xml,/<rtept lat="38.00000000" lon="-105.00000000"/);
  assert.match(xml,/<trkpt lat="40.00000000" lon="-107.00000000"/);
  assert.doesNotMatch(xml,/xmlns:gpxx|WaypointExtension/);
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
