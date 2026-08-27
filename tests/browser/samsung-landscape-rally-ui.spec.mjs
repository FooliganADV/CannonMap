import {expect,test} from '@playwright/test';
import path from 'node:path';

const fixture=path.resolve('tests/fixtures/rally-project.cmap');
const SAMSUNG_VIEWPORT={width:915,height:412};
const NAV_IDS=['rallyMissionButton','rallyTrailIntelButton','rallyJournalButton','rallyMoreButton'];

async function continueSelectedRallyDay(page){
  const choice=page.locator('#rallySessionChoice'),preflight=page.locator('#rallyDayPreflight');
  await expect.poll(async()=>await choice.isVisible()||await preflight.isVisible()||await page.locator('#rallyDayComplete').isVisible()).toBeTruthy();
  if(await choice.isVisible()){
    await page.locator('#rallyResumeSessionButton').click();
    await expect(choice).toBeHidden();
  }
  if(!await preflight.isVisible())return;
  await expect(page.locator('#rallyDayPreflightOverall')).not.toHaveText('CHECKING');
  const start=page.locator('#rallyDayPreflightStart');
  if(await start.isEnabled())await start.click();
  else await page.locator('#rallyDayPreflightDegraded').click();
  await expect(preflight).toBeHidden();
}

async function loadActiveProject(page){
  await page.goto('/?e2e=samsung-landscape-rally-ui');
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await page.locator('#projectInput').setInputFiles(fixture);
  await expect(page.locator('#status')).toContainText('Opened rally-project.cmap');
  await page.evaluate(()=>{
    const day=document.getElementById('dayFilter');
    day.value='1';
    day.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await expect(page.locator('#rallyDay')).toHaveText('Day 1');
  await continueSelectedRallyDay(page);
}

async function renderState(page,overrides={}){
  await page.evaluate(async overrides=>{
    const {renderRally}=await import('/src/ui/rally/presenter.js');
    const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,character=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[character]);
    const next={
      id:'cp-landscape',name:'1.1 Gravel Control',type:'checkpoint',points:10,status:'active',
      notes:'Test',photoRequired:true,photoEvidenceState:'missing',photoRecoveryAction:'CAPTURE PHOTO'
    };
    const model={
      projectName:'America 250',day:1,executableDay:true,online:true,
      gpsStatus:'GPS active',gpsAccuracy:'GPS ±18 ft',elevation:'Elev 24 ft',gpsActive:true,followMode:'following',
      score:20,next,distance:1,navigationGuidance:'Continue 1.0 mi',emptyLabel:'No current checkpoint',
      hotelLabel:'Hotel 48 mi',feedAge:'Feed current',deferredCount:0,showDeferredPrompt:false,hasHotel:true,
      hotelBailoutActive:false,autoComplete:true,arrivalRadius:500,maxAccuracy:200,checkpoints:[next],hasPlanned:true,
      warnings:[],objectiveIntel:'',dayComplete:false,nextDay:2,daySummary:null,backupStatus:'Not backed up',reviewMode:false,
      cameraReadiness:{permission:'granted',capability:'ready'},photoCaptureActive:false,sessionChoice:{show:false},
      pendingEvidence:[],showCameraSetup:false,showDayPreflight:false,dayPreflight:{}
    };
    const suppliedNext=Object.prototype.hasOwnProperty.call(overrides,'next')
      ?(overrides.next===null?null:{...next,...overrides.next})
      :next;
    renderRally({getElement:id=>document.getElementById(id),escapeHtml,model:{...model,...overrides,next:suppliedNext}});
  },overrides);
}

const rectsOverlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;

async function visibleRect(page,selector){
  return page.locator(selector).evaluate(element=>{
    const rect=element.getBoundingClientRect();
    return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height};
  });
}

async function expectViewportSafe(page,selectors){
  const viewport=page.viewportSize();
  for(const selector of selectors){
    const rect=await visibleRect(page,selector);
    expect(rect.left,`${selector} left`).toBeGreaterThanOrEqual(0);
    expect(rect.top,`${selector} top`).toBeGreaterThanOrEqual(0);
    expect(rect.right,`${selector} right`).toBeLessThanOrEqual(viewport.width);
    expect(rect.bottom,`${selector} bottom`).toBeLessThanOrEqual(viewport.height);
  }
}

