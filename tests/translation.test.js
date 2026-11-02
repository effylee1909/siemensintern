import {test} from 'node:test';
import assert from 'node:assert/strict';
import {protectDiscussion,translateDiscussion,translationTargets,mayApplyTranslation,discussionHash,translationBadge} from '../src/translation.js';
import {demo,nextMeeting,validateState} from '../src/model.js';
import {applyPreparedAgenda} from '../src/agenda.js';
import {plainBackup,readPlainBackup} from '../src/storage.js';

test('technical identifiers, dates, references, quantities and existing placeholder-like source text survive translation',async()=>{
 const source='請於2026/11/02追蹤SAT4.3R、SW0.3.0及SMOMLEI00字第1150000251號，完成率94.89%。ZXQKEEP';
 const {masked,restore}=protectDiscussion(source);
 assert.ok(!masked.includes('2026/11/02'));assert.equal(restore(masked),source);
 assert.throws(()=>restore(masked.replace(/ZXQKEEP[^ ]*?QXZ/,'')),/未完整保留/);
 const output=await translateDiscussion({translate:async s=>'English: '+s},source);
 for(const value of ['2026/11/02','SAT4.3R','SW0.3.0','SMOMLEI00字第1150000251號','94.89%','ZXQKEEP']) assert.ok(output.includes(value));
});
test('multiline discussions keep line breaks, bullet prefixes and protected tokens across long chunk boundaries',async()=>{
 const source='• 已提交\n\n'+('討論'.repeat(894))+'2026/11/02'+'事項'.repeat(1000);
 const chunks=[];const out=await translateDiscussion({translate:async text=>{chunks.push(text);return text;}},source);
 assert.equal(out.replaceAll(' ',''),source.replaceAll(' ',''));assert.equal(out.split('\n').length,source.split('\n').length);assert.ok(chunks.length>=3);assert.ok(chunks.every(c=>c.length<=1800));
 await assert.rejects(translateDiscussion({translate:async()=>''},'中文討論'),/未傳回內容/);
});
test('batch only includes Chinese discussions with blank English; individual retranslation is explicit',()=>{
 const meeting={entries:[{issueId:'a',description:'中文',descriptionEn:''},{issueId:'b',description:'中文',descriptionEn:'Edited English'},{issueId:'c',description:'English only',descriptionEn:''}]};
 assert.deepEqual(translationTargets(meeting).map(e=>e.issueId),['a']);
 assert.deepEqual(translationTargets(meeting,'b').map(e=>e.issueId),['b']);
});
test('late results cannot overwrite edits, deleted records, changed workspaces or another meeting',()=>{
 const entry={issueId:'one',description:'中文',descriptionEn:''};const state={meetings:[{id:'m',entries:[entry]}]};
 const snapshot={issueId:'one',source:'中文',target:''};
 assert.equal(mayApplyTranslation(state,state,'m',snapshot),entry);
 entry.descriptionEn='Manual edit';assert.equal(mayApplyTranslation(state,state,'m',snapshot),null);
 entry.descriptionEn='';entry.description='新中文';assert.equal(mayApplyTranslation(state,state,'m',snapshot),null);
 assert.equal(mayApplyTranslation(structuredClone(state),state,'m',snapshot),null);
 state.meetings[0].entries=[];assert.equal(mayApplyTranslation(state,state,'m',snapshot),null);
});
test('translation badges distinguish local result, stale Chinese and manual English edits',async()=>{
 const entry={description:'中文',descriptionEn:'English'};entry.discussionTranslation={sourceHash:await discussionHash(entry.description),targetHash:await discussionHash(entry.descriptionEn),mode:'local'};
 assert.equal((await translationBadge(entry)).text,'已翻譯・可直接修改');
 entry.descriptionEn='Edited';assert.equal((await translationBadge(entry)).text,'英文已手動修改');
 entry.description='新中文';assert.equal((await translationBadge(entry)).stale,true);
});
test('translation metadata survives backup and PPT refresh but never carries to next week',async()=>{
 const state=demo(),meeting=state.meetings[0],entry=meeting.entries[0];
 entry.discussionTranslation={sourceHash:await discussionHash(entry.description),targetHash:await discussionHash(entry.descriptionEn),mode:'local'};
 assert.deepEqual(readPlainBackup(plainBackup(state)),state);
 const metadata=structuredClone(entry.discussionTranslation);
 applyPreparedAgenda(meeting,[{...entry,summary:'New summary'}],[{index:0,issueId:entry.issueId}]);
 assert.deepEqual(meeting.entries[0].discussionTranslation,metadata);
 assert.equal(nextMeeting(meeting,'2026-11-03','Next').entries[0].discussionTranslation,undefined);
 const bad=structuredClone(state);bad.meetings[0].entries[0].discussionTranslation.sourceHash='invalid';assert.throws(()=>validateState(bad),/翻譯狀態/);
});

test('native adapter follows Edge API language fallback, byte-based download progress and unavailable browser errors',async()=>{
 const {createLocalTranslator}=await import('../src/translation.js');
 const descriptors={Translator:Object.getOwnPropertyDescriptor(globalThis,'Translator'),isSecureContext:Object.getOwnPropertyDescriptor(globalThis,'isSecureContext')};
 try{
  Object.defineProperty(globalThis,'isSecureContext',{value:true,configurable:true});
  const progress=[];let options;
  const fake={translate:async s=>s,destroy(){}};
  Object.defineProperty(globalThis,'Translator',{value:{availability:async pair=>pair.sourceLanguage==='zh-Hant'?'unavailable':'available',create:async o=>{options=o;o.monitor({addEventListener(type,fn){fn({loaded:25,total:100});}});return fake;}},configurable:true});
  assert.equal(await createLocalTranslator({onProgress:t=>progress.push(t)}),fake);
  assert.equal(options.sourceLanguage,'zh');assert.equal(options.targetLanguage,'en');assert.ok(progress.some(t=>t.includes('25%')));
  Object.defineProperty(globalThis,'Translator',{value:undefined,configurable:true});
  await assert.rejects(createLocalTranslator(),/Edge/);
 }finally{
  for(const[key,descriptor]of Object.entries(descriptors)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 }
});
test('oversized model output is rejected before it can invalidate saved workspace fields',async()=>{
 await assert.rejects(translateDiscussion({translate:async()=> 'a'.repeat(1000001)},'中文'),/欄位容量/);
});
