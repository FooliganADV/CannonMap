import {expect,test} from '@playwright/test';

const payload={
  format:'CannonMap Project',
  project:{
    projectId:'session-recovery-browser',name:'Session Recovery Browser',competitors:[],
    features:[
      {id:'cp-1.1',name:'1.1 I-12',type:'checkpoint',day:1,sequence:1,status:'upcoming',photoRequirement:'required',visible:true,geometry:{kind:'point',coordinates:[{lat:30,lon:-90}]}},
      {id:'cp-1.2',name:'1.2 HWY 190',type:'checkpoint',day:1,sequence:2,status:'upcoming',photoRequirement:'required',visible:true,geometry:{kind:'point',coordinates:[{lat:30.0002,lon:-90}]}}
    ]
  }
};

async function openFreshRun(page){
  const startupErrors=[];
  const cdp=await page.context().newCDPSession(page);await cdp.send('Runtime.enable');
  cdp.on('Runtime.exceptionThrown',event=>startupErrors.push(`runtime: ${JSON.stringify(event.exceptionDetails)}`));
  page.on('pageerror',error=>startupErrors.push(`pageerror: ${error.stack||error.message}`));
  page.on('console',message=>{if(message.type()==='error')startupErrors.push(`console: ${message.text()}`);});
  await page.goto('/?e2e=session-recovery');
  await page.waitForTimeout(1000);
  const early=await page.evaluate(()=>({ready:document.documentElement.dataset.cannonmapReady||null,state:document.documentElement.dataset.cannonmapStartupState||null}));
  if(early.ready!=='true'&&startupErrors.length)throw new Error(`CannonMap startup failed: ${JSON.stringify({early,startupErrors})}`);
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true'||document.documentElement.dataset.cannonmapStartupState==='failed',null,{timeout:10_000});
  const startup=await page.evaluate(()=>({ready:document.documentElement.dataset.cannonmapReady||null,state:document.documentElement.dataset.cannonmapStartupState||null,message:document.getElementById('startupMessage')?.textContent||null}));
  expect({startup,startupErrors},`CannonMap startup failed: ${JSON.stringify({startup,startupErrors})}`).toMatchObject({startup:{ready:'true'}});
  await page.locator('#projectInput').setInputFiles({name:'session-recovery.cmap',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});
  await expect(page.locator('#status')).toContainText('Opened session-recovery.cmap');
  await page.evaluate(()=>{const day=document.getElementById('dayFilter');day.value='1';day.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.evaluate(()=>window.CannonMapTest.startNewRallySessionForTest(1));
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.rallySessionStateForTest().current?.sessionId||null)).toBeTruthy();
  await page.evaluate(async()=>{
    await window.CannonMapTest.refreshDayPreflightForTest();
    await window.CannonMapTest.proceedFromDayPreflightForTest({degraded:true});
  });
}

async function installCaptureFailure(page){
  await page.evaluate(()=>window.CannonMapTest.setAutomaticCameraCaptureForTest(()=>{throw new Error('field camera unavailable');}));
}

async function observe(page,checkpointId,observedAt,{priorTargetId='cp-1.1',speedMph=5}={}){
  const latitude=checkpointId==='cp-1.1'?30:30.0002,detections=[{checkpointId,distanceFeet:3,accuracyFeet:7,radiusFeet:100}],gpsEvidence={latitude,longitude:-90,accuracyFeet:7,sampleTimestamp:new Date(observedAt).toISOString()};
  await page.evaluate(input=>window.CannonMapTest.observeCheckpointDetectionsForTest(input),{observedAt,speedMph,priorTargetId,gpsEvidence,detections});
  await page.evaluate(input=>window.CannonMapTest.observeCheckpointDetectionsForTest(input),{observedAt:observedAt+3000,speedMph,priorTargetId,gpsEvidence:{...gpsEvidence,sampleTimestamp:new Date(observedAt+3000).toISOString()},detections});
}

