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

import { textFromItems } from "../siemens_docstorage/pdf-layout.js";
test("document topic and current subject revision outrank historical review versions", () => {
  const r = classify(
    "範例工程公司 函\n受文者：範例顧問股份有限\n公司\n發文字號：S900\n發文日期：中華民國115年1月2日\n附件：系統切換計畫—示範甲站\n主旨：專案之系統切換計畫—示範甲\n站(E版)1式7份，詳如附件，敬請鑒核。Submit the System Switchover Plan — Hukou Station (E). Please review it.\n說明：依前次D版審查意見修訂。\n二、已確認審查意見D版。",
    "random.pdf",
  );
  assert.equal(r.topic_name, "系統切換計畫－示範甲站");
  assert.equal(r.topic, r.topic_name);
  assert.equal(r.version, "E");
  assert.equal(r.date, "2026-01-02");
  assert.equal(r.category, "提送文件");
  assert.notEqual(r.subject, "說明:");
  const old = classify(
    "主旨：系統切換計畫—示範甲站(D版)提送。\n說明：Please review it.",
    "d.pdf",
  );
  assert.equal(old.topic, r.topic);
  assert.equal(old.version, "D");
  const other = classify("主旨：系統切換計畫—示範乙站(E版)提送。", "other.pdf");
  assert.notEqual(other.topic, r.topic);
});
test("review is never read as revision iew, and historical body revision is not current", () => {
  const r = classify(
    "主旨：系統切換計畫—示範甲站，please review it.\n說明：前次 D版意見。",
    "x.pdf",
  );
  assert.equal(r.version, "");
  assert.equal(r.topic_name, "系統切換計畫－示範甲站");
  const d = classify(
    "文件編號：SIG-001\n版次：B\n主旨：設備技術文件提送",
    "x.pdf",
  );
  assert.equal(d.version, "B");
});
test("blank subject stops at another field instead of becoming 說明", () => {
  const r = classify(
    "文號：S999\n主旨：\n說明：前次意見\n附件：系統切換計畫—示範甲站",
    "file.pdf",
  );
  assert.notEqual(r.subject, "說明:");
  assert.equal(r.topic_name, "系統切換計畫－示範甲站");
});
test("PDF coordinate reading reconstructs shuffled stream items before extracting title", () => {
  const item = (str, x, y) => ({
    str,
    transform: [12, 0, 0, 12, x, y],
    width: str.length * 12,
  });
  const items = [
    item("說明：前次D版意見。", 40, 600),
    item("主旨：", 40, 700),
    item("站(E版)提送，please review it.", 40, 680),
    item("系統切換計畫—示範甲", 110, 700),
  ];
  const text = textFromItems(items);
  assert.ok(text.indexOf("主旨") < text.indexOf("說明"));
  const r = classify(text, "x.pdf");
  assert.equal(r.topic_name, "系統切換計畫－示範甲站");
  assert.equal(r.version, "E");
});
