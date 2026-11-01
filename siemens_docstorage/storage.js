let db;
export let ready = false;
export let catalog = { version: 1, id: "", revision: 0, records: [] };
export let committed = [];
const pendingFiles = new Map(),
  pendingText = new Map();
let chain = Promise.resolve();
function request(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function completion(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error("儲存未完成"));
    tx.onerror = () => {};
  });
}
export async function open() {
  if (db) db.close();
  const r = indexedDB.open("siemens_docstorage_browser_v2", 1);
  r.onupgradeneeded = () => {
    for (const s of ["state", "files", "text"]) r.result.createObjectStore(s);
  };
  r.onblocked = () => {};
  db = await request(r);
  db.onversionchange = () => {
    db.close();
    ready = false;
  };
  const tx = db.transaction("state", "readwrite"),
    done = completion(tx),
    store = tx.objectStore("state");
  const get = store.get("workspace");
  let loaded;
  get.onsuccess = () => {
    loaded = get.result;
    if (!loaded) {
      loaded = {
        version: 1,
        id: crypto.randomUUID(),
        revision: 0,
        records: [],
      };
      store.put(loaded, "workspace");
    }
  };
  await done;
  catalog = loaded;
  committed = structuredClone(catalog.records);
  ready = true;
  return catalog;
}
export function save() {
  const task = async () => {
    if (!ready) throw Error("瀏覽器儲存尚未就緒，請重新整理");
    const snapshot = structuredClone({
      ...catalog,
      revision: catalog.revision + 1,
    });
    const files = new Map(pendingFiles),
      texts = new Map(pendingText);
    const tx = db.transaction(["state", "files", "text"], "readwrite"),
      done = completion(tx);
    let conflict = false,
      failure;
    const r = tx.objectStore("state").get("workspace");
    r.onsuccess = () => {
      try {
        if (r.result.revision !== catalog.revision) {
          conflict = true;
          tx.abort();
          return;
        }
        tx.objectStore("state").put(snapshot, "workspace");
        for (const [id, blob] of files) tx.objectStore("files").put(blob, id);
        for (const [id, pages] of texts) tx.objectStore("text").put(pages, id);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    try {
      await done;
    } catch (e) {
      if (conflict) throw Error("另一分頁已更新資料，請重新整理後再操作");
      throw failure || e;
    }
    catalog.revision = snapshot.revision;
    committed = snapshot.records;
    for (const [id, blob] of files)
      if (pendingFiles.get(id) === blob) pendingFiles.delete(id);
    for (const [id, pages] of texts)
      if (pendingText.get(id) === pages) pendingText.delete(id);
  };
  const result = chain.then(task);
  chain = result.catch(() => {});
  return result;
}
export function rollback() {
  catalog.records = structuredClone(committed);
  pendingFiles.clear();
  pendingText.clear();
}
export async function putFile(file, id) {
  pendingFiles.set(id, file);
}
export async function getFile(id) {
  const file =
    pendingFiles.get(id) ||
    (await request(db.transaction("files").objectStore("files").get(id)));
  if (!file) throw Error("找不到原檔，請從完整備份還原");
  return file;
}
export async function putText(id, pages) {
  pendingText.set(id, pages);
}
export async function getText(id) {
  return (
    pendingText.get(id) ||
    (await request(db.transaction("text").objectStore("text").get(id))) ||
    []
  );
}
export async function readRevision() {
  return (
    await request(db.transaction("state").objectStore("state").get("workspace"))
  ).revision;
}
export async function restoreAll(next, files, texts) {
  if (!ready) throw Error("儲存尚未就緒");
  const tx = db.transaction(["state", "files", "text"], "readwrite"),
    done = completion(tx);
  let conflict = false,
    failure;
  const r = tx.objectStore("state").get("workspace");
  let saved;
  r.onsuccess = () => {
    try {
      if (r.result.revision !== catalog.revision) {
        conflict = true;
        tx.abort();
        return;
      }
      saved = {
        version: 1,
        id: catalog.id,
        revision: catalog.revision + 1,
        records: next.records,
      };
      tx.objectStore("state").put(saved, "workspace");
      tx.objectStore("files").clear();
      tx.objectStore("text").clear();
      for (const [id, blob] of files) tx.objectStore("files").put(blob, id);
      for (const [id, pages] of texts) tx.objectStore("text").put(pages, id);
    } catch (error) {
      failure = error;
      tx.abort();
    }
  };
  try {
    await done;
  } catch (e) {
    if (conflict) throw Error("另一分頁已更新資料，請重新整理");
    throw failure || e;
  }
  catalog = saved;
  committed = structuredClone(saved.records);
  pendingFiles.clear();
  pendingText.clear();
}

export { norm, classify } from "./classify.js";
