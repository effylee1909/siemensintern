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
export const norm = (s) =>
  String(s || "")
    .normalize("NFKC")
    .replace(/[\s字第號：:－-]/g, "")
    .toUpperCase();
export function classify(text, name) {
  const field = (label) =>
    text
      .match(
        new RegExp("(?:^|\\n)\\s*(?:" + label + ")\\s*[:：]\\s*([^\\n]+)", "i"),
      )?.[1]
      ?.trim() || "";
  const subject = field("主旨|Subject|Title") || name.replace(/\.[^.]+$/, "");
  const no = field("發文字號|文號|Letter No\\.?|Reference");
  const sender = field("發文單位|發文者|From");
  const recipient = field("受文者|收文單位|To");
  const doc = field("文件編號|Document No\\.?");
  const category = /回覆|補充|回復|response|reply/i.test(subject)
    ? "回覆補充"
    : /審查意見|review comments/i.test(subject)
      ? "審查意見"
      : /提送|送審|submit/i.test(subject)
        ? "提送文件"
        : !no && doc
          ? "技術文件"
          : "一般往來";
  const references = [];
  for (const line of text.split("\n"))
    if (/復|依據|依貴|回覆|回復|reference|reply/i.test(line))
      for (const m of line.matchAll(
        /(?:[\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9（）()-]{0,25}字\s*第?\s*\d{3,18}\s*號|\b[A-Z]{1,8}-?\d{3,12}\b)/gi,
      ))
        if (
          norm(m[0]) !== norm(no) &&
          !references.some((r) => norm(r.no) === norm(m[0]))
        )
          references.push({
            no: m[0],
            quote: line,
            status: "pending",
            target: "",
          });
  const dateRaw = field("發文日期|日期|Date");
  let date = "";
  const d = dateRaw.match(/(\d{2,4})[年/.-]\s*(\d{1,2})[月/.-]\s*(\d{1,2})/);
  if (d) {
    let y = +d[1];
    if (y < 1911) y += 1911;
    date = `${y}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}`;
  }
  return {
    subject,
    no,
    customer: /西門子|siemens/i.test(sender) ? recipient : sender,
    category,
    kind: no || /主旨[:：]/.test(text) ? "公文" : doc ? "技術文件" : "待分類",
    date,
    version:
      field("版次|Revision|Rev\\.?") ||
      text.match(/Rev\.?\s*([A-Z0-9.]+)/i)?.[1] ||
      "",
    topic: doc,
    references,
    evidence: `依文件欄位及主旨關鍵詞分類為「${category}」。本機規則判斷，尚未經人工確認。`,
    due:
      text
        .split("\n")
        .find((l) => /期限|文到|截止|deadline|within|請於.*回覆/.test(l)) || "",
  };
}
