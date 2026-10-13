import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:5173");
  const state = {
    version: 1,
    meetings: [
      {
        id: "scroll-meeting",
        number: 219,
        date: "2026-09-09",
        title: "第 219 次週會",
        entries: Array.from({ length: 14 }, (_, i) => ({
          issueId: `issue-${i}`,
          topic: `議題 ${i + 1}：需要討論與追蹤的較長議題名稱`,
          topicEn: `Topic ${i + 1}: A longer English agenda title for discussing and tracking progress`,
          summary: "本次需要確認的重點與後續作業安排。",
          summaryEn: "Confirm the key points and next actions.",
          description: "",
          descriptionEn: "",
          note: "",
          noteEn: "",
          owner: "",
          ownerEn: "",
          category: "",
          categoryEn: "",
          status: "open",
        })),
      },
    ],
  };
  await page.locator("#restore").click();
  await page
    .locator("#file")
    .setInputFiles({
      name: "scroll.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({ format: "meeting-desk-backup", version: 1, state }),
      ),
    });
  await page.locator("dialog input[type=checkbox]").check();
  await page.getByRole("button", { name: "開啟備份 / Open backup" }).click();
  await page
    .locator(".workbench")
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
  const start = await page.evaluate(() => ({
    page: scrollY,
    editor: document.querySelector(".editor").getBoundingClientRect().top,
    heading: document
      .querySelector(".issue-list .list-heading")
      .getBoundingClientRect().top,
  }));
  assert.ok(
    await page
      .locator(".issue-scroll")
      .evaluate((el) => el.scrollHeight > el.clientHeight),
  );
  await page.locator(".issue-scroll").hover();
  await page.mouse.wheel(0, 5000);
  await page.waitForFunction(
    () => document.querySelector(".issue-scroll").scrollTop > 0,
  );
  assert.equal(await page.evaluate(() => scrollY), start.page);
  assert.equal(
    await page
      .locator(".issue-list .list-heading")
      .evaluate((el) => el.getBoundingClientRect().top),
    start.heading,
  );
  const listPosition = await page
    .locator(".issue-scroll")
    .evaluate((el) => el.scrollTop);
  await page.locator('[data-entry="issue-13"]').click();
  assert.equal(
    await page.locator("[data-field=topic]").inputValue(),
    state.meetings[0].entries[13].topic,
  );
  assert.ok(
    Math.abs(
      (await page.locator(".issue-scroll").evaluate((el) => el.scrollTop)) -
        listPosition,
    ) < 2,
  );
  assert.equal(await page.evaluate(() => scrollY), start.page);
  assert.ok(
    Math.abs(
      (await page
        .locator(".editor")
        .evaluate((el) => el.getBoundingClientRect().top)) - start.editor,
    ) < 2,
  );
  await page.locator("[data-field=status]").selectOption("blocked");
  assert.ok(
    (await page.locator(".issue-scroll").evaluate((el) => el.scrollTop)) > 0,
  );
  await page.locator("#search").fill("議題 14");
  assert.equal(await page.locator(".issue").count(), 1);
  assert.equal(
    await page.locator(".issue-scroll").evaluate((el) => el.scrollTop),
    0,
  );
  await page.locator("#search").fill("");
  assert.equal(await page.locator(".issue").count(), 14);
  await page.screenshot({ path: "/tmp/issue-scroll-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.ok(
    await page
      .locator(".issue-scroll")
      .evaluate((el) => el.scrollHeight > el.clientHeight),
  );
  assert.ok(
    await page.locator(".issue-list").evaluate((el) => el.clientHeight <= 420),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: 14-topic independent scroll, heading/search remain visible, last topic selection preserves page/editor/list position, edits preserve scroll, search reset and mobile layout",
  );
} finally {
  await browser.close();
}
