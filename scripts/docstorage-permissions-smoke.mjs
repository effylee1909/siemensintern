import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const base =
  process.env.DOCSTORAGE_URL ||
  "http://127.0.0.1:5185/siemensintern/siemens_docstorage/";
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.pickerCalls = 0;
    window.showDirectoryPicker = () => {
      window.pickerCalls++;
      throw new DOMException(
        "The request is not allowed by the user agent or platform in the current context.",
        "SecurityError",
      );
    };
  });
  const page = await context.newPage();
  await page.goto(base);
  await page.locator("#connect").click();
  await page.locator("#directory-help:not([hidden])").waitFor();
  assert.match(
    await page.locator("#directory-help").innerText(),
    /尚未讀取或匯入文件/,
  );
  assert.equal(await page.evaluate(() => window.pickerCalls), 1);
  assert.equal(
    await page.locator("#directory-help a").getAttribute("target"),
    "_blank",
  );
  assert.equal(await page.locator("#rows tr").count(), 0);
  const embedded = await context.newPage();
  await embedded.setContent(
    `<iframe src="${base}" style="width:100%;height:700px"></iframe>`,
  );
  const frame = embedded.frameLocator("iframe");
  await frame.locator("#connect").click();
  await frame.locator("#directory-help:not([hidden])").waitFor();
  assert.match(await frame.locator("#directory-help").innerText(), /內嵌/);
  assert.equal(
    await embedded.frames()[1].evaluate(() => window.pickerCalls),
    0,
  );
  await context.close();
  const valid = await browser.newContext();
  await valid.addInitScript(() => {
    window.showDirectoryPicker = () => navigator.storage.getDirectory();
  });
  const p = await valid.newPage();
  await p.goto(base);
  await p.locator("#connect").click();
  await p.getByRole("status").filter({ hasText: "已開啟工作區" }).waitFor();
  assert.equal(await p.locator("#directory-help").isVisible(), false);
  await valid.close();
  const cancelled = await browser.newContext();
  await cancelled.addInitScript(() => {
    window.showDirectoryPicker = () => {
      throw new DOMException("Cancelled", "AbortError");
    };
  });
  const c = await cancelled.newPage();
  await c.goto(base);
  await c.locator("#connect").click();
  assert.equal(await c.locator("#directory-help").isVisible(), false);
  await cancelled.close();
  console.log(
    "PASS permission rejection guidance; iframe preflight; valid folder access; silent cancellation",
  );
} finally {
  await browser.close();
}
