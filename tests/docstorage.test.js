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
