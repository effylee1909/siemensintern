import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const p = await browser.newPage({ viewport: { width: 1550, height: 1100 } });
  await p.goto(
    process.env.DOCSTORAGE_URL ||
      "http://127.0.0.1:5215/siemensintern/siemens_docstorage/",
  );
  await p.waitForFunction(() =>
    document.querySelector("#space").textContent.includes("GB"),
  );
  await p.locator("#files").setInputFiles("/tmp/docstorage-topic.pdf");
  await p.waitForFunction(() =>
    document.querySelector("#progress-text").textContent.startsWith("本批完成"),
  );
  assert.match(await p.locator("#rows").innerText(), /系統切換計畫－示範甲站/);
  await p.locator("#rows tr").click();
  assert.equal(
    await p.locator("[name=topic_name]").inputValue(),
    "系統切換計畫－示範甲站",
  );
  assert.equal(await p.locator("[name=version]").inputValue(), "E");
  assert.equal(await p.locator("[name=date]").inputValue(), "2026-01-02");
  assert.equal(await p.locator("[name=category]").inputValue(), "提送文件");
  assert.match(
    await p.locator("[name=subject]").inputValue(),
    /System Switchover/,
  );
  assert.notEqual(await p.locator("[name=subject]").inputValue(), "說明:");
  await p.locator("#topic-filter").selectOption("系統切換計畫－示範甲站");
  assert.equal(await p.locator("#rows tr").count(), 1);
  await p.screenshot({
    path: "/workspace/docstorage-topic-preview.png",
    fullPage: true,
  });
  await p.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  console.log(
    "PASS shuffled PDF reading order; content topic; current E vs previous D; review not version; topic filter; mobile",
  );
} finally {
  await browser.close();
}
