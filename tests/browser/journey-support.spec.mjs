import {test,expect} from '@playwright/test';
const photoBuffer=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const project=(days=[1,31])=>({format:'CannonMap Project',project:{projectId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Month Journey',features:days.flatMap((day,index)=>[
  {id:`cp-${day}`,name:`${day}.1 Memory`,type:'checkpoint',day,sequence:1,status:'planned',points:10,photoRequirement:'optional',visible:true,geometry:{kind:'point',coordinates:[{lat:30+index,lon:-90-index}]}},
  {id:`hotel-${day}`,name:`${day}.2 Hotel`,type:'hotel',day,sequence:2,status:'planned',visible:true,geometry:{kind:'point',coordinates:[{lat:30.1+index,lon:-90.1-index}]}}
]),competitors:[]}});

async function open(page,payload=project()){
  await page.goto('/?e2e=journey');await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');await page.locator('#projectInput').setInputFiles({name:'month.cmap',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});await expect(page.locator('#status')).toContainText('Opened month.cmap');
}

test('nonconsecutive Day 31 remains available and requires explicit activation',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='iPhone 13 portrait');await open(page);await page.evaluate(()=>{const select=document.querySelector('#dayFilter');select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.evaluate(()=>window.CannonMapTest.completeCurrentCheckpoint(false));await page.evaluate(()=>window.CannonMapTest.completeCurrentCheckpoint(false));await page.locator('#rallyCameraInput').setInputFiles({name:'hotel.jpg',mimeType:'image/jpeg',buffer:photoBuffer});
  await expect(page.locator('#rallyStartNextDay')).toHaveText('Start Day 31');await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');await expect(page.locator('#rallyStartNextDay')).toHaveText('Start Day 31');await page.locator('#rallyStartNextDay').click();await expect(page.locator('#rallyNextName')).toContainText('31.1 Memory');
});

test('project lifecycle actions keep independent projects available on device',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='iPhone 13 portrait');await open(page,project([1]));await page.locator('#rallyMoreButton').click();await page.locator('.rally-storage-diagnostics summary').click();await expect(page.locator('#rallyStorageSummary')).toContainText('Current project');
  page.once('dialog',dialog=>dialog.accept('Journey to Start'));await page.locator('#rallyProjectCreate').click();await expect(page.locator('#rallyActiveProjectName')).toHaveText('Journey to Start');
  await page.locator('#rallyProjectSelect').selectOption({label:'Month Journey'});await page.locator('#rallyProjectSwitch').click();await expect(page.locator('#rallyActiveProjectName')).toHaveText('Month Journey');await expect(page.locator('#rallyProjectSelect option')).toHaveCount(2);
});

test('stationary Journey Photo is durable and appears in the cross-project gallery',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='iPhone 13 portrait');await open(page,project([1]));await page.locator('#rallyMoreButton').click();page.once('dialog',dialog=>dialog.accept('Sunset overlook'));await page.locator('#rallyJourneyForwardButton').click();await page.locator('#rallyJourneyPhotoInput').setInputFiles({name:'sunset.jpg',mimeType:'image/jpeg',buffer:photoBuffer});await expect(page.locator('#status')).toContainText('Journey photo stored');
  await page.locator('#rallyJourneyGalleryButton').click();await expect(page.locator('.rally-photo-kind')).toContainText('Journey Photos');await expect(page.locator('.rally-photo-group')).toContainText('Sunset overlook');await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');await page.locator('#rallyMoreButton').click();await page.locator('#rallyJourneyGalleryButton').click();await expect(page.locator('.rally-photo-group')).toContainText('Sunset overlook');
});
