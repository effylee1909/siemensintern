import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitLanguages,
  summarize,
  prepareAgenda,
  applyPreparedAgenda,
  presentationMetadata,
} from "../src/agenda.js";
const table = (desc, item = "1", status = "進行中\nOpen") => [
  [
    "項次\nItem",
    "辦理內容\nDescription",
    "負責人\nRequired by",
    "狀態\nStatus",
  ],
  [item, desc, "工程單位\nEngineering team", status],
];
test("language extraction preserves technical names, dates and Chinese letter references in English", () => {
  const text =
    "測試文件已於 2026/10/07 提交 CTC 審查。\nThe CTC document was submitted on 7 Oct 2026 with letter 字第115號.\n西門子SMO";
  const r = splitLanguages(text);
  assert.match(r.zh, /CTC/);
  assert.match(r.en, /7 Oct 2026/);
  assert.match(r.en, /字第115號/);
  assert.match(r.zh, /西門子/);
  assert.match(r.en, /SMO/);
});
test("extractive key points preserve original sentences, obligations and numbers", () => {
  const text =
    "初稿已完成。\n一般背景說明。\n另有歷史背景。\n須於 10/22 測試 4 個項目。\n尚待 IVV 審查，預計 3–5 週。";
  const s = summarize(text);
  assert.equal(s.split("\n").length, 3);
  assert.match(s, /10\/22.*4/);
  assert.match(s, /3–5/);
  for (const line of s.split("\n")) assert.ok(text.includes(line.slice(2)));
});
test("preparation keeps same item numbers in distinct stages separate and excludes only hidden pages by default", () => {
  const slides = [
    {
      number: 3,
      section: "第一階段\nPhase 1",
      tables: [table("測試程序\n待審查。\nTest procedure\nPending review.")],
      hidden: false,
    },
    {
      number: 4,
      section: "第二階段\nPhase 2",
      tables: [table("靜態測試\nStatic test")],
      hidden: false,
    },
    {
      number: 5,
      section: "第二階段\nPhase 2",
      tables: [table("歷史項目\nHistorical item", "2")],
      hidden: true,
    },
    {
      number: 6,
      section: "第二階段\nPhase 2",
      tables: [table("完成事項\nCompleted item", "3", "關閉\nClosed")],
      hidden: false,
    },
  ];
  const d = prepareAgenda(slides, "ppt", "meeting.pptx");
  assert.equal(d.length, 4);
  assert.deepEqual(
    d.map((x) => x.recommended),
    [true, true, false, true],
  );
  assert.equal(d[0].description, "");
  assert.equal(d[0].descriptionEn, "");
  assert.match(d[0].summaryEn, /Pending/);
  assert.equal(d[0].ownerEn, "Engineering team");
  assert.deepEqual(d[0].sourceSlides, [3]);
});
test("adjacent bilingual pages merge only complementary same stage items", () => {
  const d = prepareAgenda([
    {
      number: 3,
      section: "第一階段",
      tables: [table("事故報告\n須追蹤。", "7")],
    },
    {
      number: 4,
      section: "第一階段",
      tables: [table("Incident report\nFollow-up required.", "7")],
    },
    {
      number: 5,
      section: "第一階段",
      tables: [table("另一事故\nOther incident", "7")],
    },
  ]);
  assert.equal(d.length, 2);
  assert.deepEqual(d[0].sourceSlides, [3, 4]);
  assert.equal(d[0].topicEn, "Incident report");
  assert.match(d[0].summaryEn, /Follow-up/);
});
test("applying refreshed agenda preserves live bilingual minutes and is repeatable", () => {
  const meeting = {
    entries: [
      {
        issueId: "a",
        topic: "old",
        description: "現場討論",
        descriptionEn: "Live discussion",
        note: "既有備註",
        noteEn: "Existing note",
        status: "blocked",
        owner: "負責人",
        ownerEn: "Owner",
      },
    ],
  };
  const drafts = prepareAgenda(
    [{ number: 3, tables: [table("測試\nTest")] }],
    "p",
    "file.pptx",
  );
  applyPreparedAgenda(meeting, drafts, [{ index: 0, issueId: "a" }]);
  assert.equal(meeting.entries[0].descriptionEn, "Live discussion");
  assert.equal(meeting.entries[0].status, "blocked");
  assert.equal(meeting.entries[0].note, "既有備註");
  applyPreparedAgenda(meeting, drafts, [{ index: 0, issueId: "a" }]);
  assert.equal(meeting.entries.length, 1);
  const before = JSON.stringify(meeting);
  assert.throws(() =>
    applyPreparedAgenda(meeting, drafts, [
      { index: 0, issueId: "a" },
      { index: 0, issueId: "a" },
    ]),
  );
  assert.equal(JSON.stringify(meeting), before);
});

test("detect meeting numbers and ROC/English dates from covers", () => {
  assert.deepEqual(
    presentationMetadata([{ text: "115 年 10 月 7 日工程週會 (第 220 次)" }]),
    { number: 220, date: "2026-10-07" },
  );
  assert.deepEqual(
    presentationMetadata([{ text: "9 September 2026 Weekly Meeting #219" }]),
    { number: 219, date: "2026-09-09" },
  );
});

test("missing PPT fields stay blank and repeated titles do not merge distinct rows", () => {
  const table = [
    ["議題 / Topic", "辦理內容 / Description"],
    ["相同標題\nSame topic", "第一項內容\nFirst item"],
    ["相同標題\nSame topic", "第二項內容\nSecond item"],
  ];
  const d = prepareAgenda([{ number: 1, tables: [table] }]);
  assert.equal(d.length, 2);
  for (const e of d) {
    for (const k of [
      "owner",
      "ownerEn",
      "category",
      "categoryEn",
      "status",
      "description",
      "descriptionEn",
      "note",
      "noteEn",
    ])
      assert.equal(e[k], "");
  }
  assert.match(d[1].summaryEn, /Second item/);
});
