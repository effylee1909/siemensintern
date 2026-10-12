import { validateState } from "./model.js";
const open = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open("meeting-desk", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("workspace");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(Error("瀏覽器無法開啟儲存空間，請下載備份"));
    req.onblocked = () => reject(Error("儲存空間被其他分頁占用"));
  });
export async function readWorkspace() {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("workspace", "readonly"),
        r = tx.objectStore("workspace").get("current");
      r.onsuccess = () => {
        try {
          if (
            r.result &&
            (!Number.isSafeInteger(r.result.revision) ||
              r.result.revision < 1 ||
              !r.result.state?.meetings?.length)
          )
            throw Error("本機儲存資料格式不正確，請開啟有效備份");
          resolve(
            r.result
              ? {
                  state: validateState(r.result.state),
                  revision: r.result.revision,
                  isDemo: !!r.result.isDemo,
                  selectedId: r.result.selectedId,
                }
              : null,
          );
        } catch (e) {
          reject(e);
        }
      };
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
export async function saveWorkspace(
  state,
  expectedRevision,
  isDemo = false,
  selectedId,
) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("workspace", "readwrite"),
        store = tx.objectStore("workspace"),
        r = store.get("current");
      let conflict = false;
      r.onsuccess = () => {
        if ((r.result?.revision || 0) !== expectedRevision) {
          conflict = true;
          tx.abort();
          return;
        }
        try {
          store.put(
            { state, revision: expectedRevision + 1, isDemo, selectedId },
            "current",
          );
        } catch {
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(expectedRevision + 1);
      tx.onabort = tx.onerror = () =>
        reject(
          Error(
            conflict
              ? "另一分頁已更新紀錄；請先下載本分頁備份，再重新開啟最新紀錄"
              : "自動儲存失敗（可能空間不足），請立即下載備份",
          ),
        );
    });
  } finally {
    db.close();
  }
}
export function plainBackup(state) {
  return JSON.stringify(
    { format: "meeting-desk-backup", version: 1, state },
    null,
    2,
  );
}
export function readPlainBackup(text) {
  const value = JSON.parse(text);
  if (value?.format !== "meeting-desk-backup" || value.version !== 1)
    throw Error("不是支援的一般備份檔");
  return validateState(value.state);
}
