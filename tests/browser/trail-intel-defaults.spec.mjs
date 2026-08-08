import {test,expect} from '@playwright/test';

const SETTINGS_KEY='cannonmap.settings.v6';
const open=async page=>{
  await page.goto('/?e2e=trail-intel-event-27');
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await page.evaluate(()=>{document.querySelector('[data-tab="tracking"]').click();document.querySelector('#rallyEventId').closest('details').open=true;});
};

test('fresh Trail Intel uses Event 27 for the built-in feed and leaderboard',async({page})=>{
  await open(page);
  await expect(page.locator('#rallyEventId')).toHaveValue('27');
  await expect(page.locator('#leaderboardUrl')).toHaveValue('https://gpscheckpoints.com/admin/leaderboard.html?id_event=27');
  await expect(page.locator('#rallyEndpointUrl')).toHaveValue('');
  const opened=await page.evaluate(()=>{window.__openedLeaderboard='';window.open=url=>{window.__openedLeaderboard=url;};return true;});
  expect(opened).toBeTruthy();
  await page.evaluate(()=>document.querySelector('#openLeaderboardButton').click());
  expect(await page.evaluate(()=>window.__openedLeaderboard)).toBe('https://gpscheckpoints.com/admin/leaderboard.html?id_event=27');
  await page.evaluate(()=>{
    window.__createdFeedEventId='';
    window.GPSCheckpointsFeed.createGPSCheckpointsFeed=options=>({
      on(){},stop(){},async start(){window.__createdFeedEventId=String(options.eventId);}
    });
  });
  await page.evaluate(()=>document.querySelector('#toggleRallyPollingButton').click());
  await expect.poll(()=>page.evaluate(()=>window.__createdFeedEventId)).toBe('27');
});

test('exact Event 15 legacy defaults migrate once',async({page})=>{
  await page.addInitScript(({key})=>localStorage.setItem(key,JSON.stringify({rallyEventId:'15',leaderboardUrl:'https://gpscheckpoints.com/admin/leaderboard.html?id_event=15',rallyEndpointUrl:''})),{key:SETTINGS_KEY});
  await open(page);
  await expect(page.locator('#rallyEventId')).toHaveValue('27');
  const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),SETTINGS_KEY);
  expect(stored).toMatchObject({rallyEventId:'27',leaderboardUrl:'https://gpscheckpoints.com/admin/leaderboard.html?id_event=27',rallyFeedDefaultRevision:'2026-event-27'});
});

test('custom values survive migration and a later manual Event 15 selection persists',async({page})=>{
  await page.addInitScript(({key})=>{if(sessionStorage.getItem('trail-intel-custom-seeded'))return;localStorage.setItem(key,JSON.stringify({rallyEventId:'42',leaderboardUrl:'https://example.test/leaderboard/42',rallyEndpointUrl:'https://example.test/feed/42'}));sessionStorage.setItem('trail-intel-custom-seeded','true');},{key:SETTINGS_KEY});
  await open(page);
  await expect(page.locator('#rallyEventId')).toHaveValue('42');
  await expect(page.locator('#leaderboardUrl')).toHaveValue('https://example.test/leaderboard/42');
  await expect(page.locator('#rallyEndpointUrl')).toHaveValue('https://example.test/feed/42');
  await page.evaluate(()=>{document.querySelector('#rallyEventId').value='15';document.querySelector('#leaderboardUrl').value='https://gpscheckpoints.com/admin/leaderboard.html?id_event=15';document.querySelector('#saveTrackingSettings').click();});
  await expect.poll(()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)).rallyEventId,SETTINGS_KEY)).toBe('15');
  await page.reload();
  await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await expect(page.locator('#rallyEventId')).toHaveValue('15');
  await expect(page.locator('#rallyEndpointUrl')).toHaveValue('https://example.test/feed/42');
});
