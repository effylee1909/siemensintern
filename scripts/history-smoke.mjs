import { chromium } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.dismiss());
function file(number, date) {
  const text = `${date.replace(/-/g, "/")}\n${Number(date.slice(0, 4)) - 1911}年${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日工程週會(第${number}次)\nWeekly Meeting #${number}`;
  return {
    name: `meeting-${number}.pptx`,
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(
      zipSync({
        "ppt/slides/slide1.xml": strToU8(
          `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>${text
            .split("\n")
            .map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`)
            .join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
        ),
      }),
    ),
  };
}
try {
  await page.goto("http://127.0.0.1:5173/#meeting");
  await page.getByRole("button", { name: "觀看示範 / View demo" }).click();
  await page.locator("#add-history").click();
  await page.locator("dialog [name=number]").fill("218");
  await page.locator("dialog [name=date]").fill("2026-09-02");
  await page
    .getByRole("button", { name: "新增會議 / Add meeting", exact: true })
    .click();
  assert.equal(await page.locator(".meeting").count(), 3);
  assert.match(await page.locator("h1").innerText(), /218/);
  assert.deepEqual(
    await page
      .locator(".meeting")
      .evaluateAll((es) =>
        es.map((e) => e.innerText.match(/第\s*(\d+)\s*次/)[1]),
      ),
    ["220", "219", "218"],
  );
  await page.locator("#import-history").click();
  await page
    .getByRole("button", { name: "開始選取 PPT / Choose files" })
    .click();
  await page
    .locator("#file")
    .setInputFiles([file(217, "2026-08-26"), file(216, "2026-08-19")]);
  await page
    .getByRole("heading", { name: "歷次 PPT 上傳結果 / Import results" })
    .waitFor();
  await page.locator("#close-modal").click();
  assert.deepEqual(
    await page
      .locator(".meeting")
      .evaluateAll((es) =>
        es.map((e) => e.innerText.match(/第\s*(\d+)\s*次/)[1]),
      ),
    ["220", "219", "218", "217", "216"],
  );
  assert.equal(await page.locator(".attachment").count(), 1);
  await page.locator("#edit-meeting").click();
  await page.locator("dialog [name=date]").fill("2026-08-12");
  await page.getByRole("button", { name: "儲存會議資料" }).click();
  assert.equal(await page.locator(".date-tag").innerText(), "2026-08-12");
  await page.locator("#add-history").click();
  await page.locator("dialog [name=number]").fill("219");
  await page
    .getByRole("button", { name: "新增會議 / Add meeting", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "此會議次數已存在" })
    .waitFor();
  await page.locator("#close-modal").click();
  await page.locator("#import-history").click();
  await page.locator("[name=textOnly]").check();
  await page
    .getByRole("button", { name: "開始選取 PPT / Choose files" })
    .click();
  const files = Array.from({ length: 25 }, (_, i) =>
    file(i + 1, `2026-01-${String(i + 1).padStart(2, "0")}`),
  );
  await page.locator("#file").setInputFiles(files);
  await page
    .getByRole("heading", { name: "歷次 PPT 上傳結果 / Import results" })
    .waitFor();
  await page.locator("#close-modal").click();
  assert.equal(await page.locator(".meeting").count(), 30);
  assert.equal(await page.locator("[data-download-ppt]").count(), 0);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector(".sidebar nav").scrollTop = 0;
  });
  await page.locator(".sidebar nav").hover();
  await page.mouse.wheel(0, 600);
  await page.waitForFunction(
    () => document.querySelector(".sidebar nav").scrollTop > 0,
  );
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  assert.ok(
    await page
      .locator(".sidebar nav")
      .evaluate((n) => n.scrollHeight > n.clientHeight),
  );
  await page.getByRole("button", { name: "＋ 新增議題", exact: true }).click();
  const style = await page
    .locator("[data-field=description]")
    .evaluate((el) => ({
      size: parseFloat(getComputedStyle(el).fontSize),
      color: getComputedStyle(el).color,
    }));
  assert.ok(style.size >= 15);
  assert.equal(style.color, "rgb(32, 54, 71)");
  await page.screenshot({
    path: "/tmp/history-meetings-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.ok(
    await page
      .locator(".sidebar nav")
      .evaluate((n) => n.scrollWidth > n.clientWidth),
  );
  await page.screenshot({
    path: "/tmp/history-meetings-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: add 218 after 219, batch import older PPTs, edit historical dates, duplicate protection, 30-meeting independent scroll, legible fields, mobile bar",
  );
} finally {
  await browser.close();
}
