import {defineConfig,devices} from '@playwright/test';

const testPort=Number(process.env.CANNONMAP_TEST_PORT)||4206;
const reuseExistingServer=process.env.CANNONMAP_REUSE_TEST_SERVER==='1';

/** Isolated iPhone readiness coverage; existing media-persistence cases are not duplicated. */
export default defineConfig({
  testDir:'./tests',
  testMatch:['browser/camera-readiness-webkit.spec.mjs'],
  timeout:30000,
  fullyParallel:false,
  workers:process.platform==='win32'?1:undefined,
  reporter:'list',
  use:{baseURL:`http://127.0.0.1:${testPort}`,browserName:'webkit',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:`python -m http.server ${testPort} --bind 127.0.0.1`,url:`http://127.0.0.1:${testPort}`,reuseExistingServer},
  projects:[
    {name:'iPhone 13 WebKit portrait',use:{...devices['iPhone 13']}},
    {name:'iPhone 13 WebKit landscape',use:{...devices['iPhone 13 landscape']}}
  ]
});
