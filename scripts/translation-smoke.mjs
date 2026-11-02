import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const url='http://127.0.0.1:5173/#meeting';
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(()=>{
  window.testTranslationDelay=30;window.translationCalls=0;
  Object.defineProperty(window,'Translator',{configurable:true,value:{
   availability:async()=> 'available',
   create:async options=>{
    options.monitor?.({addEventListener(type,listener){listener({loaded:50,total:100});}});
    let destroyed=false;
    return {async translate(text,{signal}={}){
      window.translationCalls++;await new Promise(resolve=>setTimeout(resolve,window.testTranslationDelay));
      if(destroyed||signal?.aborted)throw new DOMException('Cancelled','AbortError');
      if(window.testTranslationFails)return '';
      return text.replaceAll('中文甲','English A').replaceAll('中文乙','English B').replaceAll('中文丙','English C').replaceAll('中文更新','Updated English');
    },destroy(){destroyed=true;}};
   }
  }});
 });
 const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await page.goto(url);
 const baseline=await page.evaluate(async()=>{
  const {demo}=await import('/src/model.js');const{saveWorkspace}=await import('/src/storage.js');const s=demo(),m=s.meetings[1];
  m.entries=[{...m.entries[0],issueId:'translate-one',description:'中文甲',descriptionEn:''},{...m.entries[1],issueId:'keep-english',description:'中文乙',descriptionEn:'Do not overwrite my English'},{...m.entries[2],issueId:'translate-last',description:'中文丙',descriptionEn:''}];
  await saveWorkspace(s,0,false,m.id);return s;
 });
 await page.reload();await page.locator('#translate-meeting').click();
 await expect(page.locator('#translation-progress-text')).toContainText('已填入 2 段');
 await expect(page.locator('[data-field="descriptionEn"]')).toHaveValue('English A');
 await expect(page.locator('#discussion-translation-status')).toHaveText('已翻譯・可直接修改');
 assert.equal(await page.locator('dialog[open]').count(),0);
 await expect(page.locator('#save-state')).toHaveText('已儲存在此瀏覽器');
 const read=()=>page.evaluate(async()=>{const{readWorkspace}=await import('/src/storage.js');return(await readWorkspace()).state;});
 let saved=await read();assert.deepEqual(saved.meetings[0],baseline.meetings[0]);
 assert.equal(saved.meetings[1].entries[1].descriptionEn,'Do not overwrite my English');assert.equal(saved.meetings[1].entries[2].descriptionEn,'English C');
 for(let i=0;i<3;i++){
  const {descriptionEn,discussionTranslation,...after}=saved.meetings[1].entries[i];
  const {descriptionEn:oldEnglish,...before}=baseline.meetings[1].entries[i];assert.deepEqual(after,before);
 }
 await page.evaluate(()=>window.testTranslationDelay=400);await page.locator('#translate-topic').click();
 await page.locator('[data-field="descriptionEn"]').fill('My manually edited English');
 await expect(page.locator('#translation-progress-text')).toContainText('未覆寫');
 await expect(page.locator('[data-field="descriptionEn"]')).toHaveValue('My manually edited English');
 await expect(page.locator('#discussion-translation-status')).toHaveText('英文已手動修改');
 await page.locator('[data-field="description"]').fill('中文更新');await expect(page.locator('#discussion-translation-status')).toHaveText('中文已更新，英文待同步');
 await page.evaluate(()=>window.testTranslationDelay=30);await page.locator('#translate-topic').click();await expect(page.locator('[data-field="descriptionEn"]')).toHaveValue('Updated English');
 await expect(page.locator('#save-state')).toHaveText('已儲存在此瀏覽器');await page.reload();await expect(page.locator('#discussion-translation-status')).toHaveText('已翻譯・可直接修改');
 await page.evaluate(()=>window.testTranslationDelay=400);await page.locator('#translate-topic').click();await page.locator('#cancel-translation').click();
 await expect(page.locator('#translation-progress-text')).toContainText('已取消');await expect(page.locator('#translate-topic')).toBeEnabled();
 await expect(page.locator('[data-field="descriptionEn"]')).toHaveValue('Updated English');
 await page.evaluate(()=>{window.testTranslationDelay=10;window.testTranslationFails=true;});await page.locator('#translate-topic').click();await expect(page.locator('#translation-progress-text')).toContainText('1 段失敗');await expect(page.locator('[data-field="descriptionEn"]')).toHaveValue('Updated English');
 const archive=await page.evaluate(async()=>{const {readWorkspace,plainBackup,readPlainBackup}=await import('/src/storage.js');const {exportDocx}=await import('/src/office.js');const s=(await readWorkspace()).state;readPlainBackup(plainBackup(s));return [...exportDocx(s.meetings[1])];});
 assert.match(strFromU8(unzipSync(Uint8Array.from(archive))['word/document.xml']),/Updated English/);
 await page.screenshot({path:'/tmp/discussion-translation-ui.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);assert.ok(requests.every(u=>new URL(u).hostname==='127.0.0.1'));
 // Unsupported browsers fail visibly without clearing or modifying any text.
 const unsupported=await browser.newContext();await unsupported.addInitScript(()=>Object.defineProperty(window,'Translator',{configurable:true,value:undefined}));
 const p=await unsupported.newPage();await p.goto(url);
 await p.evaluate(async()=>{const{demo}=await import('/src/model.js');const{saveWorkspace}=await import('/src/storage.js');const s=demo();s.meetings[0].entries[0].description='中文甲';s.meetings[0].entries[0].descriptionEn='';await saveWorkspace(s,0,false,s.meetings[0].id);});
 await p.reload();const before=await p.evaluate(async()=>{const{readWorkspace}=await import('/src/storage.js');return(await readWorkspace()).state;});
 await p.locator('#translate-topic').click();await expect(p.locator('#translation-progress-text')).toContainText('不支援本機翻譯');
 const after=await p.evaluate(async()=>{const{readWorkspace}=await import('/src/storage.js');return(await readWorkspace()).state;});assert.deepEqual(after,before);
 await unsupported.close();await context.close();
 console.log('PASS (mock native adapter): direct fill, blank-only batch, manual English protection, stale indicator, save/reload, cancel, Word/backup, mobile, unsupported browser; no external translation requests');
}finally{await browser.close();}
