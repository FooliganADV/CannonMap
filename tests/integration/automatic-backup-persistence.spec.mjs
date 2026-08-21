import {expect,test} from '@playwright/test';

test('compact recovery snapshots and external directory grant metadata survive database restart',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');
  await page.goto('/');
  const result=await page.evaluate(async databaseName=>{
    const indexed=await import('/src/infrastructure/indexeddb/index.js');
    const open=()=>indexed.openIndexedDbV2({indexedDB,featureFlags:{isEnabled:()=>true},databaseName});
    let database=await open(),snapshots=indexed.createRecoverySnapshotRepository({database}),directories=indexed.createBackupDirectoryHandleRepository({database});
    const base={projectId:'project-1',dayNumber:1,sessionId:'session-1',trigger:'session_start',verified:true,
      filename:'CannonMap_Rally_D01_Run01_2026-08-20_120000-000_Backup.cmapday.zip',packageSize:100,
      manifest:{sessionId:'session-1',dayNumber:1,journalEventCount:1,mediaCount:1},
      recovery:{projectMetadata:{projectId:'project-1'},journal:[{eventId:'event-1'}],mediaReferences:[{mediaId:'media-1',checksum:{algorithm:'SHA-256',value:'abc'}}]}};
    await snapshots.save({...base,snapshotId:'snapshot-1',fingerprint:'fingerprint-1',createdAt:'2026-08-20T12:00:00.000Z'});
    await snapshots.save({...base,snapshotId:'snapshot-2',fingerprint:'fingerprint-2',trigger:'checkpoint_completed',createdAt:'2026-08-20T13:00:00.000Z'});
    await snapshots.prune('session-1',1);
    await directories.save({key:'cannonmap-external-backup-directory',handle:{kind:'directory',name:'CannonMap Backups'},permission:'granted',updatedAt:'2026-08-20T12:00:00.000Z'});
    database.close();database=await open();snapshots=indexed.createRecoverySnapshotRepository({database});directories=indexed.createBackupDirectoryHandleRepository({database});
    const rows=await snapshots.listSession('session-1'),match=await snapshots.findByFingerprint('session-1','fingerprint-2'),directory=await directories.get('cannonmap-external-backup-directory'),version=database.version,stores=[...database.objectStoreNames];database.close();
    return {rows,match,directory,version,stores};
  },`automatic-backup-${Date.now()}`);
  expect(result.version).toBe(12);
  expect(result.stores).toEqual(expect.arrayContaining(['recoverySnapshots','backupDirectoryHandles']));
  expect(result.rows).toHaveLength(1);expect(result.rows[0].snapshotId).toBe('snapshot-2');expect(result.rows[0].blob).toBeUndefined();
  expect(result.match.snapshotId).toBe('snapshot-2');
  expect(result.directory).toMatchObject({permission:'granted',handle:{kind:'directory',name:'CannonMap Backups'}});
});

test('Samsung external backup adapter reuses a granted handle and verifies reopened final bytes',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android portrait');await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {createFileSystemBackupAdapter}=await import('/src/infrastructure/browser/file-system-backup-adapter.js'),files=new Map(),writes=[];let stored=null,pickerCalls=0;
    const directory={name:'CannonMap Backups',async queryPermission(){return 'granted';},async getFileHandle(name,{create=false}={}){if(!files.has(name)&&!create)throw new DOMException('Missing','NotFoundError');if(!files.has(name))files.set(name,new Blob([]));return {name,async createWritable(){return {async write(blob){writes.push(name);files.set(name,blob);},async close(){},async abort(){}};},async getFile(){return files.get(name);}};},async removeEntry(name){files.delete(name);}};
    const repository={async get(){return stored;},async save(value){stored=value;return value;},async clear(){stored=null;}};
    const first=createFileSystemBackupAdapter({handleRepository:repository,showDirectoryPicker:async()=>{pickerCalls++;return directory;},createId:()=> 'first'});await first.chooseDirectoryFromUserGesture();
    const reopened=createFileSystemBackupAdapter({handleRepository:repository,showDirectoryPicker:async()=>{pickerCalls++;throw new Error('picker should not reopen');},createId:()=> 'second'}),state=await reopened.inspect(),blob=new Blob(['complete-backup-bytes']),written=await reopened.writeVerified({filename:'CannonMap_Rally_D01_Run01_2026-08-20_120000-000_Backup.cmapday.zip',blob,verify:async file=>{if(await file.text()!=='complete-backup-bytes')throw new Error('verification mismatch');}});
    return {state,written,pickerCalls,writes,finalText:await files.get(written.filename).text(),partials:[...files.keys()].filter(name=>name.endsWith('.partial'))};
  });
  expect(result.state).toMatchObject({status:'ready',configured:true,permission:'granted'});expect(result.written).toMatchObject({status:'ready',verified:true,finalizedBy:'copy'});expect(result.pickerCalls).toBe(1);expect(result.finalText).toBe('complete-backup-bytes');expect(result.partials).toEqual([]);expect(result.writes).toHaveLength(2);
});
