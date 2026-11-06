import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { demo } from '../src/model.js';
import { readFile } from 'node:fs/promises';
const origin='http://127.0.0.1:4187';
const base=origin+'/siemensintern/';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'siemens_weeklymeeting/');await expect(page.locator('.home-view')).toBeVisible();
 const baseline=demo();
 baseline.meetings[1].presentations=[{id:'unchanged-ppt',name:'synthetic.pptx',data:'',blobId:'original-bytes',size:10,slides:[{number:1,text:'Original text',tables:[],content:'Original text'}]}];
 await page.evaluate(state=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('meeting-desk',2);
  request.onsuccess=()=>{
   const db=request.result,tx=db.transaction(['workspace','attachments'],'readwrite');
   tx.objectStore('workspace').put({state,revision:7,isDemo:false,selectedId:state.meetings[1].id},'current');
   tx.objectStore('attachments').put(new Blob(['PKoriginal']),'original-bytes');
   tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
  };request.onerror=()=>reject(request.error);
 }),baseline);
 await page.goto(base+'siemens_weekilymeeting/?bookmark=old#meeting');
 await expect(page).toHaveURL(base+'siemens_weeklymeeting/?bookmark=old#meeting');
 await expect(page.locator('.content')).toBeVisible();await expect(page.locator('h1')).toContainText(baseline.meetings[1].title);
 const saved=await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('meeting-desk',2);r.onsuccess=()=>{const db=r.result,tx=db.transaction('workspace'),get=tx.objectStore('workspace').get('current');get.onsuccess=()=>{resolve(get.result);db.close();};get.onerror=()=>reject(get.error);};}));
 assert.deepEqual(saved.state,baseline);assert.equal(saved.revision,7);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'下載原檔'}).click();assert.equal((await readFile(await(await download).path())).toString(),'PKoriginal');
 await page.goto(base+'siemens_weekilymeeting/#home');await expect(page).toHaveURL(base+'siemens_weeklymeeting/#home');await expect(page.locator('.home-table tbody tr')).toHaveCount(2);
 const js=await page.locator('script[type="module"]').getAttribute('src');assert.ok(js.includes('/siemens_weeklymeeting/assets/'));
 const legacyAsset=await page.request.get(origin+js.replace('/siemens_weeklymeeting/','/siemens_weekilymeeting/'));assert.equal(legacyAsset.status(),200);
 assert.deepEqual(errors,[]);
 console.log('PASS: correct production URL, old bookmark redirects preserve query/hash, same-origin workspace/revision/selection and original PPT bytes retained, cached asset alias');
}finally{await browser.close();}
