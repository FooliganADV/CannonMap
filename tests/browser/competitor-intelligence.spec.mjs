import {test,expect} from '@playwright/test';
test('competitor popup survives live-style refresh and segmented trails never form one fan line',async({page})=>{
  await page.goto('/?e2e=competitor-intelligence');await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  const now=Date.now(),riders=[{id:'7',name:'Rider 7',points:[{lat:30,lon:-90,time:new Date(now-120000).toISOString(),sessionId:'a'},{lat:30.001,lon:-90,time:new Date(now-60000).toISOString(),sessionId:'a'},{lat:40,lon:-80,time:new Date(now-30000).toISOString(),sessionId:'b'}]},{id:'8',name:'Rider 8',points:[{lat:31,lon:-91,time:new Date(now-60000).toISOString()}]}];
  const before=await page.evaluate(value=>window.CannonMapTest.setCompetitorsForTest(value),riders);expect(before.registry.competitors).toBe(3);
  await page.evaluate(()=>window.CannonMapTest.openCompetitorPopupForTest('7'));await expect(page.locator('.leaflet-popup')).toContainText('Rider 7');
  await page.evaluate(value=>window.CannonMapTest.setCompetitorsForTest(value),riders);await expect(page.locator('.leaflet-popup')).toContainText('Rider 7');expect(await page.evaluate(()=>window.CannonMapTest.competitorPopupState()?.id)).toBe('7');
});
