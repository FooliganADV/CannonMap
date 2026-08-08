import {test,expect} from '@playwright/test';

const waitForStartup=page=>page.waitForFunction(()=>['ready','failed'].includes(document.documentElement.dataset.cannonmapStartupState));

test('successful startup uses repository-managed local dependencies',async({page})=>{
  await page.goto('/?e2e=local-dependencies');
  await waitForStartup(page);
  await expect(page.locator('html')).toHaveAttribute('data-cannonmap-startup-state','ready');
  const runtime=await page.evaluate(()=>({
    leaflet:typeof L?.map==='function',
    geoman:Boolean(L?.PM),
    sheetjs:Boolean(XLSX?.utils),
    firebase:typeof firebase?.database==='function',
    dependencyResources:performance.getEntriesByType('resource').map(entry=>entry.name).filter(name=>/leaflet|geoman|xlsx|firebase/i.test(name))
  }));
  expect(runtime).toMatchObject({leaflet:true,geoman:true,sheetjs:true,firebase:true});
  expect(runtime.dependencyResources.length).toBeGreaterThanOrEqual(7);
  const appOrigin=new URL(page.url()).origin;
  expect(runtime.dependencyResources.every(url=>new URL(url).origin===appOrigin)).toBeTruthy();
});

test('missing required dependency exposes explicit failed readiness',async({page})=>{
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.addInitScript(()=>{globalThis.__CANNONMAP_TEST_MISSING_DEPENDENCY='Leaflet';});
  await page.goto('/?e2e=missing-required-dependency');
  await waitForStartup(page);
  await expect(page.locator('html')).toHaveAttribute('data-cannonmap-startup-state','failed');
  await expect(page.locator('html')).toHaveAttribute('data-cannonmap-ready','false');
  await expect(page.locator('html')).toHaveAttribute('data-cannonmap-missing-dependencies',/Leaflet/);
  await expect(page.locator('#status')).toContainText('Missing required dependency');
  expect(pageErrors).not.toContain('L is not defined');
});

test('optional Firebase failure does not block startup or service-worker registration',async({page})=>{
  await page.route('**/vendor/firebase/*.js',route=>route.abort());
  await page.goto('/?e2e=missing-optional-firebase');
  await waitForStartup(page);
  await expect(page.locator('html')).toHaveAttribute('data-cannonmap-startup-state','ready');
  await expect(page.locator('html')).toHaveAttribute('data-cannonmap-optional-missing',/Firebase/);
  const registration=await page.evaluate(async()=>{
    const ready=await navigator.serviceWorker.ready;
    return {active:Boolean(ready.active),scope:ready.scope};
  });
  expect(registration.active).toBeTruthy();
});

test('offline shell includes and loads locally cached dependency assets',async({page,context})=>{
  await page.goto('/?e2e=offline-vendor-install');
  await waitForStartup(page);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();
  await waitForStartup(page);
  await context.setOffline(true);
  await page.reload();
  await waitForStartup(page);
  await expect(page.locator('html')).toHaveAttribute('data-cannonmap-startup-state','ready');
  const cached=await page.evaluate(async()=>{
    const names=await caches.keys();
    const cache=await caches.open(names.find(name=>name.startsWith('cannonmap-v0.7.4-')));
    const assets=['vendor/leaflet/leaflet.js','vendor/leaflet-geoman/leaflet-geoman.min.js','vendor/xlsx/xlsx.full.min.js','vendor/firebase/firebase-app.js','vendor/firebase/firebase-database.js'];
    return Promise.all(assets.map(async asset=>Boolean(await cache.match(asset))));
  });
  expect(cached).toEqual([true,true,true,true,true]);
  await context.setOffline(false);
});