test.beforeEach(async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='Android landscape');
  expect(page.viewportSize()).toEqual(SAMSUNG_VIEWPORT);
});

test('915x412 Rally layout uses a shallow top bar, perimeter stacks, and exposed map center',async({page},testInfo)=>{
  await loadActiveProject(page);
  await renderState(page);

  const topBar=await visibleRect(page,'.rally-top-bar');
  expect(topBar.height,'compact Rally bar height').toBeLessThanOrEqual(105);
  expect(topBar.height,'compact Rally bar remains glance-readable').toBeGreaterThanOrEqual(85);
  expect(topBar.width,'compact Rally bar spans the mounted viewport').toBeGreaterThan(880);

  const nav=Object.fromEntries(await Promise.all(NAV_IDS.map(async id=>[id,await visibleRect(page,`#${id}`)])));
  for(const [id,rect] of Object.entries(nav)){
    expect(rect.width,`${id} width`).toBeGreaterThanOrEqual(68);
    expect(rect.width,`${id} width`).toBeLessThanOrEqual(76);
    expect(rect.height,`${id} height`).toBeGreaterThanOrEqual(64);
    expect(rect.height,`${id} height`).toBeLessThanOrEqual(72);
  }
  expect(nav.rallyMissionButton.left).toBe(nav.rallyTrailIntelButton.left);
  expect(nav.rallyJournalButton.left).toBe(nav.rallyMoreButton.left);
  expect(nav.rallyMissionButton.left).toBeLessThanOrEqual(12);
  expect(nav.rallyJournalButton.right).toBeGreaterThanOrEqual(SAMSUNG_VIEWPORT.width-12);
  expect(nav.rallyTrailIntelButton.top).toBeGreaterThan(nav.rallyMissionButton.bottom);
  expect(nav.rallyMoreButton.top).toBeGreaterThan(nav.rallyJournalButton.bottom);

  const gps=await visibleRect(page,'#rallyRecenterFab');
  expect(gps.width).toBeGreaterThanOrEqual(48);
  expect(gps.width).toBeLessThanOrEqual(56);
  expect(gps.height).toBeGreaterThanOrEqual(48);
  expect(gps.height).toBeLessThanOrEqual(56);
  for(const rect of Object.values(nav))expect(rectsOverlap(rect,gps),'GPS edge control overlaps navigation').toBeFalsy();

  const barSections=await Promise.all(['.rally-head-day','#rallyPrimaryCard','.rally-score-slot'].map(selector=>visibleRect(page,selector)));
  expect(rectsOverlap(barSections[0],barSections[1]),'project/GPS section overlaps objective').toBeFalsy();
  expect(rectsOverlap(barSections[1],barSections[2]),'objective overlaps score').toBeFalsy();

  const actionOwner=await page.locator('.rally-actions').evaluate(element=>({display:getComputedStyle(element).display,rects:element.getClientRects().length}));
  expect(actionOwner).toEqual({display:'contents',rects:0});
  expect(await page.locator('.rally-actions button').count()).toBe(4);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();

  const mapSamples=await page.evaluate(()=>[
    [innerWidth/2,150],[innerWidth/2,230],[innerWidth/2,330],[innerWidth*.32,280],[innerWidth*.68,280]
  ].map(([x,y])=>document.getElementById('map').contains(document.elementFromPoint(x,y))));
  expect(mapSamples,'center and lower map remain directly exposed').toEqual([true,true,true,true,true]);

  const visibleControls=[topBar,...Object.values(nav),gps];
  const occupiedArea=visibleControls.reduce((sum,rect)=>sum+rect.width*rect.height,0);
  expect(occupiedArea/(SAMSUNG_VIEWPORT.width*SAMSUNG_VIEWPORT.height),'perimeter UI coverage').toBeLessThan(.35);
  await expectViewportSafe(page,['.rally-top-bar',...NAV_IDS.map(id=>`#${id}`),'#rallyRecenterFab']);
  await page.screenshot({path:testInfo.outputPath('samsung-landscape-normal.png')});
});

