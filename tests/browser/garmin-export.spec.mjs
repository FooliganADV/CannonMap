import {test,expect} from '@playwright/test';
import path from 'node:path';
import {readFile} from 'node:fs/promises';

const fixture=path.resolve('tests/fixtures/rally-project.cmap');

test('Planner opens focused Garmin dialog and downloads valid geometry-preserving GPX',async({page},testInfo)=>{
  await page.goto('/?e2e=garmin-export');await page.waitForFunction(()=>document.documentElement.dataset.cannonmapReady==='true');
  await page.locator('#projectInput').setInputFiles(fixture);await expect(page.locator('#status')).toContainText('Opened rally-project.cmap');
  if(await page.locator('#rallyPlannerButton').isVisible())await page.locator('#rallyPlannerButton').click();
  await page.locator('[data-tab="project"]').evaluate(button=>button.click());
  await page.locator('#exportGarminButton').evaluate(button=>button.click());await expect(page.locator('#garminExportDialog')).toBeVisible();
  await expect(page.locator('#garminNamePreview')).not.toHaveText('');await expect(page.locator('#garminExportCount')).toContainText('feature');
  await page.screenshot({path:testInfo.outputPath('garmin-export-dialog.png'),fullPage:true});
  const download=page.waitForEvent('download');await page.locator('#garminExportForm button[value="export"]').click();
  const file=await download,content=await readFile(await file.path(),'utf8');
  expect(file.suggestedFilename()).toMatch(/-garmin\.gpx$/);expect(content).toContain('xmlns:gpxx=');
  expect((content.match(/<rtept /g)||[]).length).toBeGreaterThan(1);expect(content).toContain('<gpxx:Category>Day 1</gpxx:Category>');
});
