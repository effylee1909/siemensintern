import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const context = await browser.newContext(),
  page = await context.newPage();
page.on("dialog", (d) => d.dismiss());
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const saved = (p) =>
  p.waitForFunction(
    () =>
      document.querySelector("#save-state")?.textContent === "已儲存在此瀏覽器",
  );
try {
  await page.goto("http://127.0.0.1:5173");
  await page.locator("#load-demo").click();
  await page.locator("[data-field=description]").fill("沒有密碼的紀錄");
  await saved(page);
  await page.reload();
  assert.equal(
    await page.locator("[data-field=description]").inputValue(),
    "沒有密碼的紀錄",
  );
  assert.equal(await page.locator("input[type=password]").count(), 0);
  const download = page.waitForEvent("download");
  await page.locator("#backup").click();
  const json = await readFile(await (await download).path(), "utf8");
  const backup = JSON.parse(json);
  assert.equal(backup.state.meetings.length, 2);
  assert.ok(json.includes("沒有密碼的紀錄"));
  const other = await browser.newContext(),
    p2 = await other.newPage();
  await p2.goto("http://127.0.0.1:5173");
  await p2.locator("#restore").click();
  await p2.locator("#file").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(json),
  });
  assert.equal(await p2.locator("dialog input[type=password]").count(), 0);
  await p2.locator("dialog input[type=checkbox]").check();
  await p2.getByRole("button", { name: "開啟備份 / Open backup" }).click();
  await saved(p2);
  await p2.reload();
  assert.equal(
    await p2.locator("[data-field=description]").inputValue(),
    "沒有密碼的紀錄",
  );
  await other.close();
  const tab = await context.newPage();
  tab.on("dialog", (d) => d.dismiss());
  await tab.goto("http://127.0.0.1:5173");
  await page.locator("[data-field=description]").fill("主分頁更新");
  await saved(page);
  await tab.locator("[data-field=description]").fill("另一分頁不能覆寫");
  await tab.waitForFunction(() =>
    document.querySelector("#save-state")?.textContent.includes("未儲存"),
  );
  const stored = await page.evaluate(async () => {
    const { readWorkspace } = await import("/src/storage.js");
    return (await readWorkspace()).state.meetings.at(-1).entries[0].description;
  });
  assert.equal(stored, "主分頁更新");
  await tab.close();
  const legacy = await page.evaluate(async (state) => {
    const { encryptBackup } = await import("/src/model.js");
    return encryptBackup(state, "legacy backup password");
  }, backup.state);
  await page.locator("#restore").click();
  await page.locator("#file").setInputFiles({
    name: "old.meeting",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(legacy),
  });
  await page
    .locator("dialog input[type=password]")
    .fill("legacy backup password");
  await page.locator("dialog input[type=checkbox]").check();
  await page.getByRole("button", { name: "解密並開啟" }).click();
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  await saved(page);
  assert.equal(
    await page.locator("[data-field=description]").inputValue(),
    "沒有密碼的紀錄",
  );
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await page.locator("[data-field=description]").fill("儲存失敗也可下載");
  await page.waitForFunction(() =>
    document.querySelector("#save-state")?.textContent.includes("未儲存"),
  );
  const d = page.waitForEvent("download");
  await page.locator("#backup").click();
  assert.ok(
    (await readFile(await (await d).path(), "utf8")).includes(
      "儲存失敗也可下載",
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: password-free backup, autosave/reload, import in another browser, concurrent-tab protection, legacy encrypted migration, save failure warning and export",
  );
} finally {
  await browser.close();
}
