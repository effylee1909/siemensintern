import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try {
  const page=await browser.newPage();await page.goto('http://127.0.0.1:5173');
  const original=await page.evaluate(async()=>{
    const {demo}=await import('/src/model.js');
    const {saveWorkspace}=await import('/src/storage.js');
    const state=demo();const m=state.meetings[0];
    m.entries[0].topic='目前需要安排夜間施作時段';
    m.entries[0].sourceText='目前僅能配合每週二晚上施工，等待確認';
    m.entries[0].description='Do not erase discussion';m.entries[0].note='Keep note';
    m.entries[1].topic='請確認整體切換策略';m.entries[1].sourceText='整體切換策略調整為多個工作面同步推動';
    await saveWorkspace(state,0,false,m.id);return state;
  });
  await page.reload();await page.locator('#rename-topics').click();
  await expect(page.locator('input[name="rename-zh-0"]')).toHaveValue('夜班施工時間');
  await expect(page.locator('input[name="rename-zh-1"]')).toHaveValue('切換策略');
  await page.locator('dialog [type="submit"]').click();
  await expect(page.locator('#save-state')).toHaveText('已儲存在此瀏覽器');
  await page.reload();
  const updated=await page.evaluate(async()=>{const {readWorkspace}=await import('/src/storage.js');return (await readWorkspace()).state;});
  assert.equal(updated.meetings[0].entries[0].topic,'夜班施工時間');
  assert.equal(updated.meetings[0].entries[1].topic,'切換策略');
  for(let i=0;i<original.meetings[0].entries.length;i++){
    const {topic,topicEn,...before}=original.meetings[0].entries[i];
    const {topic:afterTopic,topicEn:afterEnglish,...after}=updated.meetings[0].entries[i];
    assert.deepEqual(after,before);
  }
  assert.deepEqual(updated.meetings[1],original.meetings[1]);
  console.log('PASS: all current topic names preview/apply/reload; discussions, notes, identities, status and other meetings preserved');
}finally{await browser.close();}