test('same-Day Start New/Resume preserves two pending arrivals without letting CP 1.1 block CP 1.2',async({page},testInfo)=>{
  test.skip(!['Android portrait','iPhone 13 portrait'].includes(testInfo.project.name),'Focused phone profiles exercise the assembled state lifecycle.');
  await openFreshRun(page);
  const first=await page.evaluate(()=>window.CannonMapTest.rallySessionStateForTest().current);
  expect(first).toMatchObject({dayNumber:1,runNumber:1,status:'active'});
  await installCaptureFailure(page);

  const start=Date.parse('2026-08-18T14:00:00.000Z');
  await observe(page,'cp-1.1',start);
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.fieldMediaState().mode)).toBe('manual-fallback');
  await page.evaluate(()=>window.CannonMapTest.expireManualFallbackForTest());
  await page.evaluate(()=>window.CannonMapTest.awaitFieldMediaIdle());
  const released=await page.evaluate(()=>window.CannonMapTest.rallySessionStateForTest().pendingEvidence.entries.find(item=>item.checkpointId==='cp-1.1'));
  expect(released).toMatchObject({checkpointId:'cp-1.1',lastAction:'CONTINUE'});
  expect(released.actions).toHaveLength(1);
  await observe(page,'cp-1.2',start+120_000);
  await page.evaluate(()=>window.CannonMapTest.awaitFieldMediaIdle());

  const unresolved=await page.evaluate(async()=>({
    session:window.CannonMapTest.rallySessionStateForTest(),
    cp11:window.CannonMapTest.checkpointEvidenceStateForTest('cp-1.1'),
    cp12:window.CannonMapTest.checkpointEvidenceStateForTest('cp-1.2'),
    score:window.CannonMapTest.rallyScore(),
    events:await window.CannonMapTest.missionControlJournalEvents()
  }));
  expect(unresolved.cp11).toMatchObject({arrival:{state:'confirmed',trustworthy:true},completion:{state:'pending'}});
  expect(unresolved.cp12).toMatchObject({arrival:{state:'confirmed',trustworthy:true},completion:{state:'pending'}});
  expect(unresolved.session.activePendingEvidence.map(item=>item.checkpointId)).toEqual(['cp-1.1','cp-1.2']);
  expect(unresolved.score).toBe(0);
  const arrivals=unresolved.events.filter(event=>event.eventType==='checkpoint_arrival');
  expect(arrivals.map(event=>event.references.checkpointId)).toEqual(['cp-1.1','cp-1.2']);
  expect(arrivals.every(event=>event.metadata.sessionId===first.sessionId&&event.references.sessionId===first.sessionId)).toBeTruthy();
  expect(unresolved.events.filter(event=>event.eventType==='checkpoint_completed')).toHaveLength(0);

  await page.evaluate(()=>window.CannonMapTest.pendingEvidenceActionForTest('cp-1.2','continue'));
  const actionState=await page.evaluate(()=>window.CannonMapTest.rallySessionStateForTest().pendingEvidence.entries.map(item=>({checkpointId:item.checkpointId,lastAction:item.lastAction,actions:item.actions.length})));
  expect(actionState).toEqual([
    {checkpointId:'cp-1.1',lastAction:'CONTINUE',actions:1},
    {checkpointId:'cp-1.2',lastAction:'CONTINUE',actions:1}
  ]);

  await page.reload();
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await expect(page.locator('#rallySessionChoice')).toBeVisible();
  await expect(page.locator('#rallyResumeSessionButton')).toBeVisible();
  await expect(page.locator('#rallyStartNewSessionButton')).toBeVisible();
  await page.locator('#rallyResumeSessionButton').click();
  await expect(page.locator('#rallySessionChoice')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>window.CannonMapTest.rallySessionStateForTest().acceptedRallySessionId)).toBe(first.sessionId);
  const restored=await page.evaluate(async()=>({session:window.CannonMapTest.rallySessionStateForTest(),events:await window.CannonMapTest.missionControlJournalEvents()}));
  expect(restored.session.pendingEvidence.entries.map(item=>[item.checkpointId,item.lastAction,item.actions.length])).toEqual([
    ['cp-1.1','CONTINUE',1],['cp-1.2','CONTINUE',1]
  ]);
  expect(restored.events.filter(event=>event.eventType==='checkpoint_arrival')).toHaveLength(2);

  const second=await page.evaluate(()=>window.CannonMapTest.startNewRallySessionForTest(1));
  expect(second).toMatchObject({dayNumber:1,runNumber:2,status:'active'});
  expect(second.sessionId).not.toBe(first.sessionId);
  const clean=await page.evaluate(()=>({session:window.CannonMapTest.rallySessionStateForTest(),cp11:window.CannonMapTest.checkpointEvidenceStateForTest('cp-1.1'),cp12:window.CannonMapTest.checkpointEvidenceStateForTest('cp-1.2')}));
  expect(clean.session.activePendingEvidence).toHaveLength(0);
  expect(clean.cp11.arrival.state).not.toBe('confirmed');
  expect(clean.cp12.arrival.state).not.toBe('confirmed');

  await page.evaluate(sessionId=>window.CannonMapTest.resumeRallySessionForTest(sessionId),first.sessionId);
  const resumed=await page.evaluate(()=>window.CannonMapTest.rallySessionStateForTest());
  expect(resumed.current.sessionId).toBe(first.sessionId);
  expect(resumed.pendingEvidence.entries.map(item=>[item.checkpointId,item.lastAction])).toEqual([
    ['cp-1.1','CONTINUE'],['cp-1.2','CONTINUE']
  ]);
});
