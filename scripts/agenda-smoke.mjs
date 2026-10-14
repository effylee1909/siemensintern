import { chromium } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [],
  requests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (
    !r.url().startsWith("http://127.0.0.1:5173") &&
    !r.url().startsWith("blob:")
  )
    requests.push(r.url());
});
page.on("dialog", (d) => d.dismiss());
const esc = (s) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const p = (s) => `<a:p><a:r><a:t>${esc(s)}</a:t></a:r></a:p>`;
const cell = (s) =>
  `<a:tc><a:txBody>${s.split("\n").map(p).join("")}</a:txBody></a:tc>`;
const row = (r) => `<a:tr>${r.map(cell).join("")}</a:tr>`;
const slide = (topic, hidden = false, status = "進行中\nOpen") =>
  `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ${hidden ? 'show="0"' : ""}><p:cSld><p:spTree><p:sp><p:txBody>${p("第一階段：關鍵議題")}${p("Progress of Discussion on Key Issues")}</p:txBody></p:sp><p:graphicFrame><a:graphic><a:graphicData><a:tbl>${row(["項次\nItem", "辦理內容\nDescription", "負責人\nRequired by", "狀態\nStatus"])}${row(["1", topic + "\n須於 10/22 完成 4 項測試。\nPending completion of 4 tests by 22 Oct.", "測試團隊\nTesting team", status])}</a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`;
