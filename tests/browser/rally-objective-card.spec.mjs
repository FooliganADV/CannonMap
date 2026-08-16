import {test,expect} from '@playwright/test';

const photoBuffer=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const payload={format:'CannonMap Project',project:{projectId:'objective-card-test',name:'Objective Card Test',features:[
  {id:'arch',name:'3.1 THE ARCH',type:'checkpoint',day:3,sequence:1,status:'planned',points:10,notes:'Use the east approach after the cattle guard.',visible:true,geometry:{kind:'point',coordinates:[{lat:40.1,lon:-105}]}},
  {id:'ridge',name:'3.2 RIDGELINE',type:'checkpoint',day:3,sequence:2,status:'planned',points:21,extreme:true,notes:'Watch the loose descent.',visible:true,geometry:{kind:'point',coordinates:[{lat:40.2,lon:-105.1}]}},
  {id:'backbone',name:'Day 3 Backbone',type:'backbone',day:3,visible:true,geometry:{kind:'line',coordinates:[{lat:40,lon:-105},{lat:40.2,lon:-105.1}]}},
  {id:'hotel',name:'Day 3 Hotel',type:'hotel',day:3,sequence:99,status:'planned',visible:true,geometry:{kind:'point',coordinates:[{lat:40.3,lon:-105.2}]}}
],competitors:[]}};

async function loadObjective(page){
  await page.addInitScript(()=>{
    let success;
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition(callback){success=callback;return 17;},clearWatch(){}}});
    globalThis.emitObjectiveGps=(lat,lon)=>success?.({coords:{latitude:lat,longitude:lon,accuracy:8,altitude:1200,heading:30},timestamp:Date.now()});
  });
  await page.goto('/?e2e=compact-objective-card');
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await page.locator('#projectInput').setInputFiles({name:'objective-card.cmap',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});
  await expect(page.locator('#status')).toContainText('Opened objective-card.cmap');
  await page.evaluate(()=>{const day=document.getElementById('dayFilter');day.value='3';day.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.locator('#rallyRecenterFab').click();
  await page.evaluate(()=>emitObjectiveGps(40,-105));
  await expect(page.locator('#rallyNextName')).toHaveText('3.1 THE ARCH');
}

const overlaps=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;

test('compact Mission header is map-first and exposes secondary details only on demand',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop');
  await loadObjective(page);

  const card=page.locator('#rallyPrimaryCard');
  await expect(card).toBeVisible();
  await expect(card.locator('#rallyNextName')).toHaveText('3.1 THE ARCH');
  const compactText=await card.innerText();
  expect((compactText.match(/\d+(?:\.\d)? mi/g)||[])).toHaveLength(1);
  expect(compactText).not.toMatch(/\bCHECKPOINT\b|\bACTIVE\b|10 points|Backbone Route Active|Rider Notes|sequence|Day 3|type/i);
  await expect(card.locator('#rallyObjectiveDetails')).toBeHidden();
  await expect(card.locator('#rallyObjectiveDetailsToggle')).toHaveAttribute('aria-expanded','false');

  await card.locator('#rallyObjectiveDetailsToggle').click();
  await expect(card.locator('#rallyObjectiveDetails')).toBeVisible();
  await expect(card.locator('#rallyRiderNotesSection')).toContainText('Use the east approach after the cattle guard.');
  await expect(card.locator('#rallyObjectiveDetailsToggle')).toHaveAttribute('aria-expanded','true');
  await card.locator('#rallyObjectiveDetailsClose').click();
  await expect(card.locator('#rallyObjectiveDetails')).toBeHidden();
  await expect(card.locator('#rallyObjectiveDetailsToggle')).toHaveAttribute('aria-expanded','false');
});

test('objective NAV and COMPLETE retain their operational behavior and score exactly once',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop');
  await loadObjective(page);
  await page.evaluate(()=>{globalThis.objectiveNavigation=[];window.open=(...args)=>{objectiveNavigation.push(args);return null;};});

  const nav=page.locator('#rallyNavigateButton'),complete=page.locator('#rallyCompleteButton');
  const navBox=await nav.boundingBox(),completeBox=await complete.boundingBox();
  for(const [label,box] of [['NAV',navBox],['COMPLETE',completeBox]]){expect(box,label).not.toBeNull();expect(box.width,`${label} width`).toBeGreaterThanOrEqual(48);expect(box.height,`${label} height`).toBeGreaterThanOrEqual(48);}
  expect(overlaps(navBox,completeBox),'NAV and COMPLETE must remain distinct touch targets').toBeFalsy();
  await nav.click();
  const navigation=await page.evaluate(()=>globalThis.objectiveNavigation);
  expect(navigation).toHaveLength(1);
  expect(navigation[0][0]).toContain('destination=40.1,-105');

  await complete.click();
  await expect(page.locator('#rallyCameraWorkflow')).toBeVisible();
  await page.locator('#rallyCameraInput').setInputFiles({name:'the-arch.jpg',mimeType:'image/jpeg',buffer:photoBuffer});
  await expect(page.locator('#rallyCameraWorkflow')).toBeHidden();
  await expect(page.locator('#rallyScore')).toHaveText('10');
  await expect(page.locator('#rallyNextName')).toHaveText('3.2 RIDGELINE');
  const switched=await page.locator('#rallyPrimaryCard').innerText();
  expect(switched).not.toContain('3.1 THE ARCH');
  expect((switched.match(/\d+(?:\.\d)? mi/g)||[])).toHaveLength(1);
});

