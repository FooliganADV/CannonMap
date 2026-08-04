import {defineConfig,devices} from '@playwright/test';

const testPort=Number(process.env.CANNONMAP_TEST_PORT)||4203;

/** Focused WebKit coverage for the iPhone camera/IndexedDB persistence contract. */
export default defineConfig({
  testDir:'./tests',
  testMatch:['integration/mission-media-persistence.spec.mjs','browser/webkit-photo-persistence.spec.mjs'],
  timeout:30000,
  fullyParallel:false,
  reporter:'list',
  use:{...devices['iPhone 13'],browserName:'webkit',baseURL:`http://127.0.0.1:${testPort}`,trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:`python -m http.server ${testPort} --bind 127.0.0.1`,url:`http://127.0.0.1:${testPort}`,reuseExistingServer:true}
});