test('status variants remain compact and truthful without changing the Rally workflow',async({page},testInfo)=>{
  await page.goto('/?e2e=samsung-landscape-rally-states');
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');

  await renderState(page,{online:false});
  await expect(page.locator('#rallyOnlineStatus')).toHaveText('Offline');
  await expect(page.locator('.rally-top-bar')).toHaveCSS('height','98px');
  await page.screenshot({path:testInfo.outputPath('samsung-landscape-offline.png')});

  await renderState(page,{gpsStatus:'GPS lost',gpsAccuracy:'GPS LOST',gpsActive:false,warnings:[{id:'gps',message:'GPS REQUIRED · live location unavailable'}]});
  await expect(page.locator('#rallyGpsAccuracy')).toHaveText('GPS LOST');
  await expect(page.locator('#rallyWarningsSection')).toContainText('GPS REQUIRED');
  await expect(page.locator('#rallyRecenterFab')).toHaveText(/GPS|START/);
  expect((await visibleRect(page,'#rallyRecenterFab')).width).toBeLessThanOrEqual(56);
  await page.screenshot({path:testInfo.outputPath('samsung-landscape-gps-degraded.png')});

  await renderState(page,{photoCaptureActive:true});
  await expect(page.locator('#rallyCompleteButton')).toHaveText('CAPTURING…');
  await expect(page.locator('#rallyCompleteButton')).toHaveAttribute('data-photo-state','capturing');
  await expect(page.locator('#rallyCompleteButton')).toHaveAttribute('aria-busy','true');
  await page.screenshot({path:testInfo.outputPath('samsung-landscape-photo-capturing.png')});

  await renderState(page,{next:{arrivalState:'confirmed',arrivalTrustworthy:true,photoRequired:true,photoEvidenceState:'interrupted',photoRecoveryAction:'RESUME PAIR'}});
  await expect(page.locator('#rallyObjectiveStatus')).toHaveText('ARRIVAL CONFIRMED · PHOTO MISSING');
  await expect(page.locator('#rallyCompleteButton')).toHaveText('RESUME PAIR');
  await expect(page.locator('#rallyCompleteButton')).toHaveAttribute('data-photo-state','pending');
  await page.screenshot({path:testInfo.outputPath('samsung-landscape-photo-pending.png')});

  await renderState(page,{next:{status:'completed',photoEvidenceState:'complete',photoRecoveryAction:null}});
  await expect(page.locator('#rallyObjectiveStatus')).toContainText('completed');
  await expect(page.locator('#rallyCompleteButton')).toHaveAttribute('data-photo-state','complete');
  await page.screenshot({path:testInfo.outputPath('samsung-landscape-checkpoint-complete.png')});

  await expectViewportSafe(page,['.rally-top-bar','#rallyCompleteButton','#rallyDeferIcon']);
  expect((await visibleRect(page,'.rally-top-bar')).height).toBeLessThanOrEqual(105);
});

test('long project, Day 8, checkpoint, note, and three-digit score truncate safely with full labels retained',async({page},testInfo)=>{
  await page.goto('/?e2e=samsung-landscape-long-content');
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  const projectName='America 250 Transcontinental September Rally Field Validation Project';
  const checkpointName='1.10 Extremely Long Checkpoint Name at the Historic Mountain Overlook Entrance';
  const note='Use the second gravel entrance after the fuel station and remain alert for a narrow cattle guard.';
  const guidance='Continue west for 123.4 miles, then bear left onto the unsigned gravel service road';
  await renderState(page,{projectName,day:8,score:987,navigationGuidance:guidance,distance:123.4,next:{name:checkpointName,notes:note}});

  await expect(page.locator('#rallyDay')).toHaveText('Day 8');
  await expect(page.locator('#rallyScore')).toHaveText('987');
  await expect(page.locator('#rallyActiveProjectName')).toHaveAttribute('title',projectName);
  await expect(page.locator('#rallyNextName')).toHaveAttribute('title',checkpointName);
  await expect(page.locator('#rallyNavigationGuidance')).toHaveAttribute('title',guidance);
  await expect(page.locator('#rallyRiderNotes')).toHaveAttribute('title',note);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  for(const selector of ['#rallyActiveProjectName','#rallyNextName','#rallyNavigationGuidance','#rallyRiderNotes']){
    const metrics=await page.locator(selector).evaluate(element=>({clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,overflow:getComputedStyle(element).overflow,textOverflow:getComputedStyle(element).textOverflow}));
    expect(metrics.clientWidth,`${selector} has usable width`).toBeGreaterThan(0);
    expect(['hidden','clip']).toContain(metrics.overflow);
    expect(metrics.scrollWidth,`${selector} long text exercises truncation`).toBeGreaterThanOrEqual(metrics.clientWidth);
  }
  await expectViewportSafe(page,['.rally-top-bar','.rally-head-day','#rallyPrimaryCard','.rally-score-slot']);
  expect((await visibleRect(page,'.rally-top-bar')).height).toBeLessThanOrEqual(105);
  await page.screenshot({path:testInfo.outputPath('samsung-landscape-long-content.png')});
});

