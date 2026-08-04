import {test,expect} from '@playwright/test';
import path from 'node:path';

const fixture=path.resolve('tests/fixtures/mandeville-field-test.gpx');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');

test('WebKit PWA camera capture persists, completes, and survives page termination',async({page,context})=>{
  await page.goto('/?e2e=webkit-camera-persistence');await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await page.locator('#gpxInput').setInputFiles(fixture);await page.locator('#importForm button[value="replace"]').click();
  await page.evaluate(()=>window.CannonMapTest.completeCurrentCheckpoint(true));await expect(page.locator('#rallyCameraWorkflow')).toBeVisible();
  await page.locator('#rallyCameraInput').setInputFiles({name:'IMG_0001.PNG',mimeType:'image/png',buffer:png});await expect(page.locator('#rallyCameraWorkflow')).toBeHidden();
  const before=await page.evaluate(async()=>({media:await window.CannonMapTest.missionMediaRecords(),events:await window.CannonMapTest.missionControlJournalEvents()}));
  expect(before.media.map(item=>item.role).sort()).toEqual(['evidence','original']);expect(before.media.find(item=>item.role==='original').bytes).toEqual([...png]);expect(before.events.some(event=>event.eventType==='photo_added')).toBeTruthy();expect(before.events.some(event=>event.eventType==='checkpoint_completed')).toBeTruthy();
  await page.close();const restored=await context.newPage();await restored.goto('/?e2e=webkit-camera-restored');await restored.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  const after=await restored.evaluate(async()=>({media:await window.CannonMapTest.missionMediaRecords(),events:await window.CannonMapTest.missionControlJournalEvents()}));expect(after.media).toHaveLength(2);expect(after.events.filter(event=>event.eventType==='photo_added')).toHaveLength(1);expect(after.events.filter(event=>event.eventType==='checkpoint_completed')).toHaveLength(1);
});

test('WebKit restores PHOTO_REQUIRED after termination and permits durable retry',async({page,context})=>{
  await page.goto('/?e2e=webkit-camera-interrupted');await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');await page.locator('#gpxInput').setInputFiles(fixture);await page.locator('#importForm button[value="replace"]').click();
  await page.evaluate(()=>window.CannonMapTest.completeCurrentCheckpoint(true));await expect(page.locator('#rallyObjectiveStatus')).toContainText('photo_required');await page.close();
  const restored=await context.newPage();await restored.goto('/?e2e=webkit-camera-retry');await restored.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');await expect(restored.locator('#rallyCameraWorkflow')).toBeVisible();await expect(restored.locator('#rallyObjectiveStatus')).toContainText('photo_required');
  await restored.locator('#rallyCameraInput').setInputFiles({name:'IMG_RETRY.PNG',mimeType:'image/png',buffer:png});await expect(restored.locator('#rallyCameraWorkflow')).toBeHidden();const events=await restored.evaluate(()=>window.CannonMapTest.missionControlJournalEvents());expect(events.filter(event=>event.eventType==='photo_added')).toHaveLength(1);expect(events.filter(event=>event.eventType==='checkpoint_completed')).toHaveLength(1);
});