test('portrait and landscape keep the compact card within 160px and clear of score and action dock',async({page},testInfo)=>{
  test.skip(!testInfo.project.name.startsWith('iPhone Pro portrait'));
  await loadObjective(page);

  for(const viewport of [{width:402,height:874,label:'current iPhone portrait'},{width:320,height:568,label:'small iPhone portrait'},{width:874,height:402,label:'current iPhone landscape'}]){
    await page.setViewportSize(viewport);
    await page.evaluate(()=>window.dispatchEvent(new Event('orientationchange')));
    const card=await page.locator('#rallyPrimaryCard').boundingBox(),score=await page.locator('.rally-score-slot').boundingBox(),dock=await page.locator('.rally-actions').boundingBox(),layers=await page.locator('.leaflet-control-layers').boundingBox();
    expect(card,`${viewport.label} card`).not.toBeNull();expect(score,`${viewport.label} score`).not.toBeNull();expect(dock,`${viewport.label} dock`).not.toBeNull();expect(layers,`${viewport.label} layers`).not.toBeNull();
    expect(card.height,`${viewport.label} compact height`).toBeLessThanOrEqual(160);
    expect(card.x,`${viewport.label} left`).toBeGreaterThanOrEqual(0);expect(card.x+card.width,`${viewport.label} right`).toBeLessThanOrEqual(viewport.width);
    expect(card.y,`${viewport.label} top`).toBeGreaterThanOrEqual(0);expect(card.y+card.height,`${viewport.label} bottom`).toBeLessThanOrEqual(viewport.height);
    expect(overlaps(card,score),`${viewport.label} card overlaps score`).toBeFalsy();
    expect(overlaps(card,dock),`${viewport.label} card overlaps action dock`).toBeFalsy();
    expect(overlaps(score,layers),`${viewport.label} score overlaps layer control`).toBeFalsy();
    if(viewport.height>viewport.width)expect(dock.y-(card.y+card.height),`${viewport.label} map space below objective`).toBeGreaterThanOrEqual(Math.min(180,viewport.height*.25));

    if(viewport.width===320){
      await page.locator('#rallyObjectiveDetailsToggle').click();
      await expect(page.locator('#rallyRecenterFab')).toBeHidden();
      await page.locator('#rallyObjectiveDetailsClose').click();
      await expect(page.locator('#rallyRecenterFab')).toBeVisible();
      await page.locator('#rallyTrailIntelButton').click();
      const compact=await page.locator('#rallyPrimaryCard').boundingBox(),intel=await page.locator('#intelSheet').boundingBox();
      expect(overlaps(compact,intel),'320px compact card overlaps Trail Intel').toBeFalsy();
      await page.locator('#intelCloseButton').click();
    }

    if(viewport.width===874){
      await page.locator('#rallyObjectiveDetailsToggle').click();
      await page.locator('#rallyPrimaryCard').evaluate(element=>{element.scrollTop=element.scrollHeight;});
      const expandedCard=await page.locator('#rallyPrimaryCard').boundingBox(),close=await page.locator('#rallyObjectiveDetailsClose').boundingBox();
      expect(close.y,'landscape sticky close top').toBeGreaterThanOrEqual(expandedCard.y);
      expect(close.y+close.height,'landscape sticky close bottom').toBeLessThanOrEqual(expandedCard.y+expandedCard.height);
      await page.locator('#rallyObjectiveDetailsClose').click();
    }
  }
});

test('Mission, Trail Intel, Journal, More, score, and map controls remain accessible',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='desktop');
  await loadObjective(page);
  await expect(page.locator('#rallyScore')).toBeVisible();
  await expect(page.locator('#rallyRecenterFab')).toBeVisible();
  for(const id of ['rallyMissionButton','rallyTrailIntelButton','rallyJournalButton','rallyMoreButton']){
    const control=page.locator(`#${id}`);await expect(control).toBeVisible();const box=await control.boundingBox();expect(box.width).toBeGreaterThanOrEqual(48);expect(box.height).toBeGreaterThanOrEqual(48);
  }
  await page.locator('#rallyTrailIntelButton').click();await expect(page.locator('#intelSheet')).toBeVisible();
  await page.locator('#intelCloseButton').click();await page.locator('#rallyJournalButton').click();await expect(page.locator('#rallyJournalSheet')).toBeVisible();
  await page.locator('#rallyJournalClose').click();await page.locator('#rallyMoreButton').click();await expect(page.locator('#rallyMoreSheet')).toBeVisible();
});

test('desktop Planner remains the desktop surface',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop');
  await page.goto('/?e2e=compact-objective-desktop');await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await expect(page.locator('#rallyMode')).toBeHidden();
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('#map')).toBeVisible();
});
