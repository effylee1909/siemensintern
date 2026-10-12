import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [],
  external = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (
    !r.url().startsWith("http://127.0.0.1:5173") &&
    !r.url().startsWith("blob:")
  )
    external.push(r.url());
});
page.on("dialog", (d) => d.dismiss());
try {
  await page.goto("http://127.0.0.1:5173");
  assert.equal(await page.locator(".issue").count(), 0);
  await page.getByRole("button", { name: "觀看示範 / View demo" }).click();
  await page.getByRole("heading", { name: "第 220 次週會" }).waitFor();
  assert.equal(await page.locator(".issue").count(), 3);
  await page.screenshot({
    path: "/tmp/meeting-desk-desktop.png",
    fullPage: true,
  });
  await page
    .locator('[data-field="description"]')
    .fill("本次測試決議 <script>alert(1)</script>");
  await page.getByRole("button", { name: "＋ 建立下次會議" }).first().click();
  await page.locator('dialog input[name="title"]').fill("第 221 次週會");
  await page.getByRole("button", { name: "建立並帶入議題" }).click();
  assert.equal(await page.locator(".issue").count(), 2);
  assert.equal(
    await page.locator('[data-field="description"]').inputValue(),
    "",
  );
  assert.match(
    await page.locator(".previous-text").innerText(),
    /本次測試決議/,
  );
  assert.equal(await page.locator("script:not([src])").count(), 0);
  await page.locator('[data-field="status"]').selectOption("blocked");
  assert.match(await page.locator(".editor-top .badge").innerText(), /待協調/);
  await page
    .getByRole("button", { name: "✎ 編輯會議名稱、次數與日期" })
    .click();
  await page.locator('dialog [name="number"]').fill("219");
  await page.getByRole("button", { name: "儲存會議資料" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "此會議次數已存在" })
    .waitFor();
  await page.locator('dialog [name="number"]').fill("221");
  await page.locator('dialog [name="date"]').fill("2026-10-15");
  await page.getByRole("button", { name: "儲存會議資料" }).click();
  assert.equal(await page.locator(".date-tag").innerText(), "2026-10-15");
  const pptBytes = await page.evaluate(async () => {
    const { zipSync, strToU8 } = await import(
      "/node_modules/fflate/esm/browser.js"
    );
    return Array.from(
      zipSync({
        "ppt/slides/slide1.xml": strToU8(
          '<a:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>本次簡報測試</a:t></a:r></a:p></a:sld>',
        ),
        "ppt/slides/slide2.xml": strToU8(
          '<a:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>第二頁</a:t></a:r></a:p></a:sld>',
        ),
      }),
    );
  });
  await page.getByRole("button", { name: "＋ 上傳會議 PPT" }).click();
  await page.locator("#file").setInputFiles({
    name: "meeting-221.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(pptBytes),
  });
  await page.locator(".attachment").waitFor();
  assert.match(
    await page.locator(".slide-panel pre").innerText(),
    /本次簡報測試/,
  );
  await page.locator("#slide-next").click();
  assert.equal(await page.locator(".slide-panel pre").innerText(), "第二頁");
  await page.locator("[data-meeting]").last().click();
  assert.equal(await page.locator(".attachment").count(), 0);
  await page.locator("[data-meeting]").first().click();
  assert.equal(await page.locator(".attachment").count(), 1);
  const pptDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下載原檔" }).click();
  assert.deepEqual(
    await readFile(await (await pptDownload).path()),
    Buffer.from(pptBytes),
  );
  await page.getByRole("button", { name: "＋ 新增議題", exact: true }).click();
  await page
    .getByRole("textbox", { name: "議題名稱", exact: true })
    .fill("直接在網站新增的議題");
  await page
    .getByRole("textbox", { name: "本次討論" })
    .fill("現場直接記錄決議");
  assert.equal(await page.locator(".issue").count(), 3);
  await page.getByRole("button", { name: "↓ 加密備份" }).click();
  await page.locator('[name="password"]').fill("meeting smoke password");
  await page.locator('[name="confirm"]').fill("meeting smoke password");
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "加密並下載" }).click();
  const download = await event;
  const encrypted = await readFile(await download.path(), "utf8");
  assert.ok(!encrypted.includes("本次測試決議"));
  await page.getByRole("button", { name: "開啟備份", exact: true }).click();
  await page.locator("#file").setInputFiles({
    name: "test.meeting",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(encrypted),
  });
  await page.locator('[name="password"]').fill("wrong");
  await page.locator('dialog input[type="checkbox"]').check();
  await page.getByRole("button", { name: "解密並開啟" }).click();
  await page.getByRole("alert").filter({ hasText: "密碼錯誤" }).waitFor();
  await page.locator('[name="password"]').fill("meeting smoke password");
  await page.getByRole("button", { name: "解密並開啟" }).click();
  await page.getByRole("heading", { name: "第 221 次週會" }).waitFor();
  assert.equal(await page.locator(".issue").count(), 3);
  assert.equal(await page.locator(".attachment").count(), 1);
  assert.equal(await page.locator(".date-tag").innerText(), "2026-10-15");
  const roundtrip = await page.evaluate(async () => {
    const { exportDocx, readDocx } = await import("/src/office.js");
    const m = {
      title: "測試",
      date: "2026-10-14",
      entries: [
        {
          topic: "測試 <特殊字元>",
          description: "第一行\n第二行",
          note: "",
          owner: "工程師",
          status: "closed",
        },
      ],
    };
    const entries = await readDocx(new File([exportDocx(m)], "test.docx"));
    return entries;
  });
  assert.equal(roundtrip[0].status, "closed");
  assert.equal(roundtrip[0].description, "第一行\n第二行");
  assert.equal(roundtrip[0].topic, "測試 <特殊字元>");

  const fixture = await page.evaluate(async () => {
    const { exportDocx } = await import("/src/office.js");
    return Array.from(
      exportDocx({
        title: "test",
        date: "2026-09-09",
        entries: [
          {
            topic: "匯入測試議題",
            description: "待處理事項",
            note: "",
            owner: "測試人員",
            status: "open",
          },
          {
            topic: "已完成測試議題",
            description: "完成",
            note: "",
            owner: "測試人員",
            status: "closed",
          },
        ],
      }),
    );
  });
  await page.getByRole("button", { name: "清除工作區" }).click();
  await page.locator('dialog input[name="date"]').fill("2026-09-09");
  await page.locator('dialog input[type="checkbox"]').check();
  await page
    .getByRole("button", { name: "建立空白工作區", exact: true })
    .click();
  await page.getByRole("button", { name: "↑ 匯入 Word" }).click();
  await page.locator("#file").setInputFiles({
    name: "fixture.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(fixture),
  });
  await page.getByRole("button", { name: "確認匯入 2 個議題" }).click();
  assert.equal(await page.locator(".issue").count(), 2);
  await page.getByRole("button", { name: "＋ 建立下次會議" }).first().click();
  await page.locator('dialog input[name="carry"]').uncheck();
  await page.getByRole("button", { name: "建立並帶入議題" }).click();
  assert.equal(await page.locator(".issue").count(), 0);
  await page.getByRole("button", { name: "↑ 匯入 Word" }).click();
  await page.locator("#file").setInputFiles({
    name: "fixture.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(fixture),
  });
  assert.ok(await page.locator('select[name="link-0"]').inputValue());
  await page.getByRole("button", { name: "確認匯入 2 個議題" }).click();
  assert.match(await page.locator(".previous-text").innerText(), /待處理事項/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "/tmp/meeting-desk-mobile.png",
    fullPage: true,
  });
  if (process.env.ATTACHMENTS_DIR) {
    for (const dir of await readdir(process.env.ATTACHMENTS_DIR)) {
      const root = process.env.ATTACHMENTS_DIR + "/" + dir;
      for (const name of await readdir(root)) {
        if (!/\.(docx|pptx)$/.test(name)) continue;
        const content = (await readFile(root + "/" + name)).toString("base64");
        const result = await page.evaluate(
          async ({ name, content }) => {
            const o = await import("/src/office.js");
            const file = new File(
              [Uint8Array.from(atob(content), (c) => c.charCodeAt(0))],
              name,
            );
            try {
              const items = await (name.endsWith(".docx")
                ? o.readDocx(file)
                : o.readPptx(file));
              return {
                count: items.length,
                closed: items.filter((x) => x.status === "closed").length,
              };
            } catch (e) {
              return { error: e.message };
            }
          },
          { name, content },
        );
        if (name.includes("template")) assert.match(result.error, /空白範本/);
        else assert.ok(result.count > 0);
        console.log(name, JSON.stringify(result));
      }
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "PASS: carryover, editing, encrypted backup/restore, invalid password, DOCX roundtrip, mobile layout, no external requests or browser errors",
  );
} finally {
  await browser.close();
}
