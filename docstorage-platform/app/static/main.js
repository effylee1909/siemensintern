const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const categories = [
  "提送文件",
  "審查意見",
  "回覆／補充",
  "一般往來",
  "技術文件",
  "待分類",
];
const labels = {
  subject: "主旨／文件名稱",
  doc_no: "公文文號",
  customer: "往來對象",
  sender: "發文單位",
  recipient: "受文單位",
  date: "發文日期",
  kind: "文件類型",
  category: "分類",
  direction: "收發文",
  document_no: "技術文件編號",
  version: "版次",
  topic: "議題／歷程識別",
  due_date: "明確回覆日期",
  due_note: "期限原文／條件",
};
let view = "all",
  page = 1,
  data,
  detail,
  tab = "info",
  detailLoading = false,
  busy = false,
  polling = false;
const bytes = (n) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : n < 1073741824
        ? `${(n / 1048576).toFixed(1)} MB`
        : `${(n / 1073741824).toFixed(1)} GB`;
function notify(s) {
  $("#message").textContent = s;
}
async function api(path, options = {}) {
  const r = await fetch("/api" + path, options);
  if (r.status === 401) {
    if (!$("#login-dialog").open) $("#login-dialog").showModal();
    throw Error("請先登入");
  }
  if (!r.ok) {
    let d;
    try {
      d = await r.json();
    } catch {}
    throw Error(
      typeof d?.detail === "string" ? d.detail : `操作失敗 (${r.status})`,
    );
  }
  return r.json();
}
const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
function safe(fn) {
  return async (e) => {
    if (e?.type === "submit") e.preventDefault();
    try {
      await fn(e);
    } catch (error) {
      notify(error.message);
    }
  };
}
function options(values, current) {
  return values
    .map(
      (v) =>
        `<option ${v === current ? "selected" : ""} value="${esc(v)}">${esc(v)}</option>`,
    )
    .join("");
}
async function load() {
  if (polling) return;
  polling = true;
  try {
    const params = new URLSearchParams({
      q: $("#search").value,
      customer: $("#customer").value,
      category: $("#category").value,
      review: view === "pending" ? "pending" : "",
      kind:
        view === "letters" ? "公文" : view === "technical" ? "技術文件" : "",
      page,
    });
    data = await api("/records?" + params);
    renderList();
  } finally {
    polling = false;
  }
}
function renderList() {
  const s = data.stats;
  $("#stat-total").textContent = s.total;
  $("#stat-pending").textContent = s.pending;
  $("#pending-count").textContent = s.pending;
  $("#stat-jobs").textContent = s.processing;
  $("#stat-size").textContent = bytes(s.bytes);
  const customer = $("#customer").value;
  $("#customer").innerHTML =
    '<option value="">所有往來對象</option>' +
    options(data.customers, customer);
  $("#result-count").textContent = `${data.total} 筆紀錄`;
  const items = data.items;
  $("#rows").innerHTML = items
    .map((r) => {
      const m = r.effective;
      return `<tr data-id="${r.id}" tabindex="0" role="button" aria-label="開啟 ${esc(m.subject)}"><td><div class="doc-cell"><b class="file-icon">${m.kind === "技術文件" ? "DOC" : "PDF"}</b><div><strong>${esc(m.subject || "待辨識文件")}</strong><small>${esc(m.doc_no || m.document_no || "編號待確認")} <span>· ${r.files.length} 個檔案</span></small></div></div></td><td>${esc(m.customer || "待辨識")}<small>${esc(m.direction || "")}</small></td><td><span class="tag">${esc(m.category || "待分類")}</span></td><td>${esc(m.date || "—")}<small>${esc(m.version || "")}</small></td><td><span class="badge ${r.status === "error" ? "error" : r.status === "processing" ? "working" : r.review === "confirmed" ? "confirmed" : "pending"}">${r.status === "processing" ? "辨識處理中" : r.status === "error" ? "辨識需處理" : r.review === "confirmed" ? "已核對" : "待核對"}</span></td></tr>`;
    })
    .join("");
  $("#empty").hidden = items.length > 0;
  $("#page-info").textContent =
    `第 ${page} / ${Math.max(1, Math.ceil(data.total / 30))} 頁`;
  $("#prev").disabled = page <= 1;
  $("#next").disabled = page * 30 >= data.total;
}
$("#category").innerHTML + options(categories, "");
$("nav").onclick = safe(async (e) => {
  const b = e.target.closest("[data-view]");
  if (!b) return;
  view = b.dataset.view;
  page = 1;
  $("nav .active")?.classList.remove("active");
  b.classList.add("active");
  $("#view-title").textContent = {
    all: "全部文件",
    letters: "公文往來",
    technical: "技術文件",
    pending: "待核對分類",
  }[view];
  $("#category").value = view === "technical" ? "技術文件" : "";
  await load();
});
let timer;
$("#search").oninput = () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    page = 1;
    load().catch((e) => notify(e.message));
  }, 250);
};
for (const id of ["customer", "category"])
  $("#" + id).onchange = safe(async () => {
    page = 1;
    await load();
  });
