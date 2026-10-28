import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5173/#meeting');
 const baseline=await page.evaluate(async()=>{
  const {demo}=await import('/src/model.js');const{saveWorkspace}=await import('/src/storage.js');const s=demo();s.meetings=s.meetings.slice(0,1);
  const m=s.meetings[0];m.entries=[{...m.entries[0],topic:'Existing issue',topicEn:'Existing issue',status:'open',description:'Keep discussion',note:'Keep note'}];
  m.presentations=[{id:'new-ppt',name:'synthetic.pptx',data:'',slides:[{number:1,text:'Synthetic',content:'Synthetic',tables:[[['Topic','Description','Status'],['New topic','New item','Open'],['Existing issue','Updated progress','Closed']]]}]}];
  await saveWorkspace(s,0,false,m.id);return s;
 });
 await page.reload();await page.locator('[data-prepare-ppt]').click();await expect(page.locator('.source-tables .home-table tr')).toHaveCount(3);await page.getByRole('button',{name:'確認建立紀錄 / Apply agenda'}).click();await expect(page.locator('dialog')).not.toBeVisible();
 const id=baseline.meetings[0].entries[0].issueId;await page.locator(`[data-entry="${id}"]`).click();
 await expect(page.locator('.status-review')).toBeVisible();await expect(page.locator('[data-field="status"]')).toHaveValue('open');
 await expect(page.locator('.issue').first()).toContainText('New topic');await expect(page.locator('[data-field="description"]')).toHaveValue('Keep discussion');
 await expect(page.locator('#save-state')).toHaveText('已儲存在此瀏覽器');await page.reload();await page.locator(`[data-entry="${id}"]`).click();await expect(page.locator('.status-review')).toBeVisible();await expect(page.locator('[data-field="status"]')).toHaveValue('open');
 await page.locator('#keep-status').click();await expect(page.locator('.status-review')).toHaveCount(0);await expect(page.locator('[data-field="status"]')).toHaveValue('open');
 await page.locator('[data-prepare-ppt]').click();await page.getByRole('button',{name:'確認建立紀錄 / Apply agenda'}).click();await page.locator(`[data-entry="${id}"]`).click();
 await page.locator('#accept-close').click();await expect(page.locator('[data-field="status"]')).toHaveValue('closed');await expect(page.locator('.status-review')).toHaveCount(0);
 await expect(page.locator('#save-state')).toHaveText('已儲存在此瀏覽器');await page.reload();await page.locator(`[data-entry="${id}"]`).click();await expect(page.locator('[data-field="status"]')).toHaveValue('closed');await expect(page.locator('[data-field="note"]')).toHaveValue('Keep note');
 console.log('PASS: PPT order interleaves new/existing issues; closing is suggested only; dismiss/confirm/reload preserve discussion and notes');
}finally{await browser.close();}
