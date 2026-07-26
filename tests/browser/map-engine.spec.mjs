import {test,expect} from '@playwright/test';
import path from 'node:path';

test('MapEngine owns one map and registry counts stay aligned across repeated renders',async({page})=>{
  await page.goto('/?e2e=map-engine-m3');
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await page.locator('#projectInput').setInputFiles(path.resolve('tests/fixtures/rally-project.cmap'));
  await expect(page.locator('#status')).toContainText('Opened rally-project.cmap');
  const result=await page.evaluate(()=>{
    const before=window.CannonMapTest.mapEngineDiagnostics();
    window.CannonMapTest.renderMapFeatures();
    const after=window.CannonMapTest.mapEngineDiagnostics();
    return {before,after};
  });
  expect(result.before.mapContainers).toBe(1);
  expect(result.after.mapContainers).toBe(1);
  expect(result.after.registry).toEqual(result.after.groups);
  expect(result.after).toEqual(result.before);
});
