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

import {
  directoryContextIssue,
  directoryPickerError,
} from "../siemens_docstorage/directory-access.js";
test("folder access explains embedded, insecure, unsupported and missing gesture contexts", () => {
  const good = { secure: true, topLevel: true, supported: true, active: true };
  assert.equal(directoryContextIssue(good), "");
  assert.match(directoryContextIssue({ ...good, topLevel: false }), /內嵌/);
  assert.match(directoryContextIssue({ ...good, secure: false }), /HTTPS/);
  assert.match(directoryContextIssue({ ...good, supported: false }), /Chrome/);
  assert.match(directoryContextIssue({ ...good, active: false }), /直接點擊/);
});
test("folder rejection provides persistent actionable guidance without treating cancellation as a failure", () => {
  for (const name of ["SecurityError", "NotAllowedError"])
    assert.match(directoryPickerError({ name }), /尚未讀取或匯入文件/);
  assert.equal(directoryPickerError({ name: "AbortError" }), "");
});