$("#prev").onclick = safe(async () => {
  page--;
  await load();
});
$("#next").onclick = safe(async () => {
  page++;
  await load();
});
async function openUpload(id = "") {
  const list = await api("/records");
  $("#upload-target").innerHTML =
    '<option value="">新增文件紀錄</option>' +
    list.items
      .map(
        (r) =>
          `<option value="${r.id}">${esc(r.effective.doc_no || "無文號")} · ${esc(r.effective.subject)}</option>`,
      )
      .join("");
  if (id && !list.items.some((r) => r.id === id))
    $("#upload-target").insertAdjacentHTML(
      "beforeend",
      `<option value="${id}">${esc(detail.effective.subject)}</option>`,
    );
  $("#upload-target").value = id;
  $("#upload-role").value = id ? "translation" : "original";
  $("#upload-dialog").showModal();
}
$("#upload-open").onclick = safe(() => openUpload());
$("#empty-upload").onclick = safe(() => openUpload());
$("#upload-target").onchange = () => {
  $("#upload-role").value = $("#upload-target").value
    ? "translation"
    : "original";
};
$("#upload-form").onsubmit = safe(async (e) => {
  if (busy) return;
  busy = true;
  const button = e.target.querySelector("[type=submit]");
  button.disabled = true;
  try {
    const r = await api("/upload", {
      method: "POST",
      body: new FormData(e.target),
    });
    $("#upload-dialog").close();
    e.target.reset();
    notify(r.message);
    await load();
    if (r.ids.length === 1) await openDetail(r.ids[0]);
  } finally {
    busy = false;
    button.disabled = false;
  }
});
for (const b of document.querySelectorAll("[data-close]"))
  b.onclick = () => $("#" + b.dataset.close).close();
