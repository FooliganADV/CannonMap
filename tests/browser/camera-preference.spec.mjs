import {test,expect} from '@playwright/test';

test('Selfie is default, Forward persists, and both capture workflows share it',async({page},testInfo)=>{
  test.skip(!testInfo.project.name.startsWith('iPhone 13'),'Mission Control camera controls are a mobile workflow.');
  await page.goto('/?e2e=camera-preference');await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  const project={format:'CannonMap Project',project:{projectId:'camera-project',name:'Camera Test',features:[{id:'cp',name:'1.1 Camera',type:'checkpoint',day:1,sequence:1,status:'planned',visible:true,geometry:{kind:'point',coordinates:[{lat:30,lon:-90}]}}],competitors:[]}};
  await page.locator('#projectInput').setInputFiles({name:'camera.cmap',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await expect(page.locator('#rallyCameraInput')).toHaveAttribute('accept','image/*');
  await expect(page.locator('#rallyCameraInput')).toHaveAttribute('capture','user');
  await expect(page.locator('#rallyJourneyPhotoInput')).toHaveAttribute('capture','user');
  await page.locator('#rallyMoreButton').click();await page.locator('.rally-camera-settings summary').click();await page.locator('#rallyPreferredCameraForward').click();
  await expect(page.locator('#rallyCameraInput')).toHaveAttribute('capture','environment');
  await expect(page.locator('#rallyJourneyPhotoInput')).toHaveAttribute('capture','environment');
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await expect(page.locator('#rallyCameraInput')).toHaveAttribute('capture','environment');
  await expect(page.locator('#rallyPreferredCameraForward')).toHaveClass(/is-active/);
});
