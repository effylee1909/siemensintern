import { validateState, uid, bytes } from "./model.js";
const open = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open("meeting-desk", 2);
    req.onupgradeneeded = () => {
      for (const name of ["workspace", "attachments"])
        if (!req.result.objectStoreNames.contains(name))
          req.result.createObjectStore(name);
    };
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
      const tx = db.transaction(["workspace", "attachments"], "readwrite"),
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
          const retained = new Set(
            state.meetings.flatMap((m) =>
              (m.presentations || []).map((p) => p.blobId).filter(Boolean),
            ),
          );
          for (const m of r.result?.state?.meetings || [])
            for (const p of m.presentations || [])
              if (p.blobId && !retained.has(p.blobId))
                tx.objectStore("attachments").delete(p.blobId);
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
export function readPlainBackup(text, allowArchiveReferences = false) {
  const value = JSON.parse(text);
  if (value?.format !== "meeting-desk-backup" || value.version !== 1)
    throw Error("不是支援的一般備份檔");
  const state = validateState(value.state);
  if (
    state.meetings.some((m) =>
      (m.presentations || []).some(
        (p) => p.blobId || (!allowArchiveReferences && p.archivePath),
      ),
    )
  )
    throw Error("此備份只有原檔參照，請使用包含 PPT 的完整 ZIP 備份");
  return state;
}

export async function putAttachment(file) {
  const id = uid(),
    db = await open();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("attachments", "readwrite");
      tx.objectStore("attachments").put(file, id);
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () =>
        reject(
          Error("原檔儲存失敗：瀏覽器可用空間不足或未允許儲存，請保留原始 PPT"),
        );
    });
    return id;
  } finally {
    db.close();
  }
}
export async function getAttachment(p) {
  if (!p.blobId) {
    return p.data
      ? new Blob([bytes(p.data)], {
          type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      : null;
  }
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("attachments", "readonly"),
        r = tx.objectStore("attachments").get(p.blobId);
      r.onsuccess = () =>
        r.result
          ? resolve(r.result)
          : reject(Error(`找不到原檔：${p.name}，請重新上傳或開啟完整備份`));
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
export async function migrateAttachments(state) {
  let changed = false;
  for (const m of state.meetings)
    for (const p of m.presentations || []) {
      if (p.data && !p.blobId) {
        const file = await getAttachment(p);
        p.blobId = await putAttachment(file);
        p.size = file.size;
        p.data = "";
        changed = true;
      }
    }
  return changed;
}
