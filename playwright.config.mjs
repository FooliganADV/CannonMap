import { defineConfig, devices } from '@playwright/test';

const testPort=Number(process.env.CANNONMAP_TEST_PORT)||4184;
const configuredWorkers=Number(process.env.CANNONMAP_TEST_WORKERS);
const workers=Number.isInteger(configuredWorkers)&&configuredWorkers>0
  ? configuredWorkers
  : process.platform==='win32'?1:undefined;
const reuseExistingServer=process.env.CANNONMAP_REUSE_TEST_SERVER==='1';

export default defineConfig({
  testDir:'./tests',
  testMatch:['browser/**/*.spec.mjs','integration/**/*.spec.mjs'],
  timeout:30000,
  fullyParallel:false,
  workers,
  reporter:[['list'],['html',{open:'never',outputFolder:'playwright-report'}]],
  use:{baseURL:`http://127.0.0.1:${testPort}`,trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:`python -m http.server ${testPort} --bind 127.0.0.1`,url:`http://127.0.0.1:${testPort}`,reuseExistingServer},
  projects:[
    {name:'iPhone 13 portrait',use:{...devices['iPhone 13'],browserName:'chromium'}},
    {name:'iPhone 13 landscape',use:{...devices['iPhone 13 landscape'],browserName:'chromium'}},
    {name:'iPhone Pro portrait',use:{viewport:{width:402,height:874},isMobile:true,hasTouch:true,deviceScaleFactor:3}},
    {name:'iPhone Pro landscape',use:{viewport:{width:874,height:402},isMobile:true,hasTouch:true,deviceScaleFactor:3}},
    {name:'Android portrait',use:{...devices['Pixel 7'],browserName:'chromium'}},
    {name:'Android landscape',use:{...devices['Pixel 7 landscape'],browserName:'chromium'}},
    {name:'desktop',use:{viewport:{width:1440,height:900}}}
  ]
});
