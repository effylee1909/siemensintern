import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {exportDocx} from '../src/office.js';
test('template-style Word export fits landscape page, repeats table header, and preserves bilingual text',()=>{
 const meeting={title:'Synthetic meeting',titleEn:'Example',date:'2026-10-14',number:12,entries:[{topic:'設備測試',topicEn:'Equipment test',summary:'簡報內容',summaryEn:'Slide content',description:'討論 & 決議',descriptionEn:'Discussion <decision>',note:'備註',noteEn:'Note',owner:'測試團隊',ownerEn:'Test team',status:'open'}]};
 const before=structuredClone(meeting);const parts=unzipSync(exportDocx(meeting)),xml=strFromU8(parts['word/document.xml']);
 const widths=[...xml.matchAll(/<w:gridCol w:w="(\d+)"/g)].map(m=>Number(m[1]));
 assert.equal(widths.length,5);assert.equal(widths.reduce((a,b)=>a+b),15840-2*720);assert.ok(widths[2]>widths[1]*2);
 assert.match(xml,/<w:tblHeader\/>/);assert.match(xml,/<w:tblLayout w:type="fixed"/);assert.match(xml,/w:orient="landscape"/);
 assert.match(xml,/w:eastAsia="KaiTi"/);assert.match(xml,/討論 &amp; 決議/);assert.match(xml,/Discussion &lt;decision&gt;/);
 assert.ok(parts['word/footer1.xml']);assert.match(strFromU8(parts['word/_rels/document.xml.rels']),/footer1.xml/);
 assert.deepEqual(meeting,before);
});