const fixture = zipSync({
  "ppt/slides/slide1.xml": strToU8(slide("設備測試\nEquipment testing")),
  "ppt/slides/slide2.xml": strToU8(
    slide("歷史資料\nHistorical information", true),
  ),
  "ppt/slides/slide3.xml": strToU8(
    slide("已結案議題\nClosed topic", false, "已關閉\nClosed"),
  ),
});
try {
  await page.goto("http://127.0.0.1:5173");
  await page.locator("#clear").click();
  await page.locator('dialog [name="date"]').fill("2026-09-09");
  await page.locator("dialog input[type=checkbox]").check();
  await page
    .getByRole("button", { name: "建立空白工作區", exact: true })
    .click();
  await page.getByRole("button", { name: "＋ 上傳會議 PPT" }).click();
  await page.locator("#file").setInputFiles({
    name: "bilingual.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(fixture),
  });
  await page.locator(".agenda-preview").waitFor();
  assert.equal(await page.locator(".agenda-preview article").count(), 3);
  assert.equal(
    await page.locator(".agenda-preview input[type=checkbox]:checked").count(),
    2,
  );
  assert.match(await page.locator("#agenda-count").innerText(), /已選 2/);
  await page.locator("#agenda-all").click();
  assert.match(await page.locator("#agenda-count").innerText(), /已選 3/);
  await page.locator("#agenda-visible").click();
  await page.locator("[name=include-2]").uncheck();
  assert.equal(await page.locator('[name="summaryEn-0"]').count(), 0);
  assert.equal(await page.locator('[name="ownerEn-0"]').count(), 0);
  assert.equal(
    await page.locator('[name="topicEn-0"]').inputValue(),
    "Equipment testing",
  );
  await page.screenshot({ path: "/tmp/agenda-preview.png", fullPage: true });
  await page
    .getByRole("button", { name: "確認建立紀錄 / Apply agenda" })
    .click();
  assert.equal(await page.locator(".issue").count(), 1);
  assert.match(await page.locator("[data-field=summaryEn]").inputValue(), /4 tests.*22 Oct/);
  assert.equal(await page.locator("[data-field=description]").inputValue(), "");
  assert.equal(
    await page.locator("[data-field=descriptionEn]").inputValue(),
    "",
  );
  assert.equal(
    await page.locator("[data-field=ownerEn]").inputValue(),
    "Testing team",
  );
  await page.locator("[data-field=description]").fill("已確認測試日期。");
  await page
    .locator("[data-field=descriptionEn]")
    .fill("The test date was confirmed.");
  await page.locator("[data-field=note]").fill("追蹤結果。");
  await page.locator("[data-field=noteEn]").fill("Follow up the results.");
  await page.locator("[data-field=topic]").fill("舊版較長敘述標題");
  await page.locator("[data-field=topicEn]").fill("An older narrative title");
  await page
    .getByRole("button", { name: "整理成會議紀錄 / Prepare minutes" })
    .click();
  await page.locator("[name=include-2]").uncheck();
  await page
    .getByRole("button", { name: "確認建立紀錄 / Apply agenda" })
    .click();
  assert.equal(await page.locator(".issue").count(), 1);
  assert.equal(
    await page.locator("[data-field=descriptionEn]").inputValue(),
    "The test date was confirmed.",
  );
  await page.screenshot({ path: "/tmp/bilingual-editor.png", fullPage: true });
  const result = await page.evaluate(async () => {
    const { exportDocx, readDocx } = await import("/src/office.js");
    const m = {
      title: "第 219 次週會",
      titleEn: "Weekly Meeting #219",
      number: 219,
      date: "2026-09-09",
      entries: [
        {
          issueId: "t",
          topic: "測試",
          topicEn: "Testing",
          summary: "4 項測試",
          summaryEn: "4 tests",
          description: "已确认",
          descriptionEn: "Confirmed",
          note: "請追蹤",
          noteEn: "Follow up",
          owner: "團隊",
          ownerEn: "Team",
          category: "第一階段",
          categoryEn: "Phase 1",
          status: "open",
          sourceFile: "bilingual.pptx",
          sourceSlides: [1],
        },
      ],
    };
    return readDocx(new File([exportDocx(m)], "test.docx"));
  });
  assert.equal(result[0].topicEn, "Testing");
  assert.equal(result[0].summaryEn, "4 tests");
  assert.equal(result[0].descriptionEn, "Confirmed");
  assert.equal(result[0].noteEn, "Follow up");
  assert.equal(result[0].ownerEn, "Team");
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "↓ 下載備份" }).click();
  const backup = await readFile(await (await event).path());
  const { unzipSync, strFromU8 } = await import("fflate");
  assert.equal(
    JSON.parse(strFromU8(unzipSync(backup)["workspace.json"])).format,
    "meeting-desk-backup",
  );
  await page.getByRole("button", { name: "開啟備份", exact: true }).click();
  await page.locator("#file").setInputFiles({
    name: "workspace.zip",
    mimeType: "application/zip",
    buffer: backup,
  });
  assert.equal(await page.locator("dialog input[type=password]").count(), 0);
  await page.locator("dialog input[type=checkbox]").check();
  await page.getByRole("button", { name: "開啟備份 / Open backup" }).click();
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  await page.waitForFunction(
    () =>
      document.querySelector("#save-state")?.textContent === "已儲存在此瀏覽器",
  );
  await page.reload();
  await page.locator("[data-field=descriptionEn]").waitFor();
  assert.equal(
    await page.locator("[data-field=descriptionEn]").inputValue(),
    "The test date was confirmed.",
  );
  await page.locator("#clear").click();
  await page.locator("dialog input[type=checkbox]").check();
  await page
    .getByRole("button", { name: "建立空白工作區", exact: true })
    .click();
  const five = zipSync(
    Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [
        `ppt/slides/slide${i + 1}.xml`,
        strToU8(
          `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:graphicFrame><a:graphic><a:graphicData><a:tbl>${row(["Topic", "Description"])}${row([`議題 ${i + 1}\nTopic ${i + 1}`, `內容 ${i + 1}\nContent ${i + 1}`])}</a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
        ),
      ]),
    ),
  );
  await page.getByRole("button", { name: "＋ 上傳會議 PPT" }).click();
  await page.locator("#file").setInputFiles({
    name: "five-topics.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(five),
  });
  await page.locator(".agenda-preview").waitFor();
  assert.equal(await page.locator(".agenda-preview article").count(), 5);
  assert.match(await page.locator("#agenda-count").innerText(), /已選 5/);
  await page
    .getByRole("button", { name: "確認建立紀錄 / Apply agenda" })
    .click();
  assert.equal(await page.locator(".issue").count(), 5);
  for (const field of [
    "owner",
    "ownerEn",
    "status",
    "description",
    "descriptionEn",
    "note",
    "noteEn",
  ])
    assert.equal(await page.locator(`[data-field=${field}]`).inputValue(), "");
  assert.equal(await page.locator('[data-field="category"]').count(), 0);
  assert.equal(await page.locator('[data-field="categoryEn"]').count(), 0);
  await page.waitForFunction(() => document.querySelector('#save-state')?.textContent === '已儲存在此瀏覽器');
  const categories = await page.evaluate(async () => {
    const {readWorkspace}=await import('/src/storage.js');
    const workspace=await readWorkspace();
    return workspace.state.meetings.find(m=>m.id===workspace.selectedId).entries.map(e=>[e.category,e.categoryEn]);
  });
  assert.ok(categories.every(([zh,en])=>zh==='' && en===''));
  const blankExport = await page.evaluate(async () => {
    const { exportDocx, readDocx } = await import("/src/office.js");
    const { unzipSync, strFromU8 } = await import(
      "/node_modules/fflate/esm/browser.js"
    );
    const file = exportDocx({
      title: "",
      date: "2026-10-12",
      entries: [
        {
          topic: "測試",
          description: "",
          note: "",
          owner: "",
          category: "",
          status: "",
        },
      ],
    });
    return {
      xml: strFromU8(unzipSync(file)["word/document.xml"]),
      row: (await readDocx(new File([file], "empty.docx")))[0],
    };
  });
  assert.ok(!blankExport.xml.includes("Not provided"));
  assert.equal(blankExport.row.owner, "");
  assert.equal(blankExport.row.category, "");
  assert.equal(blankExport.row.status, "");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: "/tmp/bilingual-mobile.png", fullPage: true });
  if (process.env.ATTACHMENTS_DIR) {
    for (const dir of await readdir(process.env.ATTACHMENTS_DIR)) {
      for (const name of await readdir(
        process.env.ATTACHMENTS_DIR + "/" + dir,
      )) {
        if (!name.endsWith(".pptx")) continue;
        const content = (
          await readFile(process.env.ATTACHMENTS_DIR + "/" + dir + "/" + name)
        ).toString("base64");
        const r = await page.evaluate(
          async ({ name, content }) => {
            const { readPptx } = await import("/src/office.js");
            const { prepareAgenda } = await import("/src/agenda.js");
            const slides = await readPptx(
              new File(
                [Uint8Array.from(atob(content), (c) => c.charCodeAt(0))],
                name,
              ),
            );
            const drafts = prepareAgenda(slides, "p", name);
            return {
              slides: slides.length,
              hidden: slides.filter((s) => s.hidden).length,
              drafts: drafts.length,
              selected: drafts.filter((d) => d.recommended).length,
              bilingual: drafts.filter((d) => d.summary && d.summaryEn).length,
              selectedMissingEnglish: drafts
                .filter((d) => d.recommended && !d.summaryEn)
                .map((d) => d.sourceSlides),
            };
          },
          { name, content },
        );
        assert.ok(r.selected > 0);
        assert.ok(r.bilingual > 0);
        assert.ok(r.hidden >= 20);
        console.log(name, JSON.stringify(r));
      }
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log(
    "PASS: PPT agenda preparation, bilingual preservation, hidden/closed exclusion, repeatable updates preserve notes, bilingual Word roundtrip, encrypted restore and mobile layout",
  );
} finally {
  await browser.close();
}
