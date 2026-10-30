import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const origin = process.env.DOCSTORAGE_URL || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const a = await browser.newContext({ viewport: { width: 1440, height: 1050 } }),
  b = await browser.newContext();
const page = await a.newPage(),
  other = await b.newPage();
const errors = [],
  external = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (!r.url().startsWith(origin) && !r.url().startsWith("blob:"))
    external.push(r.url());
});
try {
  await page.goto(origin);
  await page.getByRole("button", { name: "先看虛構範例", exact: true }).click();
  await page.locator("#stat-total").filter({ hasText: "4" }).waitFor();
  await page.waitForFunction(
    () => document.querySelector("#stat-jobs").textContent === "0",
  );
  assert.equal(
    await page.locator(".stats").evaluate((e) => getComputedStyle(e).display),
    "grid",
  );
  await page.locator("#search").fill("P100");
  await page.locator("#rows tr").filter({ hasText: "P100" }).waitFor();
  await page.locator("#rows tr").filter({ hasText: "P100" }).click();
  await page.locator("#record-form").waitFor();
  assert.equal(await page.locator("[name=category]").inputValue(), "審查意見");
  await page.locator("[name=customer]").fill("手動測試客戶");
  await page
    .getByRole("button", { name: "確認分類並保存", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "已核對並保存分類" })
    .waitFor();
  await other.goto(origin);
  await other.locator("#search").fill("手動測試客戶");
  await other.locator("#rows tr").filter({ hasText: "P100" }).waitFor();
  await page.getByRole("button", { name: "往來歷程", exact: true }).click();
  assert.equal(await page.locator(".timeline-card").count(), 4);
  const reference = page.locator(".reference").filter({ hasText: "S501" });
  await reference.locator("select").selectOption({ index: 1 });
  await reference
    .getByRole("button", { name: "確認關聯", exact: true })
    .click();
  await reference.locator(".confirmed").waitFor();
  await page.getByRole("button", { name: "原檔與翻譯", exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "下載原檔", exact: true }).click(),
  ]);
  assert.equal(download.suggestedFilename(), "P100.pdf");
  await page
    .getByRole("button", { name: "＋ 補上翻譯／附件", exact: true })
    .click();
  const python =
    process.env.PYTHON_BIN || "/workspace/.venvs/docstorage/bin/python";
  const word = execFileSync(python, [
    "-c",
    `import io,zipfile,sys\nb=io.BytesIO()\nwith zipfile.ZipFile(b,'w') as z:z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Existing approved translation P100</w:t></w:r></w:p></w:body></w:document>')\nsys.stdout.buffer.write(b.getvalue())`,
  ]);
  await page
    .locator("input[name=files]")
    .setInputFiles({
      name: "P100-English.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: word,
    });
  await page.getByRole("button", { name: "上傳並辨識", exact: true }).click();
  await page.locator("#upload-dialog").waitFor({ state: "hidden" });
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "↻ 更新", exact: true }).click();
  await page.getByRole("button", { name: "原檔與翻譯", exact: true }).click();
  assert.equal(await page.locator(".file-row").count(), 2);
  await page.getByRole("button", { name: "辨識文字", exact: true }).click();
  await page
    .getByText("Existing approved translation P100", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "往來歷程", exact: true }).click();
  await page.screenshot({
    path: "/tmp/docstorage-platform-timeline.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "✕ 關閉", exact: true }).click();
  await page.locator("#search").fill("");
  await page.locator("#rows tr").nth(3).waitFor();
  await page.screenshot({
    path: "/tmp/docstorage-platform-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/docstorage-platform-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "PASS shared backend between browsers; sample classification; manual correction; confirmed link; full timeline; original download; translation upload/extraction; responsive layout; no external requests",
  );
} finally {
  await browser.close();
}
