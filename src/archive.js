import { createBlobZip, readBlobZip, verifyZipEntry } from "./blob-zip.js";
import { validateState } from "./model.js";
import {
  getAttachment,
  putAttachment,
  plainBackup,
  readPlainBackup,
} from "./storage.js";
export const MAX_ARCHIVE = 20 * 1024 * 1024 * 1024;
export async function backupArchive(state) {
  const clone = structuredClone(state),
    files = [];
  let total = 0;
  for (const m of clone.meetings)
    for (const p of m.presentations || []) {
      const blob = await getAttachment(p);
      if (blob) {
        total += blob.size;
        if (total > MAX_ARCHIVE - 100 * 1024 * 1024)
          throw Error(
            "完整備份超過 20 GB，請分批下載各場 PPT 原檔另存；會議資料仍保留在瀏覽器",
          );
        const path = `attachments/${String(files.length + 1).padStart(6, "0")}.pptx`;
        files.push({ path, blob });
        p.archivePath = path;
        p.size = blob.size;
        p.data = "";
        delete p.blobId;
      }
    }
  if (!files.length)
    return { name: "json", data: plainBackup(clone), type: "application/json" };
  const metadata = new Blob([plainBackup(clone)]);
  if (metadata.size > 100 * 1024 * 1024) throw Error("會議文字資料超過 100 MB 備份限制");
  const data = await createBlobZip([
    { name: "workspace.json", blob: metadata },
    ...files.map(({ path, blob }) => ({ name: path, blob })),
  ]);
  return { name: "zip", data, type: "application/zip" };
}
export async function restoreArchive(file) {
  if (file.size > MAX_ARCHIVE) throw Error("單次備份匯入上限為 20 GB");
  const data = await readBlobZip(file);
  if (!data.has("workspace.json")) throw Error("找不到會議備份資料");
  const metadata = await verifyZipEntry(data.get("workspace.json"));
  const state = readPlainBackup(await metadata.text(), true),
    files = [],
    seen = new Set();
  for (const m of state.meetings)
    for (const p of m.presentations || []) {
      if (p.blobId) throw Error("備份原檔必須完整封裝");
      if (p.archivePath !== undefined) {
        if (
          typeof p.archivePath !== "string" ||
          !/^attachments\/\d{6}\.pptx$/.test(p.archivePath) ||
          seen.has(p.archivePath)
        )
          throw Error("原檔路徑格式不正確");
        seen.add(p.archivePath);
        const entry = data.get(p.archivePath);
        if (!entry || p.size !== entry.blob.size) throw Error("備份中的 PPT 原檔缺失或損毀");
        const header = new Uint8Array(await entry.blob.slice(0, 2).arrayBuffer());
        if (header[0] !== 80 || header[1] !== 75) throw Error("PPT 原檔格式不正確");
        files.push({ p, entry });
        delete p.archivePath;
      }
    }
  validateState(state);
  for (const { p, entry } of files) {
    p.blobId = await putAttachment(await verifyZipEntry(entry));
    p.data = "";
  }
  return state;
}
