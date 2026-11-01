import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const b = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const p = await b.newPage();
  p.on("dialog", (d) => d.accept());
  await p.goto(
    process.env.DOCSTORAGE_URL ||
      "http://127.0.0.1:5205/siemensintern/siemens_docstorage/",
  );
  await p.waitForFunction(() =>
    document.querySelector("#space").textContent.includes("GB"),
  );
  await p.locator("[data-view=pending]").click();
  await p.locator("#files").setInputFiles("/tmp/docstorage-unlabelled.pdf");
  await p.waitForFunction(() =>
    document.querySelector("#progress-text").textContent.startsWith("本批完成"),
  );
  assert.equal(
    await p.locator("[data-view=all]").getAttribute("class"),
    "active",
  );
  assert.match(await p.locator("#rows").innerText(), /已自動分類 · 待核對/);
  assert.match(await p.locator("#rows .tag").innerText(), /審查意見/);
  await p.locator("[data-view=unclassified]").click();
  assert.equal(await p.locator("#rows tr").count(), 0);
  await p.locator("[data-view=pending]").click();
  assert.equal(await p.locator("#rows tr").count(), 1);
  await p.locator("#rows tr").click();
  assert.equal(await p.locator("[name=category]").inputValue(), "審查意見");
  await p.locator("#reclassify").click();
  await p.getByRole("status").filter({ hasText: "已自動分類" }).waitFor();
  await p.waitForFunction(() =>
    document.querySelector("#progress-text").textContent.startsWith("本批完成"),
  );
  assert.equal(await p.locator("[name=category]").inputValue(), "審查意見");
  await p.getByRole("button", { name: "確認分類並保存", exact: true }).click();
  await p.getByRole("status").filter({ hasText: "分類已保存" }).waitFor();
  assert.equal(await p.locator("#rows tr").count(), 0);
  await p.locator("[data-view=all]").click();
  assert.match(await p.locator("#rows").innerText(), /已人工確認/);
  console.log(
    "PASS body-based auto classification; upload returns overview; review differs from unclassified; retry; manual confirmation",
  );
} finally {
  await b.close();
}
