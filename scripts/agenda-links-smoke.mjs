import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5173');
 const old=await page.evaluate(async()=>{
  const{demo}=await import('/src/model.js');const{saveWorkspace}=await import('/src/storage.js');const s=demo();
  const past=s.meetings[0];past.entries=[{...past.entries[0],topic:'測試程序',topicEn:'Test Procedure'}];
  const current=s.meetings[1];current.entries=[];current.presentations=[{id:'synthetic-slides',name:'synthetic.pptx',data:'',slides:[1,2].map(n=>({number:n,text:'synthetic',content:'synthetic',tables:[[['Topic','Description'],['測試程序\nTest Procedure',`第${n}個測試項目\nTest item ${n}`]]]}))}];
  await saveWorkspace(s,0,false,current.id);return structuredClone(past);
 });
 await page.reload();await page.locator('[data-prepare-ppt]').click();
 await expect(page.locator('[name="agenda-link-0"]')).toHaveValue('');await expect(page.locator('[name="agenda-link-1"]')).toHaveValue('');
 const fields=await page.locator('.agenda-preview article').first().locator('.bilingual-grid label').evaluateAll(nodes=>nodes.map(n=>n.firstChild.textContent));
 assert.deepEqual(fields,['Topic','議題','Key points','重點','Owner','負責人']);
 await page.getByRole('button',{name:'確認建立紀錄 / Apply agenda'}).click();await expect(page.locator('dialog')).not.toBeVisible();await expect(page.locator('.issue')).toHaveCount(2);
 await expect(page.locator('#save-state')).toHaveText('已儲存在此瀏覽器');
 const read=()=>page.evaluate(async()=>{const{readWorkspace}=await import('/src/storage.js');return(await readWorkspace()).state;});
 const first=await read();assert.deepEqual(first.meetings[0],old);
 await page.locator('[data-field="description"]').fill('Recorded discussion');
 await expect(page.locator('#save-state')).toHaveText('已儲存在此瀏覽器');
 await page.locator('[data-prepare-ppt]').click();
 const links=await page.locator('[name^="agenda-link-"]').evaluateAll(nodes=>nodes.map(n=>n.value));
 assert.equal(new Set(links).size,2);assert.ok(links.every(Boolean));
 await page.getByRole('button',{name:'確認建立紀錄 / Apply agenda'}).click();await expect(page.locator('dialog')).not.toBeVisible();
 await expect(page.locator('#save-state')).toHaveText('已儲存在此瀏覽器');const final=await read();
 assert.equal(final.meetings[1].entries.length,2);assert.equal(final.meetings[1].entries[0].description,'Recorded discussion');
 assert.deepEqual(final.meetings[0],old);
 console.log('PASS: ambiguous duplicate names import independently; repeat preparation uniquely updates sources and preserves discussion; English-left Chinese-right labels');
}finally{await browser.close();}
