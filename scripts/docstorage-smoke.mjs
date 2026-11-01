import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1550, height: 1100 } }),
  errors = [],
  external = [];
const base =
  process.env.DOCSTORAGE_URL ||
  "http://127.0.0.1:5185/siemensintern/siemens_docstorage/";
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (!r.url().startsWith(new URL(base).origin) && !r.url().startsWith("blob:"))
    external.push(r.url());
});
await page.addInitScript(() => {
  window.showDirectoryPicker = () => navigator.storage.getDirectory();
});
try {
  await page.goto(base);
  await page.getByRole("button", { name: "觀看虛構示範", exact: true }).click();
  assert.equal(await page.locator("#rows tr").count(), 4);
  assert.equal(
    await page.getByText("資料放在哪裡", { exact: true }).count(),
    0,
  );
  await page
    .getByRole("button", { name: "▱ 開啟文件資料夾", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll("#rows tr").length === 0,
  );
  await page.locator("#files").setInputFiles("/tmp/docstorage-letter.pdf");
  await page.waitForFunction(() =>
    document.querySelector("#progress-text").textContent.startsWith("本批完成"),
  );
  await page.locator("#rows tr").filter({ hasText: "P100" }).click();
  assert.equal(await page.locator("[name=category]").inputValue(), "審查意見");
  await page.locator("[name=customer]").fill("手動分類客戶");
  await page
    .getByRole("button", { name: "確認分類並保存", exact: true })
    .click();
  await page.getByRole("status").filter({ hasText: "分類已保存" }).waitFor();
  await page.getByRole("button", { name: "原檔與翻譯", exact: true }).click();
  await page
    .locator("#attachment")
    .setInputFiles("/tmp/docstorage-translation.docx");
  await page.waitForFunction(async () => {
    const d = await navigator.storage.getDirectory();
    const c = JSON.parse(
      await (
        await (
          await d.getFileHandle("siemens-docstorage-workspace.json")
        ).getFile()
      ).text(),
    );
    return (
      c.records[0]?.files.length === 2 &&
      c.records[0].files.every((f) => f.status === "done")
    );
  });
  await page.getByRole("button", { name: "分類與原文", exact: true }).click();
  await page.getByRole("button", { name: "原檔與翻譯", exact: true }).click();
  assert.equal(await page.locator(".file-row").count(), 2);
  await page
    .locator(".file-row")
    .filter({ hasText: "translation" })
    .getByRole("button", { name: "讀取文字" })
    .click();
  await page.getByText("Existing translation P100", { exact: true }).waitFor();
  await page.reload();
  await page
    .getByRole("button", { name: "▱ 開啟文件資料夾", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll("#rows tr").length === 1,
  );
  assert.match(await page.locator("#rows").innerText(), /手動分類客戶/);
  await page.locator("#files").setInputFiles("/tmp/docstorage-scan.pdf");
  await page.waitForFunction(
    async () => {
      const d = await navigator.storage.getDirectory();
      const c = JSON.parse(
        await (
          await (
            await d.getFileHandle("siemens-docstorage-workspace.json")
          ).getFile()
        ).text(),
      );
      return (
        c.records.length === 2 && c.records.every((r) => r.status === "done")
      );
    },
    {},
    { timeout: 120000 },
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector("#progress-text")
        .textContent.startsWith("本批完成"),
    {},
    { timeout: 120000 },
  );
  // Synthetic index tests actual 10,000-record pagination without uploading fabricated originals.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory(),
      handle = await root.getFileHandle("siemens-docstorage-workspace.json"),
      c = JSON.parse(await (await handle.getFile()).text());
    const template = c.records[0];
    for (let i = 0; i < 9998; i++)
      c.records.push({
        ...template,
        id: "synthetic-" + i,
        no: "TEST" + i,
        subject: "合成效能測試 " + i,
        files: [],
      });
    const w = await handle.createWritable();
    await w.write(JSON.stringify(c));
    await w.close();
  });
  await page
    .getByRole("button", { name: "▱ 開啟文件資料夾", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll("#rows tr").length === 30,
    {},
    { timeout: 5000 },
  );
  assert.match(await page.locator("#pages").innerText(), /334/);
  await page.locator("#search").fill("合成效能測試 9997");
  assert.equal(await page.locator("#rows tr").count(), 1);
  await page.locator("#search").fill("");
  await page.screenshot({
    path: "/workspace/docstorage-frontend-preview.png",
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
    "PASS folder writes, PDF classification, manual correction, Word attachment, reopening, scanned OCR, 10,000 record pagination/search, mobile, no external requests",
  );
} catch (e) {
  console.log(
    "DIAG",
    await page.locator("#toast").innerText(),
    await page.locator("#pages").innerText(),
    await page.locator("#progress-text").innerText(),
    errors,
  );
  throw e;
} finally {
  await browser.close();
}
