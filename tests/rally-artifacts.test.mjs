import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSessionArtifactFilename,createSessionManifestIdentity,filesystemSafeRallySlug
} from '../src/domain/rally/artifacts.js';

const localDate=(year,month,day,hour,minute,second,millisecond)=>new Date(year,month-1,day,hour,minute,second,millisecond);

test('filesystem-safe filenames carry rally, day, run, local export time, and artifact type',()=>{
  const filename=createSessionArtifactFilename({
    rallyName:'América 250 / Test',dayNumber:1,runNumber:3,
    exportedAt:localDate(2026,8,18,17,37,42,123),artifactType:'Backup',extension:'cmapday.zip'
  });
  assert.equal(filesystemSafeRallySlug('América 250 / Test'),'America250Test');
  assert.equal(filename,'CannonMap_America250Test_D01_Run03_2026-08-18_173742-123_Backup.cmapday.zip');
  assert.doesNotMatch(filename,/[<>:"/\\|?*]/);
});

test('repeated exports remain distinguishable at millisecond precision',()=>{
  const shared={rallyName:'America 250',dayNumber:1,runNumber:3,artifactType:'Journal',extension:'json'};
  const first=createSessionArtifactFilename({...shared,exportedAt:localDate(2026,8,18,17,37,42,123)});
  const second=createSessionArtifactFilename({...shared,exportedAt:localDate(2026,8,18,17,37,42,124)});
  assert.notEqual(first,second);
  assert.match(first,/D01_Run03_2026-08-18_173742-123_Journal\.json$/);
});

test('manifest identity retains the immutable session ID and build/cache provenance',()=>{
  const identity=createSessionManifestIdentity({
    session:{projectId:'execution-project',rallyId:'america-250',dayId:'america-250-day-1',dayNumber:1,calendarDate:'2026-08-18',sessionId:'session-immutable',runNumber:3,startedAt:'2026-08-18T13:00:00.000Z'},
    tripId:'month-trip',exportedAt:'2026-08-18T22:37:42.123Z',applicationVersion:'0.7.11',buildId:'2026.08.18.session-recovery-1',serviceWorkerCacheId:'cannonmap-v77'
  });
  assert.deepEqual(identity,{
    projectId:'execution-project',tripId:'month-trip',rallyId:'america-250',dayId:'america-250-day-1',dayNumber:1,
    calendarDate:'2026-08-18',sessionId:'session-immutable',sessionRunNumber:3,sessionStartedAt:'2026-08-18T13:00:00.000Z',
    exportedAt:'2026-08-18T22:37:42.123Z',applicationVersion:'0.7.11',buildId:'2026.08.18.session-recovery-1',serviceWorkerCacheId:'cannonmap-v77'
  });
  assert.equal(Object.isFrozen(identity),true);
});

test('invalid identity and unsafe extension inputs fail closed',()=>{
  assert.throws(()=>createSessionArtifactFilename({rallyName:'Trip',dayNumber:0,runNumber:1,artifactType:'Backup',extension:'zip'}),/positive integer/);
  assert.throws(()=>createSessionArtifactFilename({rallyName:'Trip',dayNumber:1,runNumber:1,artifactType:'Backup',extension:'zip/evil'}),/filesystem-safe/);
  assert.throws(()=>createSessionManifestIdentity({session:{}}),/sessionStartedAt/);
});
