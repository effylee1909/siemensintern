import { Zip, ZipPassThrough, unzipSync, strToU8, strFromU8 } from "fflate";
import { validateState } from "./model.js";
import {
  getAttachment,
  putAttachment,
  plainBackup,
  readPlainBackup,
} from "./storage.js";
const MAX_ARCHIVE = 2 * 1024 * 1024 * 1024;
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
            "完整備份超過 2 GB，請分批下載各場 PPT 原檔另存；會議資料仍保留在瀏覽器",
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
  const chunks = [];
  let failure;
  const zip = new Zip((err, data) => {
    if (err) failure = err;
    else chunks.push(data);
  });
  const metadata = new ZipPassThrough("workspace.json");
  zip.add(metadata);
  metadata.push(strToU8(plainBackup(clone)), true);
  for (const { path, blob } of files) {
    const entry = new ZipPassThrough(path);
    zip.add(entry);
    const reader = blob.stream().getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        entry.push(new Uint8Array(), true);
        break;
      }
      entry.push(value, false);
    }
    if (failure) throw failure;
  }
  zip.end();
  if (failure) throw failure;
  return {
    name: "zip",
    data: new Blob(chunks, { type: "application/zip" }),
    type: "application/zip",
  };
}
export async function restoreArchive(file) {
  if (file.size > MAX_ARCHIVE) throw Error("單次備份匯入上限為 2 GB");
  const data = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (f) => {
      if (f.compression !== 0)
        throw Error("請使用本網站產生的完整備份（不支援重新壓縮的 ZIP）");
      if (f.name === "workspace.json") {
        if (f.originalSize > 100 * 1024 * 1024) throw Error("會議資料過大");
        return true;
      }
      if (/^attachments\/\d{6}\.pptx$/.test(f.name)) {
        if (f.originalSize > 100 * 1024 * 1024)
          throw Error("備份包含超過 100 MB 的單一 PPT");
        return true;
      }
      return false;
    },
  });
  if (!data["workspace.json"]) throw Error("找不到會議備份資料");
  const state = readPlainBackup(strFromU8(data["workspace.json"]), true),
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
        const bytes = data[p.archivePath];
        if (
          !bytes ||
          bytes[0] !== 80 ||
          bytes[1] !== 75 ||
          p.size !== bytes.length
        )
          throw Error("備份中的 PPT 原檔缺失或損毀");
        files.push({
          p,
          blob: new Blob([bytes], {
            type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          }),
        });
        delete p.archivePath;
      }
    }
  validateState(state);
  for (const { p, blob } of files) {
    p.blobId = await putAttachment(blob);
    p.data = "";
  }
  return state;
}
