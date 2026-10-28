import { chromium } from "@playwright/test";
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import { writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const hash = (b) => createHash("sha256").update(b).digest("hex");
const xml = (number, date) =>
  `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${date}工程週會(第${number}次)</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
const body =
  '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>設備測試</a:t></a:r></a:p><a:p><a:r><a:t>Equipment testing</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>';
const files = [219, 220].map((n, i) =>
  zipSync(
    {
      "ppt/slides/slide1.xml": strToU8(xml(n, `115年10月${i + 1}日`)),
      "ppt/slides/slide2.xml": strToU8(body),
      "ppt/media/padding.bin": new Uint8Array(26 * 1024 * 1024).fill(i + 1),
    },
    { level: 0 },
  ),
);
await Promise.all(files.map((f, i) => writeFile(`/tmp/capacity-${i}.pptx`, f)));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const saved = (p) =>
  p.waitForFunction(
    () =>
      document.querySelector("#save-state")?.textContent === "已儲存在此瀏覽器",
  );
try {
  await page.goto("http://127.0.0.1:5173/#meeting");
  await page.locator("#import-history").click();
  await page
    .getByRole("button", { name: "開始選取 PPT / Choose files" })
    .click();
  await page
    .locator("#file")
    .setInputFiles(["/tmp/capacity-0.pptx", "/tmp/capacity-1.pptx"]);
  await page
    .getByRole("heading", { name: "歷次 PPT 上傳結果 / Import results" })
    .waitFor();
  assert.equal(await page.locator(".meeting").count(), 2);
  assert.ok(!(await page.locator("dialog").innerText()).includes("儲存失敗"));
  await page.locator("#close-modal").click();
  await saved(page);
  await page.reload();
  assert.equal(await page.locator(".slide-panel").count(), 0);
  const state = await page.evaluate(async () => {
    const { readWorkspace } = await import("/src/storage.js");
    return (await readWorkspace()).state;
  });
  assert.equal(state.meetings.length, 2);
  assert.ok(
    state.meetings.every(
      (m) => m.presentations[0].blobId && m.presentations[0].data === "",
    ),
  );
  assert.ok(
    state.meetings.reduce((n, m) => n + m.presentations[0].size, 0) >
      40 * 1024 * 1024,
  );
  const d = page.waitForEvent("download");
  await page.getByRole("button", { name: "下載原檔" }).click();
  assert.equal(hash(await readFile(await (await d).path())), hash(files[1]));
  const backupEvent = page.waitForEvent("download");
  await page.locator("#backup").click();
  const backup = await backupEvent,
    backupPath = await backup.path();
  assert.ok(backup.suggestedFilename().endsWith(".zip"));
  const bytes = await readFile(backupPath),
    archive = unzipSync(bytes),
    metadata = JSON.parse(strFromU8(archive["workspace.json"]));
  assert.equal(
    hash(archive[metadata.state.meetings[0].presentations[0].archivePath]),
    hash(files[0]),
  );
  assert.ok(
    metadata.state.meetings.every(
      (m) => !m.presentations[0].blobId && m.presentations[0].data === "",
    ),
  );
  const context = await browser.newContext(),
    p2 = await context.newPage();
  await p2.goto("http://127.0.0.1:5173/#meeting");
  await p2.locator("#restore").click();
  await writeFile("/tmp/capacity-full.zip", bytes);
  await p2.locator("#file").setInputFiles("/tmp/capacity-full.zip");
  await p2.locator("dialog input[type=checkbox]").check();
  await p2.getByRole("button", { name: "開啟備份 / Open backup" }).click();
  await p2.waitForFunction(() => !document.querySelector("dialog[open]"));
  await saved(p2);
  await p2.reload();
  assert.equal(await p2.locator(".meeting").count(), 2);
  const d2 = p2.waitForEvent("download");
  await p2.getByRole("button", { name: "下載原檔" }).click();
  assert.equal(hash(await readFile(await (await d2).path())), hash(files[1]));
  await p2.getByRole("button", { name: "移除", exact: true }).click();
  await p2.getByRole("button", { name: "確認移除簡報" }).click();
  await saved(p2);
  assert.equal(
    await p2.evaluate(async () => {
      const { readWorkspace } = await import("/src/storage.js");
      return (await readWorkspace()).state.meetings.at(-1).presentations.length;
    }),
    0,
  );
  await context.close();
  const legacyContext = await browser.newContext(),
    p3 = await legacyContext.newPage();
  await p3.route("**/seed", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html></html>" }),
  );
  await p3.goto("http://127.0.0.1:5173/seed");
  const legacy = {
    version: 1,
    meetings: [
      {
        id: "legacy",
        number: 219,
        title: "第 219 次週會",
        date: "2026-10-01",
        entries: [],
        presentations: [
          {
            id: "old-inline",
            name: "old.pptx",
            data: Buffer.from(files[0]).toString("base64"),
            slides: [{ number: 1, text: "Legacy content" }],
          },
        ],
      },
    ],
  };
  await p3.evaluate(
    (state) =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("meeting-desk", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("workspace");
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("workspace", "readwrite");
          tx.objectStore("workspace").put(
            { state, revision: 7, isDemo: false },
            "current",
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    legacy,
  );
  await p3.goto("http://127.0.0.1:5173/#meeting");
  await p3.waitForFunction(async () => {
    const { readWorkspace } = await import("/src/storage.js");
    const p = (await readWorkspace()).state.meetings[0].presentations[0];
    return !!p.blobId && p.data === "";
  });
  await saved(p3);
  const migrated = await p3.evaluate(async () => {
    const { readWorkspace } = await import("/src/storage.js");
    return (await readWorkspace()).state.meetings[0].presentations[0];
  });
  assert.equal(migrated.data, "");
  assert.ok(migrated.blobId);
  const oldFile = p3.waitForEvent("download");
  await p3.getByRole("button", { name: "下載原檔" }).click();
  assert.equal(
    hash(await readFile(await (await oldFile).path())),
    hash(files[0]),
  );
  await legacyContext.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: two 26 MB PPT files retained (>40 MB total), independent original blobs, reload, byte-exact ZIP backup and restore, attachment removal, legacy inline-file migration, no bottom text panel",
  );
} finally {
  await browser.close();
}
