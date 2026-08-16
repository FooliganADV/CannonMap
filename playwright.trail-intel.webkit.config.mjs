import {defineConfig,devices} from '@playwright/test';

const testPort=Number(process.env.CANNONMAP_TEST_PORT)||4320;

export default defineConfig({
  testDir:'./tests',
  testMatch:['browser/trail-intel-tactical-presentation.spec.mjs'],
  timeout:30000,
  fullyParallel:false,
  workers:1,
  reporter:'list',
  use:{baseURL:`http://127.0.0.1:${testPort}`,trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:`python -m http.server ${testPort} --bind 127.0.0.1`,url:`http://127.0.0.1:${testPort}`,reuseExistingServer:true},
  projects:[
    {name:'iPhone 13 WebKit portrait',use:{...devices['iPhone 13'],browserName:'webkit'}},
    {name:'iPhone 13 WebKit landscape',use:{...devices['iPhone 13 landscape'],browserName:'webkit'}}
  ]
});
