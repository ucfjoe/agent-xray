import {test,expect} from '@playwright/test';
test('all perspectives, scenarios, filtering and exact diff inspection',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1200,height:900});await page.goto('/');
 for(const scenario of ['authentication','checkout','catalog']){
  await page.locator('#scenario').selectOption(scenario);
  for(const view of ['Story','Changes','Map','Journey']){
   await page.getByRole('tab',{name:view,exact:true}).click();
   await expect(page.locator('[data-select]').first()).toBeVisible();await page.locator('[data-select]').first().click();
   await expect(page.getByLabel('Code diff')).toBeVisible();
  }
  await page.getByRole('tab',{name:'Changes',exact:true}).click();
  for(const group of ['task','capability','module','risk','milestone']){await page.locator('#group').selectOption(group);await expect(page.locator('.navigator .file-row')).toHaveCount(6);}
 }
 await page.getByPlaceholder('Find a file or symbol…').fill('no-such-file');await expect(page.locator('.navigator .file-row')).toHaveCount(0);
 await page.getByPlaceholder('Find a file or symbol…').fill('');await page.locator('.navigator .file-row').first().click();
 await page.getByRole('button',{name:'Split',exact:true}).click();await expect(page.locator('.split-diff')).toBeVisible();
 expect(errors).toEqual([]);
});
test('narrow sidebar has deliberate drill-down and no document overflow',async({page})=>{
 await page.setViewportSize({width:380,height:900});await page.goto('/');await expect(page.locator('.story-group')).toHaveCount(3);
 await page.locator('.file-row').first().click();await expect(page.getByLabel('Code diff')).toBeVisible();await expect(page.locator('.navigator')).toBeHidden();
 await page.getByLabel('Back to changes').click();await expect(page.locator('.navigator')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('live default never silently shows demo data',async({page})=>{
 await page.goto('/?live=1');await expect(page.locator('#source')).toHaveValue('session');await expect(page.getByRole('alert')).toContainText('Open Agent X-Ray');await expect(page.locator('.demo-strip')).toHaveCount(0);
 await page.locator('#source').selectOption('demo');await expect(page.locator('.story-group')).toHaveCount(3);
 await page.locator('#source').selectOption('session');await expect(page.locator('.story-group')).toHaveCount(0);
});
for(const scheme of ['light','dark'])for(const width of [380,900,1440])test(`visual ${scheme} ${width}`,async({page})=>{
 await page.emulateMedia({colorScheme:scheme});await page.setViewportSize({width,height:950});await page.goto('/');await expect(page.locator('.story-group')).toHaveCount(3);
 if(width>759)await page.locator('.file-row').first().click();
 await page.screenshot({path:`test-results/preview-${scheme}-${width}.png`,fullPage:true});
 if(width===1440){await page.getByRole('tab',{name:'Map',exact:true}).click();await page.screenshot({path:`test-results/map-${scheme}.png`,fullPage:true});}
});
