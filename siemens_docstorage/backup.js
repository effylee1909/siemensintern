import * as store from "./storage.js";
import { createBlobZip, readBlobZip, verifyZipEntry } from "./blob-zip.js";
const validId = (id) =>
  typeof id === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(id);
export function validateCatalog(c) {
  if (
    c.format !== "siemens-docstorage-browser" ||
    c.version !== 1 ||
    !Array.isArray(c.records) ||
    c.records.length > 100000
  )
    throw Error("不是此版本的完整文件備份（上限十萬筆）");
  const ids = new Set(),
    files = new Set();
  for (const r of c.records) {
    if (
      !validId(r.id) ||
      ids.has(r.id) ||
      !Array.isArray(r.files) ||
      !Array.isArray(r.references) ||
      r.files.length > 1000
    )
      throw Error("備份含重複編號或不完整紀錄");
    ids.add(r.id);
    for (const key of [
      "subject",
      "no",
      "customer",
      "category",
      "kind",
      "date",
      "version",
      "topic",
      "due",
    ])
      if (typeof r[key] !== "string" || r[key].length > 10000)
        throw Error("備份欄位格式不正確");
    for (const ref of r.references)
      if (
        !ref ||
        typeof ref.no !== "string" ||
        typeof ref.quote !== "string" ||
        !["pending", "confirmed", "dismissed"].includes(ref.status) ||
        typeof ref.target !== "string"
      )
        throw Error("引用資料格式不正確");
    for (const f of r.files) {
      if (
        !validId(f.id) ||
        files.has(f.id) ||
        typeof f.name !== "string" ||
        !Number.isFinite(f.size) ||
        f.size < 0 ||
        f.size > 100 * 1024 * 1024 ||
        !["original", "translation", "attachment"].includes(f.role) ||
        !["queued", "done", "error"].includes(f.status)
      )
        throw Error("原檔資訊不正確");
      files.add(f.id);
    }
  }
  for (const r of c.records)
    for (const ref of r.references)
      if (ref.target && !ids.has(ref.target))
        throw Error("引用的文件不在備份內");
  return c;
}
export async function backup(progress = () => {}) {
  const revision = store.catalog.revision,
    records = structuredClone(store.catalog.records);
  const c = validateCatalog({
    format: "siemens-docstorage-browser",
    version: 1,
    records,
  });
  if (
    records.reduce(
      (sum, r) => sum + r.files.reduce((n, f) => n + f.size, 0),
      0,
    ) >
    20 * 1024 ** 3
  )
    throw Error("原檔總量超過單次完整備份 20 GB 上限");
  const files = [
    {
      name: "workspace.json",
      blob: new Blob([JSON.stringify(c)], { type: "application/json" }),
    },
  ];
  for (const r of records)
    for (const f of r.files) {
      progress(f.name);
      files.push({ name: "files/" + f.id, blob: await store.getFile(f.id) });
      files.push({
        name: "text/" + f.id + ".json",
        blob: new Blob([JSON.stringify(await store.getText(f.id))]),
      });
    }
  const zip = await createBlobZip(files);
  if (zip.size > 20 * 1024 ** 3) throw Error("完整備份超過 20 GB 上限，未下載");
  if ((await store.readRevision()) !== revision)
    throw Error("備份期間資料已更新，請重試");
  return zip;
}
export async function readBackup(file) {
  if (file.size > 20 * 1024 ** 3)
    throw Error("單次備份上限 20 GB，且仍受瀏覽器空間限制");
  const entries = await readBlobZip(file),
    manifest = entries.get("workspace.json");
  if (!manifest || manifest.blob.size > 50 * 1024 * 1024)
    throw Error("缺少工作區索引或索引過大");
  const c = validateCatalog(
    JSON.parse(await (await verifyZipEntry(manifest)).text()),
  );
  const files = new Map(),
    texts = new Map();
  for (const r of c.records)
    for (const f of r.files) {
      const raw = entries.get("files/" + f.id),
        text = entries.get("text/" + f.id + ".json");
      if (!raw || !text || raw.blob.size !== f.size)
        throw Error("備份缺少原檔或辨識文字");
      files.set(f.id, await verifyZipEntry(raw));
      const pages = JSON.parse(await (await verifyZipEntry(text)).text());
      if (
        !Array.isArray(pages) ||
        pages.some(
          (p) =>
            !Number.isInteger(p.page) ||
            typeof p.text !== "string" ||
            typeof p.method !== "string",
        )
      )
        throw Error("辨識文字格式錯誤");
      texts.set(f.id, pages);
    }
  return { catalog: c, files, texts };
}
