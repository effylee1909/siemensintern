import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5173/#meeting');
 const initial=await page.evaluate(async()=>{
  const{demo,nextMeeting}=await import('/src/model.js');const{saveWorkspace}=await import('/src/storage.js');
  const state=demo();state.meetings=state.meetings.slice(0,1);
  const prior=state.meetings[0];prior.entries=[{...prior.entries[0],topic:'設備測試程序',topicEn:'Equipment Test Procedure',status:'open'}];
  const now=nextMeeting(prior,'2026-10-14','New meeting');now.entries[0].description='Recorded current discussion';now.entries[0].note='Keep note';
  now.presentations=[{id:'fresh-slides',name:'fresh.pptx',data:'',slides:[['設備測試程序\nEquipment Test Procedure','本週已提交新版，等待回覆。\nNew revision submitted, awaiting reply.'],['新車站會勘\nNew Station Survey','請安排現場會勘。\nArrange a site survey.']].map(([title,content],i)=>({number:i+1,text:content,content,tables:[[['Topic','Description','Owner'],[title,content,'新負責人\nNew owner']]]}))}];
  state.meetings.push(now);await saveWorkspace(state,0,false,now.id);return state;
 });
 await page.reload();await page.locator('[data-prepare-ppt]').click();
 await expect(page.locator('[name="agenda-link-0"]')).toHaveValue(initial.meetings[0].entries[0].issueId);
 await expect(page.locator('[name="agenda-link-1"]')).toHaveValue('');
 await expect(page.locator('[name="summary-0"]')).toHaveCount(0);await expect(page.locator('[name="owner-0"]')).toHaveCount(0);
 const text=await page.locator('[name="agenda-link-0"] option').allTextContents();assert.ok(text.some(s=>s.includes(initial.meetings[0].date)));
 await page.getByRole('button',{name:'確認建立紀錄 / Apply agenda'}).click();await expect(page.locator('dialog')).not.toBeVisible();
 await expect(page.locator('#save-state')).toHaveText('已儲存在此瀏覽器');
 const result=await page.evaluate(async()=>{const{readWorkspace}=await import('/src/storage.js');return(await readWorkspace()).state;});
 assert.deepEqual(result.meetings[0],initial.meetings[0]);
 const entries=result.meetings[1].entries;assert.equal(entries.length,2);assert.equal(entries[0].issueId,initial.meetings[1].entries[0].issueId);assert.match(entries[0].summary,/本週已提交新版/);assert.equal(entries[0].description,'Recorded current discussion');assert.equal(entries[0].note,'Keep note');assert.equal(entries[0].owner,initial.meetings[1].entries[0].owner);assert.equal(entries[1].owner,'新負責人');
 console.log('PASS: automatic carryover matching updates summaries, adds new issues, preserves discussion/notes/owner and previous meeting; removed preview fields retain parsed data');
}finally{await browser.close();}
