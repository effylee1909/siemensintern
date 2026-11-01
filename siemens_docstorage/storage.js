const NAME = "siemens-docstorage-workspace.json";
export let folder = null,
  catalog = { version: 1, id: "", revision: 0, records: [] };
let chain = Promise.resolve();
async function read(name) {
  return JSON.parse(
    await (await folder.getFileHandle(name)).getFile().then((f) => f.text()),
  );
}
async function write(handle, data) {
  const w = await handle.createWritable();
  try {
    await w.write(data);
    await w.close();
  } catch (e) {
    await w.abort().catch(() => {});
    throw e;
  }
}
export async function connect(handle) {
  folder = handle;
  try {
    const c = await read(NAME);
    if (c.version !== 1 || !Array.isArray(c.records) || !c.id)
      throw Error("工作區格式不正確");
    catalog = c;
  } catch (e) {
    if (e.name !== "NotFoundError") {
      folder = null;
      throw e;
    }
    catalog = { version: 1, id: crypto.randomUUID(), revision: 0, records: [] };
    await write(
      await folder.getFileHandle(NAME, { create: true }),
      JSON.stringify(catalog),
    );
  }
  return catalog;
}
export function save() {
  const task = () =>
    navigator.locks.request("docstorage-" + catalog.id, async () => {
      const disk = await read(NAME);
      if (disk.revision !== catalog.revision)
        throw Error("另一分頁已更新工作區，請重新開啟資料夾，避免覆寫");
      const revision = catalog.revision + 1;
      await write(
        await folder.getFileHandle(NAME),
        JSON.stringify({ ...catalog, revision }),
      );
      catalog.revision = revision;
    });
  const promise = chain.then(task);
  chain = promise.catch(() => {});
  return promise;
}
export async function putFile(file, id) {
  const dir = await folder.getDirectoryHandle("originals", { create: true });
  await write(await dir.getFileHandle(id, { create: true }), file);
}
export async function getFile(id) {
  const dir = await folder.getDirectoryHandle("originals");
  return (await dir.getFileHandle(id)).getFile();
}
export async function putText(id, pages) {
  const dir = await folder.getDirectoryHandle("text", { create: true });
  await write(
    await dir.getFileHandle(id + ".json", { create: true }),
    JSON.stringify(pages),
  );
}
export async function getText(id) {
  try {
    const dir = await folder.getDirectoryHandle("text");
    return JSON.parse(
      await (await dir.getFileHandle(id + ".json"))
        .getFile()
        .then((f) => f.text()),
    );
  } catch (e) {
    if (e.name === "NotFoundError") return [];
    throw e;
  }
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
