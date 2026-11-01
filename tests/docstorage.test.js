import test from "node:test";
import assert from "node:assert/strict";
import { classify, norm } from "../siemens_docstorage/storage.js";
test("local letter classification keeps references and ROC date without translating", () => {
  const m = classify(
    "發文單位：客戶 A\n受文者：西門子\n文號：P100\n發文日期：115年10月12日\n主旨：測試程序審查意見\n說明：復貴公司 S501 號函，請於文到七日內回覆。\n文件編號：SIG-001\n版次：B",
    "x.pdf",
  );
  assert.equal(m.category, "審查意見");
  assert.equal(m.no, "P100");
  assert.equal(m.date, "2026-10-12");
  assert.equal(m.customer, "客戶 A");
  assert.equal(m.topic, "SIG-001");
  assert.equal(m.references[0].no, "S501");
  assert.match(m.due, /七日/);
});
test("reply classification takes precedence over review keywords and references remain unconfirmed", () => {
  const m = classify(
    "文號：S530\n主旨：回覆審查意見並提送 Rev. B\n說明：復 P100 號函。\n依據 P100 號函。",
    "x.pdf",
  );
  assert.equal(m.category, "回覆補充");
  assert.equal(m.references.length, 1);
  assert.equal(m.references[0].status, "pending");
  assert.equal(norm("工字第115001號"), norm("工字115001號"));
});

import { validateCatalog, readBackup } from "../siemens_docstorage/backup.js";
import { createBlobZip } from "../siemens_docstorage/blob-zip.js";
function fixture() {
  return {
    format: "siemens-docstorage-browser",
    version: 1,
    records: [
      {
        id: "r1",
        subject: "測試",
        no: "P100",
        customer: "範例",
        category: "審查意見",
        kind: "公文",
        date: "",
        version: "",
        topic: "",
        due: "",
        references: [],
        files: [
          {
            id: "f1",
            name: "original.pdf",
            size: 3,
            role: "original",
            status: "done",
          },
        ],
      },
    ],
  };
}
test("backup validates unique records, unique originals and linked targets", () => {
  const c = fixture();
  assert.equal(validateCatalog(c), c);
  c.records.push(structuredClone(c.records[0]));
  assert.throws(() => validateCatalog(c), /重複/);
  const r = fixture();
  r.records[0].references = [
    { no: "S501", quote: "復S501", status: "confirmed", target: "missing" },
  ];
  assert.throws(() => validateCatalog(r), /不在備份/);
});
test("complete document archive restores originals and text, rejects missing or corrupted payloads", async () => {
  const c = fixture(),
    parts = [
      { name: "workspace.json", blob: new Blob([JSON.stringify(c)]) },
      { name: "files/f1", blob: new Blob(["abc"]) },
      {
        name: "text/f1.json",
        blob: new Blob([
          JSON.stringify([{ page: 1, text: "公文原文", method: "PDF" }]),
        ]),
      },
    ];
  const z = await createBlobZip(parts);
  const restored = await readBackup(z);
  assert.equal(await restored.files.get("f1").text(), "abc");
  assert.equal(restored.texts.get("f1")[0].text, "公文原文");
  const missing = await createBlobZip(parts.slice(0, 2));
  await assert.rejects(() => readBackup(missing), /缺少/);
  const bytes = new Uint8Array(await z.arrayBuffer());
  const at = Buffer.from(bytes).indexOf("abc");
  bytes[at] ^= 1;
  await assert.rejects(() => readBackup(new Blob([bytes])), /校驗/);
});

import {
  classificationState,
  applyClassification,
} from "../siemens_docstorage/classify.js";
test("OCR spaced headers, multiline subject and missing-colon fields are classified", () => {
  const r = classify(
    "範例客戶公司 函\n受 文 者 ： 西 門 子\n發 文 字 號 ： P100\n主 旨 ： 檢送測試程序\n審 查 意 見，請查照。\n說 明 ： 復貴公司 S501 號函。",
    "scan.pdf",
  );
  assert.equal(r.no, "P100");
  assert.equal(r.category, "審查意見");
  assert.equal(r.kind, "公文");
  assert.match(r.subject, /審查意見/);
  assert.equal(r.customer, "範例客戶公司");
  const bare = classify("主旨\n提送設備文件送審\n說明：請審核。", "x.pdf");
  assert.equal(bare.category, "提送文件");
});
test("body fallback classifies without filenames; unknown text is not invented as general correspondence", () => {
  const r = classify("檢送設備測試程序審查意見，請查照並辦理。", "random.pdf");
  assert.equal(r.category, "審查意見");
  assert.match(r.evidence, /內文/);
  const unknown = classify("Welcome to this document.", "random.pdf");
  assert.equal(unknown.category, "待分類");
  assert.equal(
    classificationState({ ...unknown, status: "done", confirmed: false }),
    "未能自動分類",
  );
  assert.equal(
    classificationState({ ...r, status: "done", confirmed: false }),
    "已自動分類 · 待核對",
  );
  assert.equal(classificationState({ ...r, status: "queued" }), "辨識中");
});
test("reclassification preserves previously confirmed links", () => {
  const r = {
    references: [
      { no: "S501", status: "confirmed", target: "old", quote: "人工確認" },
    ],
  };
  applyClassification(r, { references: [], category: "審查意見" });
  assert.equal(r.references[0].target, "old");
});
