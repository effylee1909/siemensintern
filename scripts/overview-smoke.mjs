import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173');await expect(page.locator('.home-view h1')).toHaveText('會議總覽');
 const baseline=await page.evaluate(async()=>{
  const {demo}=await import('/src/model.js');const {putAttachment,saveWorkspace}=await import('/src/storage.js');const s=demo();
  const p={id:'preserved-ppt',name:'synthetic.pptx',data:'',size:10,blobId:await putAttachment(new Blob(['PKoriginal'])),slides:[{number:1,text:'Existing source text',content:'Existing source text',tables:[]}]};
  s.meetings[1].presentations=[p];await saveWorkspace(s,0,false,s.meetings[0].id);return s;
 });
 const state=()=>page.evaluate(async()=>{const {readWorkspace}=await import('/src/storage.js');return(await readWorkspace()).state;});
 await page.reload();await expect(page.locator('.home-table tbody tr')).toHaveCount(2);assert.deepEqual(await state(),baseline);
 await expect(page.locator('.home-continue')).toContainText(baseline.meetings[0].title);
 await page.locator('#home-search').fill('220');await expect(page.locator('.home-table tbody tr')).toHaveCount(1);
 await page.locator('#home-search').fill('');await page.locator('#home-order').selectOption('oldest');
 await expect(page.locator('.home-table tbody tr').first()).toContainText(baseline.meetings[0].title);
 await page.screenshot({path:'/tmp/meeting-overview.png',fullPage:true});
 await page.locator('.home-table [data-home-open]').last().click();await expect(page.locator('.home-view')).toHaveCount(0);await expect(page.locator('#add')).toBeVisible();
 await expect(page.locator('#save-state')).toHaveText('已儲存在此瀏覽器');assert.deepEqual(await state(),baseline);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'下載原檔'}).click();const file=await download;const {readFile}=await import('node:fs/promises');assert.equal((await readFile(await file.path())).toString(),'PKoriginal');
 await page.locator('#go-home').click();await expect(page.locator('.home-continue')).toContainText(baseline.meetings[1].title);
 await page.locator('#home-privacy').click();await expect(page.locator('dialog[open]')).toBeVisible();await page.locator('#close-modal').click();
 await page.reload();await expect(page.locator('.home-view')).toBeVisible();assert.deepEqual(await state(),baseline);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);await context.close();
 console.log('PASS: overview default route, counts/search/sort/recent, original meetings and attachment bytes preserved, editor navigation, privacy and mobile width');
}finally{await browser.close();}