test('no-current and day-complete presentations stay viewport-safe without restoring the old checkpoint card',async({page},testInfo)=>{
  await page.goto('/?e2e=samsung-landscape-empty-complete');
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');

  await renderState(page,{next:null,hasPlanned:false,navigationGuidance:'Select a numbered Rally Day',emptyLabel:'No current checkpoint'});
  await expect(page.locator('#rallyNextName')).toHaveText('No current checkpoint');
  await expect(page.locator('#rallyCompleteButton')).toBeHidden();
  await expect(page.locator('#rallyNextButton')).toBeHidden();
  expect((await visibleRect(page,'.rally-top-bar')).height).toBeLessThanOrEqual(105);
  await page.screenshot({path:testInfo.outputPath('samsung-landscape-no-current.png')});

  await renderState(page,{next:null,hasPlanned:false,dayComplete:true,nextDay:2,score:120,daySummary:{totalCollected:12,totalDeferred:1,score:120},backupStatus:'Verified'});
  await expect(page.locator('#rallyPrimaryCard')).toBeHidden();
  await expect(page.locator('#rallyDayComplete')).toBeVisible();
  await expect(page.locator('#rallyDayCompleteTitle')).toHaveText('✓ Day Complete');
  await expectViewportSafe(page,['.rally-top-bar','#rallyDayComplete']);
  await page.screenshot({path:testInfo.outputPath('samsung-landscape-day-complete.png')});
});

test('Mission, Trail Intel, Journal, and More open and close from stable edge controls',async({page},testInfo)=>{
  await loadActiveProject(page);
  await expect(page.locator('#rallyMissionButton')).toHaveClass(/active/);

  const cases=[
    {button:'#rallyTrailIntelButton',panel:'#intelSheet',close:'#intelCloseButton',active:'#rallyTrailIntelButton',shot:'trail-intel'},
    {button:'#rallyJournalButton',panel:'#rallyJournalSheet',close:'#rallyJournalClose',active:'#rallyJournalButton',shot:'journal'},
    {button:'#rallyMoreButton',panel:'#rallyMoreSheet',close:'#rallyMissionButton',active:'#rallyMoreButton',shot:'more'}
  ];
  for(const item of cases){
    await page.locator(item.button).click();
    await expect(page.locator(item.panel)).toBeVisible();
    await expect(page.locator(item.active)).toHaveClass(/active/);
    const panel=await visibleRect(page,item.panel);
    expect(panel.left).toBeGreaterThanOrEqual(84);
    expect(panel.right).toBeLessThanOrEqual(SAMSUNG_VIEWPORT.width-84);
    expect(panel.top).toBeGreaterThanOrEqual(108);
    expect(panel.bottom).toBeLessThanOrEqual(SAMSUNG_VIEWPORT.height);
    await page.screenshot({path:testInfo.outputPath(`samsung-landscape-panel-${item.shot}.png`)});
    await page.locator(item.close).click();
    await expect(page.locator(item.panel)).toBeHidden();
    await expect(page.locator('#rallyMissionButton')).toHaveClass(/active/);
  }

  const exposed=await page.evaluate(()=>document.getElementById('map').contains(document.elementFromPoint(innerWidth/2,innerHeight*.64)));
  expect(exposed,'closing a panel restores the central map').toBeTruthy();
});
