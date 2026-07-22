import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const baseURL=process.env.CANNONMAP_URL||'http://127.0.0.1:4182';
const inputs=process.argv.slice(2).map(file=>path.resolve(file));
const output=path.resolve(process.env.CANNONMAP_OUTPUT||'artifacts');
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
await page.goto(`${baseURL}/?e2e=validation`);
await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
if(inputs.length){
  const project=inputs.find(file=>/\.(cmap|json)$/i.test(file));
  if(project){await page.locator('#projectInput').setInputFiles(project);await page.waitForFunction(()=>document.getElementById('status')?.textContent?.includes('Opened '));}
  else{await page.locator('#gpxInput').setInputFiles(inputs);await page.locator('#importForm button[value="replace"]').click();}
}
await page.evaluate(()=>{const select=document.getElementById('dayFilter');select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-tab="project"]').click();});
const results=await page.evaluate(()=>{const qa=window.CannonMapPlannerTest.qaRows(),day1Qa=window.CannonMapPlannerTest.validateDayPlan(1),lines=state.project.features.filter(f=>f.geometry?.kind==='line'),miles=items=>items.reduce((sum,f)=>sum+lineDistanceMiles(f.geometry.coordinates),0);return {qa,day1Detail:{checkpointSequence:day1Qa.checkpoints.map(f=>({sequence:f.sequence,name:f.name,points:f.points,extreme:f.extreme})),primaryRouteMiles:day1Qa.primaryRouteMiles,primaryTrackMiles:day1Qa.primaryTrackMiles,selectedPrimaryMiles:day1Qa.selectedPrimaryMiles,plannedPoints:day1Qa.points,longestFuelLeg:day1Qa.longestFuelLeg,legs:day1Qa.legs,issues:day1Qa.issues},mileageAudit:{rawAllLineMiles:miles(lines),rawRouteMiles:miles(lines.filter(f=>f.type==='route')),rawTrackMiles:miles(lines.filter(f=>f.type==='track')),selectedPrimaryMiles:qa.reduce((sum,row)=>sum+Number(row['Selected primary miles']),0),alternativeMiles:qa.reduce((sum,row)=>sum+Number(row['Alternate miles']),0),backboneMiles:miles(lines.filter(f=>f.type==='backbone')),unassignedLineMiles:miles(lines.filter(f=>!Number(f.day)))},day1:window.CannonMapPlannerTest.plannerGpx([1],`${state.project.name} Day 1`),master:window.CannonMapPlannerTest.plannerGpx([1,2,3,4,5,6,7,8],state.project.name),prohibited:state.project.features.filter(isProhibitedFeature).map(f=>f.name)};});
await fs.writeFile(path.join(output,'america250-qa.json'),JSON.stringify(results.qa,null,2));
await fs.writeFile(path.join(output,'america250-day-1-report.json'),JSON.stringify(results.day1Detail,null,2));
await fs.writeFile(path.join(output,'america250-mileage-audit.json'),JSON.stringify(results.mileageAudit,null,2));
await fs.writeFile(path.join(output,'america250-day-1.gpx'),results.day1);
await fs.writeFile(path.join(output,'america250-master.gpx'),results.master);
await page.locator('#checkpointSequence').scrollIntoViewIfNeeded();
await page.locator('.sidebar').screenshot({path:path.join(output,'desktop-route-builder-sequence.png')});
await page.locator('#buildSequenceRouteButton').scrollIntoViewIfNeeded();
await page.locator('.sidebar').screenshot({path:path.join(output,'desktop-route-builder-tools.png')});
await page.locator('#dailyQaSummary').scrollIntoViewIfNeeded();
await page.locator('.sidebar').screenshot({path:path.join(output,'desktop-route-builder-qa.png')});
await browser.close();
console.log(JSON.stringify({inputs,output,prohibited:results.prohibited,days:results.qa},null,2));
