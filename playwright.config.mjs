import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir:'./tests/browser',
  timeout:30000,
  fullyParallel:false,
  reporter:[['list'],['html',{open:'never',outputFolder:'playwright-report'}]],
  use:{baseURL:'http://127.0.0.1:4182',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:'python -m http.server 4182 --bind 127.0.0.1',url:'http://127.0.0.1:4182',reuseExistingServer:true},
  projects:[
    {name:'iPhone 13 portrait',use:{...devices['iPhone 13'],browserName:'chromium'}},
    {name:'iPhone 13 landscape',use:{...devices['iPhone 13 landscape'],browserName:'chromium'}},
    {name:'iPhone Pro portrait',use:{viewport:{width:402,height:874},isMobile:true,hasTouch:true,deviceScaleFactor:3}},
    {name:'iPhone Pro landscape',use:{viewport:{width:874,height:402},isMobile:true,hasTouch:true,deviceScaleFactor:3}},
    {name:'desktop',use:{viewport:{width:1440,height:900}}}
  ]
});
