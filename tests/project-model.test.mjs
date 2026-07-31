import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_CURRENT_PROJECT_ID,PROJECT_SCHEMA_VERSION,isProjectModel,normalizeProject,projectCollections
} from '../src/domain/projects/model.js';

test('normalizes a legacy project without mutating or discarding legacy fields',()=>{
  const legacy={
    name:'Legacy Rally',customField:'preserved',
    features:[
      {id:'r1',type:'route'},{id:'t1',type:'track'},{id:'b1',type:'backbone'},
      {id:'c1',type:'checkpoint'},{id:'h1',type:'hotel'},{id:'w1',type:'waypoint'}
    ]
  };
  const normalized=normalizeProject(legacy,{now:()=> '2026-07-30T12:00:00.000Z'});
  assert.equal(normalized.projectId,LEGACY_CURRENT_PROJECT_ID);
  assert.equal(normalized.schemaVersion,PROJECT_SCHEMA_VERSION);
  assert.equal(normalized.customField,'preserved');
  assert.equal(normalized.features.length,6);
  assert.deepEqual(legacy,{name:'Legacy Rally',customField:'preserved',features:[
    {id:'r1',type:'route'},{id:'t1',type:'track'},{id:'b1',type:'backbone'},
    {id:'c1',type:'checkpoint'},{id:'h1',type:'hotel'},{id:'w1',type:'waypoint'}
  ]});
  assert.equal(isProjectModel(normalized),true);
  const collections=projectCollections(normalized);
  assert.deepEqual(collections.routes.map(item=>item.id),['r1']);
  assert.deepEqual(collections.tracks.map(item=>item.id),['t1','b1']);
  assert.deepEqual(collections.checkpoints.map(item=>item.id),['c1','h1']);
  assert.deepEqual(collections.waypoints.map(item=>item.id),['w1']);
});

test('preserves an existing project identity and initializes owned collections',()=>{
  const normalized=normalizeProject({id:'project-250',name:'America 250'},{
    createId:()=>{throw new Error('must not replace an existing identity');},
    now:()=> '2026-07-30T12:00:00.000Z',
    settings:{weather:true}
  });
  assert.equal(normalized.id,'project-250');
  assert.equal(normalized.projectId,'project-250');
  assert.deepEqual(normalized.journal,[]);
  assert.deepEqual(normalized.analytics,{});
  assert.deepEqual(normalized.photos,[]);
  assert.deepEqual(normalized.videos,[]);
  assert.deepEqual(normalized.notes,[]);
  assert.deepEqual(normalized.offlineMapConfiguration,{});
  assert.deepEqual(normalized.settings,{weather:true});
});
