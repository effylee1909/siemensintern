import * as store from "./storage.js";
import { classificationState, applyClassification } from "./classify.js";
import { backup, readBackup } from "./backup.js";
import { extract } from "./extract.js";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const categories = [
  "提送文件",
  "審查意見",
  "回覆補充",
  "一般往來",
  "技術文件",
  "待分類",
];
let records = [],
  selected = "",
  view = "all",
  page = 1,
  query = "",
  customer = "",
  category = "",
  topicFilter = "",
  tab = "info",
  running = false,
  importing = false,
  paused = false,
  progress = "",
  done = 0,
  total = 0,
  demo = false,
  dirty = false,
  busyBackup = false;
const bytes = (n) =>
  n < 1048576
    ? `${(n / 1024).toFixed(0)} KB`
    : `${(n / 1048576).toFixed(1)} MB`;
function toast(t) {
  $("#toast").textContent = t;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").textContent = ""), 7000);
}
function safe(fn) {
  return async (e) => {
    if (e?.type === "submit") e.preventDefault();
    try {
      await fn(e);
    } catch (error) {
      if (error.name !== "AbortError") toast(error.message);
    }
  };
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function persist() {
  if (demo) return;
  try {
    await store.save();
    await updateSpace();
  } catch (error) {
    store.rollback();
    records = store.catalog.records;
    render();
    showStorageError(error);
    throw error;
  }
}
function requireStorage() {
  if (demo) throw Error("目前是示範模式，請先按「返回我的文件」再上傳。");
  if (!store.ready)
    throw Error("瀏覽器儲存尚未就緒，請重新整理，或在獨立分頁開啟本站。");
  if (busyBackup) throw Error("備份作業進行中，請稍後");
}
function showStorageError(error) {
  const box = $("#storage-error");
  box.hidden = false;
  box.textContent =
    error.name === "QuotaExceededError"
      ? "瀏覽器儲存空間不足，本次變更未保存。請先下載完整備份，勿清除網站資料。"
      : `本次變更未保存：${error.message}。請先下載備份，再重新整理。`;
}
async function updateSpace() {
  try {
    const e = await navigator.storage?.estimate();
    if (e?.quota)
      $("#space").textContent =
        `瀏覽器已用 ${(e.usage / 1024 ** 3).toFixed(2)} / ${(e.quota / 1024 ** 3).toFixed(1)} GB（同網站共用）`;
  } catch {}
}
$("#app").innerHTML =
  `<aside><a class="brand" href="./"><b>▥</b><span>文件整理平台<small>siemens_docstorage</small></span></a><div class="nav-label">DOCUMENT WORKSPACE</div><nav>${[
    ["all", "▤", "總覽"],
    ["letters", "⇄", "收發公文"],
    ["technical", "▱", "技術文件"],
    ["pending", "◇", "待人工核對"],
    ["unclassified", "?", "未能自動分類"],
    ["timeline", "◷", "往來歷程"],
    ["import", "▥", "匯入與備份"],
  ]
    .map(
      ([v, i, n]) =>
        `<button data-view="${v}" class="${v === "all" ? "active" : ""}">${i}<span>${n}</span></button>`,
    )
    .join(
      "",
    )}</nav><div class="nav-label">工作區</div><button id="demo" class="nav-button">觀看虛構示範</button><button id="backup" class="nav-button">下載完整備份</button><button id="restore" class="nav-button">還原完整備份</button><input id="restore-file" type="file" accept=".zip" hidden><div class="sidebar-note"><span class="dot"></span><span id="storage-state">保存在此瀏覽器</span><p>單人維護 · 瀏覽器本機處理</p><small>原檔與整理資料不傳到 GitHub</small></div></aside><main><header><div><div class="eyebrow">DOCUMENT WORKSPACE</div><h1>文件總覽</h1><p>集中整理公文與技術文件，追蹤每次往來。</p></div><div class="top-actions"><button id="my-documents" hidden>返回我的文件</button><button id="keep-storage">申請持續保存</button><button id="upload" class="primary">＋ 上傳文件</button><input id="files" type="file" accept=".pdf,.docx" hidden></div></header><p class="support-note" id="support">直接選取 PDF 或 Word，無需資料夾授權。文件僅保存在此瀏覽器，不會上傳 GitHub；清除網站資料可能遺失文件，請定期下載完整備份。</p><div id="storage-error" class="directory-help" role="alert" hidden></div><p id="space" class="muted"></p><section class="stats"><article><span>收發公文</span><strong id="letters-count">0</strong><small>原文與翻譯集中管理</small></article><article><span>技術文件</span><strong id="technical-count">0</strong><small>以議題整理版本歷程</small></article><article><span>待人工核對</span><strong id="pending-count">0</strong><small>包含已自動分類、尚未人工確認的文件</small></article><article><span>匯入進度</span><strong id="import-count">0 / 0</strong><small>本機文字擷取與掃描 OCR</small></article></section><div class="split"><section class="library"><div class="library-title"><h2 id="view-title">文件清單</h2><span id="result-count"></span></div><div class="filters"><input id="search" type="search" aria-label="搜尋文件" placeholder="搜尋文號、主旨、文件編號…"><select id="customer" aria-label="客戶"><option value="">所有客戶</option></select><select id="topic-filter" aria-label="內容主題"><option value="">所有內容主題</option></select><select id="category" aria-label="公文用途"><option value="">所有公文用途</option>${categories.map((c) => `<option>${c}</option>`).join("")}</select></div><div class="table-wrap"><table><thead><tr><th>文號／文件</th><th>客戶</th><th>內容主題／公文用途</th><th>日期／版次</th><th>狀態</th></tr></thead><tbody id="rows"></tbody></table></div><div id="empty" class="empty"><div>▱</div><h3>上傳第一份文件</h3><p>按右上角「上傳文件」，或觀看虛構示範。<br>舊版資料不自動搬移。<a href="./legacy/">開啟舊版下載備份</a></p></div><div class="pagination"><button id="prev">←</button><span id="pages"></span><button id="next">→</button></div></section><section id="preview" class="preview-panel"><div class="preview-empty">選擇文件<br>查看分類、原文與往來歷程</div></section></div><section class="queue" id="queue"><h3>▥ 批次匯入佇列</h3><div class="import-row"><progress id="progress" value="0" max="1"></progress><span id="progress-text">尚無匯入作業</span><button id="pause">暫停</button><button id="resume">續接未完成</button><button id="errors">檢視失敗項目</button></div><div id="jobs" class="jobs"></div><p class="muted">每份上限 100 MB、PDF 150 頁。原檔先保存，再逐份辨識；重新開啟同一瀏覽器可續接。完整 ZIP 備份包含原檔、辨識文字與分類；容量仍由瀏覽器決定，單次完整備份上限 20 GB。</p></section><footer>siemens_docstorage<span>單人本機工作區 · 規則分類初版</span></footer></main><div id="toast" role="status" aria-live="polite"></div>`;
function render() {
  const topics = [
    ...new Set(records.map((r) => r.topic_name).filter(Boolean)),
  ].sort();
  $("#topic-filter").innerHTML =
    '<option value="">所有內容主題</option>' +
    topics
      .map(
        (t) =>
          `<option value="${esc(t)}" ${t === topicFilter ? "selected" : ""}>${esc(t)}</option>`,
      )
      .join("");
  $("#letters-count").textContent = records.filter(
    (r) => r.kind === "公文",
  ).length;
  $("#technical-count").textContent = records.filter(
    (r) => r.kind === "技術文件",
  ).length;
  $("#pending-count").textContent = records.filter((r) => !r.confirmed).length;
  const customers = [
    ...new Set(records.map((r) => r.customer).filter(Boolean)),
  ].sort();
  $("#customer").innerHTML =
    '<option value="">所有客戶</option>' +
    customers
      .map(
        (c) =>
          `<option value="${esc(c)}" ${c === customer ? "selected" : ""}>${esc(c)}</option>`,
      )
      .join("");
  const list = records.filter(
    (r) =>
      (view !== "letters" || r.kind === "公文") &&
      (view !== "technical" || r.kind === "技術文件") &&
      (view !== "pending" || !r.confirmed) &&
      (view !== "unclassified" || classificationState(r) === "未能自動分類") &&
      (!customer || r.customer === customer) &&
      (!category || r.category === category) &&
      (!topicFilter || r.topic_name === topicFilter) &&
      `${r.no} ${r.subject} ${r.topic} ${r.topic_name || ""} ${r.customer} ${r.files.map((f) => f.name).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  page = Math.min(page, Math.max(1, Math.ceil(list.length / 30)));
  $("#result-count").textContent = `${list.length.toLocaleString()} 筆`;
  $("#rows").innerHTML = list
    .slice((page - 1) * 30, page * 30)
    .map(
      (r) =>
        `<tr data-id="${r.id}" tabindex="0"><td><strong>${esc(r.no || r.topic || "待辨識")}</strong><small>${esc(r.subject)}</small></td><td>${esc(r.customer || "待確認")}</td><td><strong>${esc(r.topic_name || "主題待辨識")}</strong><small><span class="tag">${esc(r.category || "待分類")}</span></small></td><td>${esc(r.date || "—")}<small>${esc(r.version || "")}</small></td><td><span class="badge ${r.status === "error" ? "error" : r.confirmed ? "confirmed" : classificationState(r) === "已自動分類 · 待核對" ? "working" : "pending"}">${classificationState(r)}</span></td></tr>`,
    )
    .join("");
  $("#empty").hidden = !!list.length;
  $("#pages").textContent =
    `第 ${page} / ${Math.max(1, Math.ceil(list.length / 30))} 頁 · 每頁 30 筆`;
  $("#prev").disabled = page <= 1;
  $("#next").disabled = page * 30 >= list.length;
}
function queue() {
  const queued = records.filter((r) => r.status === "queued").length;
  $("#import-count").textContent = `${done} / ${total}`;
  $("#progress").max = total || 1;
  $("#progress").value = done;
  $("#progress-text").textContent = progress || `待處理 ${queued} 份`;
  $("#pause").textContent = paused ? "已暫停" : "暫停";
}
async function openRecord(id) {
  if (dirty && !confirm("尚有未保存修改，確定切換文件？")) return;
  dirty = false;
  selected = id;
  await preview();
}
async function preview() {
  const r = records.find((r) => r.id === selected);
  if (!r) return;
  let body = "";
  if (tab === "info")
    body = `<p class="notice">${classificationState(r)} · 內容主題：${esc(r.topic_name || "待辨識")} · 公文用途：${esc(r.category || "待分類")}</p><p class="muted">${esc(r.evidence || "尚未完成辨識，可先手動整理。")}</p>${r.error ? `<p class="error-note">${esc(r.error)}</p>` : ""}<form id="edit"><label>主旨<input name="subject" value="${esc(r.subject)}" required></label><label>文號<input name="no" value="${esc(r.no)}"></label><label>客戶／往來單位<input name="customer" value="${esc(r.customer)}"></label><label>文件種類<select name="kind">${["公文", "技術文件", "待分類"].map((c) => `<option ${r.kind === c ? "selected" : ""}>${c}</option>`).join("")}</select></label><label>公文用途（提送／審查／回覆）<select name="category">${categories.map((c) => `<option ${r.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></label><label>內容主題／技術文件名稱<input name="topic_name" value="${esc(r.topic_name || "")}"></label><label>技術文件編號<input name="document_no" value="${esc(r.document_no || "")}"></label><label>日期<input name="date" value="${esc(r.date)}"></label><label>版次<input name="version" value="${esc(r.version)}"></label><label>歷程識別（文件編號或內容主題）<input name="topic" value="${esc(r.topic)}"></label><label>期限原文（相對期限不自動推算）<input name="due" value="${esc(r.due)}"></label><button class="primary" type="submit">確認分類並保存</button></form><button id="reclassify">重新辨識與分類</button>`;
  if (tab === "timeline") {
    const ids = new Set([r.id]);
    if (r.topic)
      for (const x of records) if (x.topic === r.topic) ids.add(x.id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const x of records)
        for (const ref of x.references || [])
          if (
            ref.status === "confirmed" &&
            ref.target &&
            (ids.has(x.id) || ids.has(ref.target))
          ) {
            const n = ids.size;
            ids.add(x.id);
            ids.add(ref.target);
            changed |= n !== ids.size;
          }
    }
    body = `<p class="muted">同議題識別與已確認關聯共同呈現。時間相鄰不代表已確認回覆。</p><div class="timeline">${records
      .filter((x) => ids.has(x.id))
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
      .map(
        (x) =>
          `<article class="timeline-card ${x.id === r.id ? "current" : ""}"><small>${esc(x.date)} · ${esc(x.version)}</small><h4>${esc(x.no)} ${esc(x.subject)}</h4><button data-open="${x.id}">開啟文件</button></article>`,
      )
      .join("")}</div><h3>引用關係</h3>${
      (r.references || [])
        .map(
          (ref, i) =>
            `<article class="reference"><strong>${esc(ref.no)}</strong><blockquote>${esc(ref.quote)}</blockquote><span class="badge ${ref.status === "confirmed" ? "confirmed" : "pending"}">${ref.status === "confirmed" ? "已確認" : ref.status === "dismissed" ? "已排除" : "待確認"}</span><select data-ref="${i}"><option value="">選擇對應公文</option>${records
              .filter(
                (x) => x.id !== r.id && store.norm(x.no) === store.norm(ref.no),
              )
              .map(
                (x) =>
                  `<option value="${x.id}" ${ref.target === x.id ? "selected" : ""}>${esc(x.customer)} · ${esc(x.subject)}</option>`,
              )
              .join(
                "",
              )}</select><button data-link="${i}">確認關聯</button><button data-dismiss="${i}">排除</button></article>`,
        )
        .join("") ||
      '<p class="muted">未辨識到引用。可用相同議題編號整理，或手動建立引用。</p>'
    }<form id="add-ref"><label>新增引用文號<input name="number" required></label><button>加入引用待核對</button></form>`;
  }
  if (tab === "files")
    body = `${r.files.map((f) => `<article class="file-row"><div><strong>${esc(f.name)}</strong><small>${f.role === "translation" ? "既有翻譯" : f.role === "attachment" ? "附件" : "原文"} · ${bytes(f.size)}</small></div><button data-download="${f.id}">下載</button><button data-text="${f.id}">讀取文字</button></article>`).join("")}<button id="attach">＋ 補上翻譯 Word／附件</button><input id="attachment" type="file" accept=".docx,.pdf" multiple hidden><div id="text" class="original-text"></div>`;
  $("#preview").innerHTML =
    `<h3>${esc(r.no || "文件詳情")} ${esc(r.subject)}</h3>${demo ? '<p class="demo-label">虛構示範，未寫入你的文件</p>' : ""}<div class="tabs">${[
      ["info", "分類與原文"],
      ["timeline", "往來歷程"],
      ["files", "原檔與翻譯"],
    ]
      .map(
        ([v, t]) =>
          `<button data-tab="${v}" class="${tab === v ? "active" : ""}">${t}</button>`,
      )
      .join("")}</div>${body}`;
  if ($("#reclassify"))
    $("#reclassify").onclick = safe(async () => {
      requireStorage();
      if (running || importing) throw Error("請等候目前作業完成");
      if (
        (r.manual || dirty) &&
        !confirm(
          "重新辨識會取代此份文件的手動分類欄位，已確認的引用關係會保留。繼續？",
        )
      )
        return;
      dirty = false;
      r.manual = false;
      r.confirmed = false;
      for (const f of r.files) if (f.role === "original") f.status = "queued";
      r.status = "queued";
      await persist();
      await processQueue();
      await preview();
    });
  const form = $("#edit");
  if (form) {
    form.oninput = () => (dirty = true);
    form.onsubmit = safe(async (e) => {
      const values = Object.fromEntries(new FormData(e.target));
      if (
        values.topic === r.topic &&
        (!r.topic || r.topic === r.topic_name || r.topic === r.document_no)
      )
        values.topic = values.document_no || values.topic_name || values.topic;
      Object.assign(r, values);
      r.manual = true;
      r.confirmed = true;
      try {
        await persist();
        dirty = false;
        render();
        toast("分類已保存");
      } catch (error) {
        records = store.catalog.records;
        throw error;
      }
    });
  }
  if ($("#add-ref"))
    $("#add-ref").onsubmit = safe(async (e) => {
      r.references ??= [];
      r.references.push({
        no: new FormData(e.target).get("number"),
        quote: "人工新增",
        status: "pending",
        target: "",
      });
      await persist();
      await preview();
    });
  if ($("#attach"))
    $("#attach").onclick = safe(() => {
      requireStorage();
      $("#attachment").click();
    });
  if ($("#attachment"))
    $("#attachment").onchange = safe(async (e) => {
      await importFiles(e.target.files, r);
    });
}
$("#preview").onclick = safe(async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const r = records.find((x) => x.id === selected);
  if (b.dataset.tab) {
    if (dirty && !confirm("放棄尚未保存的修改？")) return;
    dirty = false;
    tab = b.dataset.tab;
    await preview();
  }
  if (b.dataset.open) await openRecord(b.dataset.open);
  if (b.dataset.link) {
    const i = +b.dataset.link,
      target = $(`[data-ref="${i}"]`).value;
    if (!target) throw Error("尚未找到對應文件，請先補入正確公文。");
    r.references[i].target = target;
    r.references[i].status = "confirmed";
    await persist();
    await preview();
  }
  if (b.dataset.dismiss) {
    r.references[+b.dataset.dismiss].status = "dismissed";
    await persist();
    await preview();
  }
  if (b.dataset.download) {
    requireStorage();
    const f = r.files.find((f) => f.id === b.dataset.download);
    download(await store.getFile(f.id), f.name);
  }
  if (b.dataset.text) {
    if (demo) {
      toast("示範不含真實原檔");
      return;
    }
    const pages = await store.getText(b.dataset.text);
    $("#text").innerHTML =
      pages
        .map(
          (p) =>
            `<article class="page-text"><small>第 ${p.page} 頁 · ${esc(p.method)}</small><pre>${esc(p.text)}</pre></article>`,
        )
        .join("") || "尚無辨識文字";
  }
});
async function loadMine() {
  if (running || importing || busyBackup) throw Error("請等候目前作業結束");
  if (dirty && !confirm("放棄未保存修改？")) return;
  await store.open();
  records = store.catalog.records;
  demo = false;
  dirty = false;
  selected = "";
  tab = "info";
  $("#my-documents").hidden = true;
  $("#storage-state").textContent = "保存在此瀏覽器";
  $("#preview").innerHTML = '<div class="preview-empty">選擇文件查看詳情</div>';
  render();
  queue();
  await updateSpace();
}
$("#my-documents").onclick = safe(loadMine);
$("#keep-storage").onclick = safe(async () => {
  if (!navigator.storage?.persist)
    throw Error("此瀏覽器不提供持續保存申請，請定期備份");
  const ok = await navigator.storage.persist();
  toast(
    ok
      ? "已取得持續保存，仍請定期備份"
      : "瀏覽器未核准持續保存；仍可使用，請定期下載備份。",
  );
});
async function importFiles(files, attach = null) {
  requireStorage();
  if (running || importing) throw Error("已有辨識作業，請稍後再匯入");
  const list = [...files];
  if (list.length > 1000) throw Error("每批最多 1,000 份，請分批匯入");
  for (const f of list)
    if (!/\.(pdf|docx)$/i.test(f.name) || f.size > 100 * 1024 * 1024)
      throw Error(`${f.name}：只接受 PDF／DOCX，單檔上限 100 MB`);
  importing = true;
  try {
    for (const f of list) {
      const fid = crypto.randomUUID();
      await store.putFile(f, fid);
      const entry = {
        id: fid,
        name: f.name,
        size: f.size,
        role: attach
          ? f.name.toLowerCase().endsWith(".docx")
            ? "translation"
            : "attachment"
          : "original",
        status: "queued",
      };
      if (attach) {
        attach.files.push(entry);
        attach.status = "queued";
      } else
        records.push({
          id: crypto.randomUUID(),
          subject: f.name,
          no: "",
          customer: "",
          category: "待分類",
          kind: "待分類",
          date: "",
          version: "",
          topic: "",
          due: "",
          references: [],
          files: [entry],
          status: "queued",
          confirmed: false,
        });
      await persist();
      progress = `已保存原檔 ${f.name}`;
      queue();
    }
  } finally {
    importing = false;
  }
  view = "all";
  page = 1;
  query = "";
  customer = "";
  category = "";
  topicFilter = "";
  $("#search").value = "";
  $("#category").value = "";
  $("nav .active")?.classList.remove("active");
  $('nav [data-view="all"]').classList.add("active");
  $("#view-title").textContent = "文件清單";
  render();
  await processQueue();
}
async function processQueue() {
  requireStorage();
  if (running || importing) return;
  running = true;
  paused = false;
  const jobs = records.flatMap((r) =>
    r.files.filter((f) => f.status === "queued").map((f) => ({ r, f })),
  );
  done = 0;
  total = jobs.length;
  try {
    for (const { r, f } of jobs) {
      if (paused) break;
      progress = f.name;
      queue();
      try {
        const blob = await store.getFile(f.id);
        const file = new File([blob], f.name);
        const pages = await extract(file, (p) => {
          progress = `${f.name} · ${p}`;
          queue();
        });
        await store.putText(f.id, pages);
        if (f.role === "original" && !r.manual) {
          const a = store.classify(pages.map((p) => p.text).join("\n"), f.name);
          applyClassification(r, a);
        }
        f.status = "done";
        f.error = "";
        delete r.error;
      } catch (error) {
        f.status = "error";
        f.error = error.message;
        r.error = error.message;
      }
      r.status = r.files.some((f) => f.status === "queued")
        ? "queued"
        : r.files.some((f) => f.status === "error")
          ? "error"
          : "done";
      await persist();
      done++;
      queue();
      render();
      if (selected === r.id && !dirty) await preview();
    }
    progress = paused ? "已暫停，可續接" : `本批完成 ${done} / ${total} 份`;
    queue();
    if (!paused && jobs.length) {
      const r = jobs.at(-1).r;
      toast(
        `${classificationState(r)}：${r.category || "待分類"}。請查看文件清單的分類欄。`,
      );
    }
  } finally {
    running = false;
  }
}
$("#upload").onclick = safe(() => {
  requireStorage();
  $("#files").click();
});
$("#files").onchange = safe(async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  await importFiles(files);
});
$("#pause").onclick = () => {
  paused = true;
  toast("將在目前文件完成後暫停");
};
$("#resume").onclick = safe(processQueue);
$("#errors").onclick = () => {
  $("#jobs").innerHTML =
    records
      .flatMap((r) =>
        r.files
          .filter((f) => f.status === "error")
          .map(
            (f) =>
              `<div>${esc(f.name)}：${esc(f.error)} <button data-retry="${f.id}">重試</button></div>`,
          ),
      )
      .join("") || "目前無失敗項目";
};
$("#jobs").onclick = safe(async (e) => {
  const id = e.target.dataset.retry;
  if (id) {
    for (const r of records)
      for (const f of r.files)
        if (f.id === id) {
          f.status = "queued";
          r.status = "queued";
        }
    await persist();
    await processQueue();
  }
});
$("#search").oninput = (e) => {
  query = e.target.value;
  page = 1;
  render();
};
$("#customer").onchange = (e) => {
  customer = e.target.value;
  page = 1;
  render();
};
$("#topic-filter").onchange = (e) => {
  topicFilter = e.target.value;
  page = 1;
  render();
};
$("#category").onchange = (e) => {
  category = e.target.value;
  page = 1;
  render();
};
$("#prev").onclick = () => {
  page--;
  render();
};
$("#next").onclick = () => {
  page++;
  render();
};
$("#rows").onclick = safe(async (e) => {
  const r = e.target.closest("[data-id]");
  if (r) await openRecord(r.dataset.id);
});
$("#rows").onkeydown = safe(async (e) => {
  if (e.key === "Enter") {
    const r = e.target.closest("[data-id]");
    if (r) await openRecord(r.dataset.id);
  }
});
$("nav").onclick = safe(async (e) => {
  const b = e.target.closest("[data-view]");
  if (!b) return;
  view = b.dataset.view;
  page = 1;
  $("nav .active")?.classList.remove("active");
  b.classList.add("active");
  if (view === "import") $("#queue").scrollIntoView({ behavior: "smooth" });
  if (view === "timeline") {
    tab = "timeline";
    if (selected) await preview();
  }
  $("#view-title").textContent = {
    all: "文件清單",
    letters: "收發公文",
    technical: "技術文件",
    pending: "待人工核對",
    unclassified: "未能自動分類",
    timeline: "往來歷程",
    import: "匯入與備份",
  }[view];
  render();
});
$("#backup").onclick = safe(async () => {
  requireStorage();
  if (running || importing) throw Error("請先等候目前文件完成");
  busyBackup = true;
  try {
    toast("正在建立含原檔的完整備份…");
    download(
      await backup(),
      "siemens-docstorage-" + new Date().toISOString().slice(0, 10) + ".zip",
    );
    toast("完整備份已下載，包含原檔、辨識文字與關聯。");
  } finally {
    busyBackup = false;
  }
});
$("#restore").onclick = safe(() => {
  requireStorage();
  if (running || importing) throw Error("請先等候作業結束");
  $("#restore-file").click();
});
$("#restore-file").onchange = safe(async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  requireStorage();
  busyBackup = true;
  try {
    const data = await readBackup(file);
    if (
      !confirm(
        `以備份中的 ${data.catalog.records.length} 筆文件取代目前資料？請先備份現有文件。`,
      )
    )
      return;
    try {
      await store.restoreAll(data.catalog, data.files, data.texts);
    } catch (error) {
      showStorageError(error);
      throw error;
    }
    records = store.catalog.records;
    selected = "";
    dirty = false;
    $("#preview").innerHTML =
      '<div class="preview-empty">備份已還原，請選擇文件</div>';
    render();
    await updateSpace();
    toast("完整備份已還原");
  } finally {
    busyBackup = false;
  }
});
$("#demo").onclick = safe(async () => {
  if (running || importing) throw Error("請先完成目前匯入");
  if (dirty && !confirm("放棄未保存修改？")) return;
  demo = true;
  $("#my-documents").hidden = false;
  dirty = false;
  records = [
    ["S501", "提送測試程序 Rev. A", "提送文件", "2026-08-01", "A", ""],
    ["P100", "測試程序審查意見", "審查意見", "2026-08-15", "A", "S501"],
    [
      "S530",
      "回覆審查意見並提送 Rev. B",
      "回覆補充",
      "2026-09-01",
      "B",
      "P100",
    ],
    ["P125", "再次審查意見", "審查意見", "2026-09-18", "B", "S530"],
  ].map(([no, subject, category, date, version, ref]) => ({
    id: no,
    no,
    subject,
    category,
    date,
    version,
    customer: "範例客戶 A",
    kind: "公文",
    topic: "SIG-TP-001",
    due: "",
    confirmed: no === "S501",
    status: "done",
    files: [{ id: no, name: no + ".pdf", size: 100000, role: "original" }],
    references: ref
      ? [
          {
            no: ref,
            quote: `復貴公司 ${ref} 號函。`,
            status: "pending",
            target: "",
          },
        ]
      : [],
    evidence: "虛構示範：依主旨及欄位提出分類建議。",
  }));
  $("#storage-state").textContent = "虛構示範模式";
  selected = "P100";
  tab = "timeline";
  render();
  await preview();
});
window.addEventListener("beforeunload", (e) => {
  if (running || importing || dirty || busyBackup) {
    e.preventDefault();
    e.returnValue = "";
  }
});
render();
queue();

loadMine().catch((error) => {
  showStorageError(error);
  toast(
    "無法使用瀏覽器儲存。請在獨立分頁開啟，或確認網站儲存未被公司政策阻擋。",
  );
});