$("#rows").onclick = safe(async (e) => {
  const r = e.target.closest("[data-id]");
  if (r) await openDetail(r.dataset.id);
});
$("#rows").onkeydown = safe(async (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const r = e.target.closest("[data-id]");
    if (r) await openDetail(r.dataset.id);
  }
});
async function openDetail(id) {
  detail = await api("/records/" + id);
  tab = "info";
  renderDetail();
  if (!$("#detail-dialog").open) $("#detail-dialog").showModal();
}
function field(k, m) {
  const values =
    k === "category"
      ? categories
      : k === "kind"
        ? ["公文", "技術文件", "待分類"]
        : k === "direction"
          ? ["收文", "發文", "待確認"]
          : null;
  return `<label>${labels[k]}${values ? `<select name="${k}">${options(values, m[k])}</select>` : `<input name="${k}" value="${esc(m[k])}" ${["date", "due_date"].includes(k) ? 'type="date"' : ""} maxlength="2000">`}</label>`;
}
function renderDetail() {
  const r = detail,
    m = r.effective;
  $("#detail").innerHTML =
    `<div class="detail-top"><div><small>文件詳情 · ${r.review === "confirmed" ? "已核對" : "待核對"}</small><h2>${esc(m.subject)}</h2><p>${esc(m.doc_no || m.document_no || "編號待辨識")} <span>· ${esc(m.customer || "對象待辨識")}</span></p></div><button data-action="close">✕ 關閉</button></div><div class="detail-tabs">${[
      ["info", "分類與資料"],
      ["timeline", "往來歷程"],
      ["text", "辨識文字"],
      ["files", "原檔與翻譯"],
    ]
      .map(
        ([id, name]) =>
          `<button data-tab="${id}" class="${id === tab ? "active" : ""}">${name}</button>`,
      )
      .join(
        "",
      )}<button data-action="refresh">↻ 更新</button></div><div class="detail-body">${tab === "info" ? infoMarkup(r) : tab === "timeline" ? timelineMarkup(r) : tab === "text" ? textMarkup(r) : filesMarkup(r)}</div>`;
  $("#detail").onclick = safe(async (e) => {
    const t = e.target.closest("[data-tab]");
    if (t) {
      tab = t.dataset.tab;
      renderDetail();
      return;
    }
    const b = e.target.closest("[data-action]");
    if (!b) return;
    if (b.dataset.action === "close") $("#detail-dialog").close();
    if (b.dataset.action === "refresh") {
      detail = await api("/records/" + r.id);
      renderDetail();
    }
    if (b.dataset.action === "retry") {
      await api(`/records/${r.id}/retry`, { method: "POST" });
      notify("已重新排入辨識佇列，人工修正將保留。");
      await openDetail(r.id);
    }
    if (b.dataset.action === "attach") await openUpload(r.id);
    if (b.dataset.action === "open-related") await openDetail(b.dataset.id);
    if (b.dataset.action === "link") {
      const row = b.closest(".reference");
      const target = row.querySelector("select").value;
      await api(
        `/records/${r.id}/links`,
        json("POST", {
          ref: b.dataset.ref,
          target: target || null,
          status: b.dataset.status,
        }),
      );
      detail = await api("/records/" + r.id);
      renderDetail();
      notify("關聯已更新。");
    }
  });
  const edit = $("#record-form");
  if (edit)
    edit.onsubmit = safe(async (e) => {
      const values = Object.fromEntries(new FormData(e.target));
      const confirm = e.submitter?.value === "confirm";
      if (!confirm)
        for (const k of Object.keys(values))
          if (values[k] === (r.effective[k] || "")) delete values[k];
      await api(
        "/records/" + r.id,
        json("PATCH", { revision: r.revision, values, confirm }),
      );
      notify(confirm ? "已核對並保存分類。" : "人工修正已保存。");
      detail = await api("/records/" + r.id);
      renderDetail();
      await load();
    });
  const link = $("#manual-link");
  if (link)
    link.onsubmit = safe(async (e) => {
      const form = new FormData(e.target);
      await api(
        `/records/${r.id}/links`,
        json("POST", {
          ref: form.get("ref"),
          target: form.get("target"),
          status: "confirmed",
        }),
      );
      detail = await api("/records/" + r.id);
      renderDetail();
    });
}
function infoMarkup(r) {
  const m = r.effective;
  return `<div class="detail-grid"><section><h3>分類與登錄資料</h3><p class="muted">自動結果是建議。修改後會保留人工值，不被重新辨識覆蓋。</p>${r.status === "processing" ? '<div class="notice">文件處理中，稍後按「更新」取得辨識結果。</div>' : ""}${r.files
    .filter((f) => f.error)
    .map(
      (f) => `<div class="notice error">${esc(f.name)}：${esc(f.error)}</div>`,
    )
    .join("")}<form id="record-form"><div class="form-grid">${Object.keys(
    labels,
  )
    .map((k) => field(k, m))
    .join(
      "",
    )}</div><p class="muted">「議題／歷程識別」相同的紀錄會歸入同一歷程。期限條件不明時不自動計算，請先確認實際收文日與計日規則。</p><div class="sticky-actions"><button type="submit" value="save">儲存人工調整</button><button class="primary" type="submit" value="confirm">確認分類並保存</button></div></form></section><section class="evidence-panel"><h3>系統如何判斷？</h3><span class="tag">${esc(r.analysis.engine || "等待辨識")}</span><p class="muted">尚未接入語意模型。不同寫法可能漏辨識，需以實際樣本調整。</p>${(r.analysis.evidence || []).map((e) => `<article class="evidence"><strong>${esc(labels[e.field] || e.field)}</strong><p>${esc(e.reason)}</p>${e.page ? `<small>原文第 ${e.page} 頁</small>` : ""}</article>`).join("") || '<p class="muted">目前沒有可用的辨識依據。</p>'}<button data-action="retry">重新辨識（保留人工修正）</button></section></div>`;
}
function timelineMarkup(r) {
  return `<div class="detail-grid"><section><h3>完整往來歷程</h3><p class="muted">以已確認關聯及相同議題識別串接；系統建議不會直接合併議題。</p><div class="timeline">${r.timeline.map((d) => `<article class="timeline-card ${d.id === r.id ? "current" : ""}"><small>${esc(d.effective.date || "日期待確認")} · ${esc(d.effective.version || "")}</small><h4>${esc(d.effective.doc_no || "無文號")} · ${esc(d.effective.subject)}</h4><p>${esc(d.effective.customer || "")} <span class="tag">${esc(d.effective.category || "待分類")}</span></p>${d.files.map((f) => `<a class="attachment" href="/api/files/${f.id}">${esc(f.name)}</a>`).join("")}${d.id !== r.id ? `<button data-action="open-related" data-id="${d.id}">開啟紀錄 →</button>` : ""}</article>`).join("")}</div></section><section><h3>引用文號與勾稽</h3>${r.references.map((ref) => `<article class="reference"><span class="badge ${ref.status === "confirmed" ? "confirmed" : "pending"}">${ref.status === "confirmed" ? "已確認" : ref.status === "dismissed" ? "已排除" : "待確認"}</span><h4>${esc(ref.number)}</h4><blockquote>${esc(ref.quote)}</blockquote><small>${ref.page ? `原文第 ${ref.page} 頁` : "人工關聯"}</small><p class="muted">${ref.candidates.length === 0 ? "尚未找到唯一對應公文，可補上文件或人工關聯。" : ref.candidates.length > 1 ? "找到多筆相同文號，請核對單位與日期。" : "找到對應文號，請確認是否屬同一議題。"}</p><select aria-label="引用對應文件"><option value="">選擇對應公文</option>${ref.candidates.map((c) => `<option value="${c.id}" ${c.id === ref.target ? "selected" : ""}>${esc(c.customer)} · ${esc(c.subject)}</option>`).join("")}</select><div class="reference-actions"><button data-action="link" data-ref="${esc(ref.number)}" data-status="confirmed">確認關聯</button><button data-action="link" data-ref="${esc(ref.number)}" data-status="dismissed">排除</button></div></article>`).join("") || '<p class="muted">尚未辨識到引用文號，可手動建立關聯。</p>'}<form id="manual-link"><h4>人工連結既有公文</h4><label>對應公文文號<input name="ref" required placeholder="例如 S501"></label><label>選擇對應紀錄<select name="target" required><option value="">選擇紀錄</option>${(
    data?.items || []
  )
    .filter((d) => d.id !== r.id)
    .map(
      (d) =>
        `<option value="${d.id}">${esc(d.effective.doc_no || "無文號")} · ${esc(d.effective.subject)}</option>`,
    )
    .join(
      "",
    )}</select></label><button type="submit">建立已確認關聯</button><p class="muted">清單顯示目前頁面的紀錄；可先用主頁搜尋定位。</p></form></section></div>`;
}
function textMarkup(r) {
  return `<p class="muted">文字與頁碼供核對；OCR 可能誤讀文號，不保證逐字正確。Word 只保留段落順序，不推定頁碼。</p>${r.pages.map((f) => `<section class="text-file"><h3>${esc(f.name)} <span class="tag">${roleName(f.role)}</span></h3>${f.pages.map((p) => `<article class="page-text"><small>${f.name.endsWith(".docx") ? "段落文字" : `第 ${p.page} 頁`} · ${esc(p.method)}</small><pre>${esc(p.text)}</pre></article>`).join("") || "<p>等待辨識或辨識未成功，原檔仍可下載。</p>"}</section>`).join("")}`;
}
function roleName(role) {
  return {
    original: "原文／技術文件",
    translation: "既有翻譯",
    attachment: "附件",
  }[role];
}
function filesMarkup(r) {
  const pdf = r.files.find((f) => f.extension === ".pdf");
  return `<div class="files-heading"><div><h3>原檔、翻譯與附件</h3><p class="muted">完整保存上傳檔案，不產生翻譯。PDF 與 Word 可在同一筆紀錄補上。</p></div><button class="primary" data-action="attach">＋ 補上翻譯／附件</button></div>${r.files.map((f) => `<article class="file-row"><div><strong>${esc(f.name)}</strong><small>${roleName(f.role)} · ${bytes(f.size)} · ${f.status === "done" ? "已辨識" : f.status === "error" ? "辨識未成功" : "辨識中"}</small></div><a class="button" href="/api/files/${f.id}">下載原檔</a></article>`).join("")}${pdf ? `<iframe title="原始 PDF 預覽" src="/api/files/${pdf.id}?inline=true"></iframe>` : ""}`;
}
$("#settings-open").onclick = safe(async () => {
  const s = await api("/settings");
  $("#settings-form").elements.own_names.value = s.own_names.join("\n");
  $("#settings-form").elements.customers.value = s.customers
    .map((c) => [c.name, ...c.aliases].join(" | "))
    .join("\n");
  $("#settings-dialog").showModal();
});
$("#settings-form").onsubmit = safe(async (e) => {
  const f = e.target;
  await api(
    "/settings",
    json("PUT", {
      own_names: f.elements.own_names.value
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean),
      customers: f.elements.customers.value
        .split("\n")
        .filter((x) => x.trim())
        .map((line) => {
          const [name, ...aliases] = line
            .split("|")
            .map((x) => x.trim())
            .filter(Boolean);
          return { name, aliases };
        }),
    }),
  );
  $("#settings-dialog").close();
  notify("分類設定已保存。對既有文件可按重新辨識。");
});
async function seed() {
  const r = await api("/demo", { method: "POST" });
  notify(r.message);
  await load();
}
$("#demo").onclick = safe(seed);
$("#empty-demo").onclick = safe(seed);
$("#login-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api("/login", json("POST", { token: e.target.elements.token.value }));
    e.target.reset();
    $("#login-dialog").close();
    await load();
  } catch (error) {
    $("#login-error").textContent = error.message;
  }
};
load().catch((e) => notify(e.message));
setInterval(() => {
  if (!$("#login-dialog").open && !busy) load().catch(() => {});
}, 5000);
