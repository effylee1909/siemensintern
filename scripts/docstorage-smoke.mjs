import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1550, height: 1100 },
});
await context.addInitScript(() => {
  window.showDirectoryPicker = () => {
    throw Error("MUST NOT CALL DIRECTORY PICKER");
  };
});
const page = await context.newPage(),
  errors = [],
  external = [];
const base =
  process.env.DOCSTORAGE_URL ||
  "http://127.0.0.1:5195/siemensintern/siemens_docstorage/";
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (!r.url().startsWith(new URL(base).origin) && !r.url().startsWith("blob:"))
    external.push(r.url());
});
page.on("dialog", (d) => d.accept());
async function idle() {
  await page.waitForFunction(
    () =>
      document
        .querySelector("#progress-text")
        .textContent.startsWith("本批完成"),
    {},
    { timeout: 120000 },
  );
}
try {
  await page.goto(base);
  await page.waitForFunction(() =>
    document.querySelector("#space").textContent.includes("GB"),
  );
  assert.equal(await page.locator("#connect").count(), 0);
  assert.equal(await page.locator("#directory-help").count(), 0);
  await page.locator("#files").setInputFiles("/tmp/docstorage-letter.pdf");
  await idle();
  await page.locator("#rows tr").filter({ hasText: "P100" }).click();
  assert.equal(await page.locator("[name=category]").inputValue(), "審查意見");
  await page.locator("[name=customer]").fill("手動分類客戶");
  await page
    .getByRole("button", { name: "確認分類並保存", exact: true })
    .click();
  await page.getByRole("status").filter({ hasText: "分類已保存" }).waitFor();
  await page.getByRole("button", { name: "原檔與翻譯", exact: true }).click();
  const [raw] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("[data-download]").click(),
  ]);
  assert.deepEqual(
    await readFile(await raw.path()),
    await readFile("/tmp/docstorage-letter.pdf"),
  );
  await page
    .locator("#attachment")
    .setInputFiles("/tmp/docstorage-translation.docx");
  await page.waitForFunction(async () => {
    const db = await new Promise((r) => {
      const q = indexedDB.open("siemens_docstorage_browser_v2");
      q.onsuccess = () => r(q.result);
    });
    const c = await new Promise((r) => {
      const q = db.transaction("state").objectStore("state").get("workspace");
      q.onsuccess = () => r(q.result);
    });
    db.close();
    return (
      c.records[0].files.length === 2 &&
      c.records[0].files.every((f) => f.status === "done")
    );
  });
  await idle();
  await page.reload();
  await page.locator("#rows tr").filter({ hasText: "手動分類客戶" }).waitFor();
  assert.equal(await page.locator("#rows tr").count(), 1);
  const [backup] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#backup").click(),
  ]);
  const backupPath = await backup.path();
  await page
    .getByRole("status")
    .filter({ hasText: "完整備份已下載" })
    .waitFor();
  // Restores to a fresh browser, proving raw files/Word/text travel with the backup.
  const second = await browser.newContext();
  const restored = await second.newPage();
  restored.on("dialog", (d) => d.accept());
  await restored.goto(base);
  await restored.waitForFunction(() =>
    document.querySelector("#space").textContent.includes("GB"),
  );
  await restored.locator("#restore-file").setInputFiles(backupPath);
  await restored
    .getByRole("status")
    .filter({ hasText: "完整備份已還原" })
    .waitFor();
  await restored.locator("#rows tr").click();
  await restored
    .getByRole("button", { name: "原檔與翻譯", exact: true })
    .click();
  assert.equal(await restored.locator(".file-row").count(), 2);
  await restored
    .locator(".file-row")
    .filter({ hasText: "translation" })
    .getByRole("button", { name: "讀取文字" })
    .click();
  await restored
    .getByText("Existing translation P100", { exact: true })
    .waitFor();
  const [again] = await Promise.all([
    restored.waitForEvent("download"),
    restored
      .locator(".file-row")
      .first()
      .getByRole("button", { name: "下載", exact: true })
      .click(),
  ]);
  assert.deepEqual(
    await readFile(await again.path()),
    await readFile("/tmp/docstorage-letter.pdf"),
  );
  await second.close();
  // A denied write must rollback both the new file and its metadata.
  await page.evaluate(() => {
    window.realPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...a) {
      if (this.name === "files")
        throw new DOMException("disk full", "QuotaExceededError");
      return window.realPut.apply(this, a);
    };
  });
  await page.locator("#files").setInputFiles("/tmp/docstorage-letter.pdf");
  await page.locator("#storage-error:not([hidden])").waitFor();
  assert.match(await page.locator("#storage-error").innerText(), /空間不足/);
  assert.equal(await page.locator("#rows tr").count(), 1);
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = window.realPut;
  });
  await page.reload();
  await page.locator("#rows tr").waitFor();
  assert.equal(await page.locator("#rows tr").count(), 1);
  await page.locator("#files").setInputFiles("/tmp/docstorage-scan.pdf");
  await idle();
  assert.equal(await page.locator("#rows tr").count(), 2);
  await page.screenshot({
    path: "/workspace/docstorage-direct-upload.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "PASS direct upload without folder picker; PDF; Word; reload; complete ZIP restore across browsers; quota rollback; OCR; mobile; no external requests",
  );
} finally {
  await browser.close();
}
