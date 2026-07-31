import {test,expect} from '@playwright/test';
import path from 'node:path';

const fixture=path.resolve('tests/fixtures/rally-project.cmap');

async function loadProject(page){
  await page.goto('/?e2e=m4-project');
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await page.locator('#projectInput').setInputFiles(fixture);
  await expect(page.locator('#status')).toContainText('Opened rally-project.cmap');
}

test('portable project load, duplication, local save, and reload remain equivalent',async({page})=>{
  await loadProject(page);
  const before=await page.locator('#layerList .layer-row').count();
  await page.evaluate(()=>{
    document.querySelector('#layerList [data-select-id]').click();
    document.getElementById('duplicateFeatureButton').click();
  });
  await expect(page.locator('#layerList')).toContainText('copy');
  await expect(page.locator('#layerList .layer-row')).toHaveCount(before+1);
  await page.locator('#saveButton').click();
  await expect(page.locator('#status')).toContainText('Saved locally');
  await page.reload();
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await expect(page.locator('#layerList')).toContainText('copy');
  await expect(page.locator('#layerList .layer-row')).toHaveCount(before+1);
});

test('cached offline Rally Mode retains checkpoint operation',async({page,context})=>{
  await loadProject(page);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await page.evaluate(()=>{const select=document.getElementById('dayFilter');select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.locator('#saveButton').click();
  await expect(page.locator('#status')).toContainText('Saved locally');
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await page.evaluate(()=>window.CannonMapTest.selectNextCheckpoint());
  await expect(page.locator('#rallyNextName')).toContainText('Checkpoint One');
  await page.evaluate(()=>window.CannonMapTest.deferCurrentCheckpoint());
  await expect(page.locator('#rallyNextName')).toContainText('Extreme Checkpoint Two');
  await page.evaluate(()=>window.CannonMapTest.completeCurrentCheckpoint(true));
  await page.waitForFunction(async()=>{
    const events=await window.CannonMapTest.missionControlJournalEvents();
    return events.some(event=>event.eventType==='checkpoint_completed'&&event.source==='gps_capture');
  });
  await context.setOffline(false);
});
