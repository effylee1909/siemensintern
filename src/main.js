import "./style.css";
import { backupArchive, restoreArchive, MAX_ARCHIVE } from "./archive.js";
import {
  readWorkspace,
  saveWorkspace,
  putAttachment,
  getAttachment,
  migrateAttachments,
  readPlainBackup,
} from "./storage.js";
import {
  prepareAgenda,
  proposeTopicNames,
  applyPreparedAgenda,
  presentationMetadata,
} from "./agenda.js";
import {
  demo,
  addMeeting,
  sortMeetings,
  uid,
  nextMeeting,
  previousEntry,
  decryptBackup,
  meetingNumber,
  bytes,
} from "./model.js";
import { readDocx, readPptx, exportDocx } from "./office.js";
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
function blankWorkspace() {
  return {
    version: 1,
    meetings: [
      {
        id: uid(),
        date: new Date().toLocaleDateString("sv-SE"),
        title: "",
        titleEn: "",
        entries: [],
        presentations: [],
      },
    ],
  };
}
let state = blankWorkspace(),
  selected = state.meetings.at(-1).id,
  entryId = null,
  filter = "all",
  query = "",
  presentationId = null,
  slideIndex = 0,
  dirty = false,
  isDemo = false;
let revision = 0,
  generation = 0,
  saveTimer,
  saveQueue = Promise.resolve(),
  storageReady = true,
  saveError = "";
const saveLabel = () =>
  saveError
    ? "未儲存 · 請下載備份"
    : dirty
      ? "儲存中…"
      : revision
        ? "已儲存在此瀏覽器"
        : "自動儲存已啟用";
function scheduleSave() {
  generation++;
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveQueue = saveQueue
      .catch(() => {})
      .then(async () => {
        if (!storageReady) return;
        const stamp = generation,
          snapshot = structuredClone(state);
        try {
          revision = await saveWorkspace(snapshot, revision, isDemo, selected);
          if (generation === stamp) dirty = false;
          saveError = "";
        } catch (e) {
          saveError = e.message;
          toast(e.message);
        }
        if ($("#save-state")) $("#save-state").textContent = saveLabel();
      });
  }, 250);
}
const statuses = {
  "": "未填寫 / Not specified",
  open: "進行中 / Open",
  blocked: "待協調 / Pending",
  closed: "已關閉 / Closed",
};
const current = () => state.meetings.find((m) => m.id === selected);
function change() {
  scheduleSave();
  if ($("#save-state")) $("#save-state").textContent = saveLabel();
}
function download(data, name, type) {
  const u = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function toast(t) {
  $("#toast").textContent = t;
  $("#toast").classList.add("visible");
  setTimeout(() => $("#toast").classList.remove("visible"), 4500);
}
const issueScrollPositions = new Map();
function render() {
  const oldIssues = $(".issue-scroll");
  if (oldIssues)
    issueScrollPositions.set(oldIssues.dataset.scrollKey, oldIssues.scrollTop);
  const issueScrollKey = JSON.stringify([selected, filter, query]);
  const oldNav = $(".sidebar nav"),
    navScroll = oldNav?.scrollTop || 0,
    navLeft = oldNav?.scrollLeft || 0;
  const m = current();
  const attachments = m.presentations || [];
  if (!attachments.some((p) => p.id === presentationId))
    presentationId = attachments[0]?.id;
  const presentation = attachments.find((p) => p.id === presentationId);
  const slides = presentation?.slides || [];
  slideIndex = Math.min(slideIndex, Math.max(0, slides.length - 1));
  const list = m.entries.filter(
    (e) =>
      (filter === "all" || e.status === filter) &&
      `${e.topic} ${e.topicEn || ""} ${e.owner} ${e.ownerEn || ""} ${e.summary || ""} ${e.summaryEn || ""} ${e.description} ${e.descriptionEn || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  if (!m.entries.some((e) => e.issueId === entryId))
    entryId = m.entries[0]?.issueId;
  const e = m.entries.find((e) => e.issueId === entryId);
  const previous = e && previousEntry(state, m.id, e.issueId);
  const index = state.meetings.findIndex((x) => x.id === m.id);
  $("#app").innerHTML =
    `<aside class="sidebar"><a class="brand" href="#"><span class="brand-icon">週</span><span>週進度會議<small>Weekly Meeting</small></span></a><div class="nav-title"><div>會議紀錄<small>Minute of Meeting</small></div><span>${state.meetings.length}</span></div><nav aria-label="會議列表 / Meeting list" tabindex="0">${[
      ...state.meetings,
    ]
      .reverse()
      .map(
        (x) =>
          `<button class="meeting ${x.id === selected ? "active" : ""}" data-meeting="${esc(x.id)}"><span class="calendar">▤</span><span>${esc(x.title)}<small>${esc(x.date)} · ${x.entries.length} 個議題</small></span></button>`,
      )
      .join(
        "",
      )}</nav><div class="meeting-actions"><button class="new-meeting secondary">＋ 建立下次會議</button><button id="add-history" class="secondary">＋ 新增歷史／其他會議</button><button id="import-history" class="text-button">↑ 批次上傳歷次 PPT</button></div></aside>
<main><header><div class="breadcrumb">會議紀錄 <span>/</span> ${esc(m.title)}</div><div class="header-actions"><span id="save-state">${saveLabel()}</span><button id="restore" class="secondary">開啟備份</button><button id="backup" class="primary">↓ 下載備份</button></div></header><section class="content"><div class="title-row"><div><div class="eyebrow">WEEKLY MEETING</div><h1>${esc(m.title || "尚未設定會議 / Meeting not set")} <span class="date-tag">${esc(m.date)}</span></h1><p class="meeting-title-en">${esc(m.titleEn || (meetingNumber(m) ? `Weekly Meeting #${meetingNumber(m)}` : ""))}</p><button id="edit-meeting" class="text-button">✎ 編輯會議名稱、次數與日期</button></div><button id="delete-meeting" class="secondary danger">刪除本次會議 / Delete meeting</button></div><div class="notice"><span>◈</span><div>${isDemo ? "<strong>目前顯示虛構示範資料</strong> · 可先試用流程，再建立空白工作區。" : "<strong>自動儲存於此瀏覽器</strong> · 同一瀏覽器再次開啟即可接續，不需密碼。"}<small>紀錄與備份均未加密；共用此瀏覽器的人可以讀取。資料不會上傳 GitHub。</small></div><button id="clear" class="text-button">${isDemo ? "開始我的紀錄" : "清除工作區"}</button>${!dirty && !isDemo && !m.entries.length && !(m.presentations || []).length ? '<button id="load-demo" class="text-button">觀看示範 / View demo</button>' : ""}</div>
<div class="stats">${[
      ["本次議題", m.entries.length, "all"],
      ["狀態未填", m.entries.filter((e) => e.status === "").length, ""],
      ["進行中", m.entries.filter((e) => e.status === "open").length, "open"],
      [
        "待協調",
        m.entries.filter((e) => e.status === "blocked").length,
        "blocked",
      ],
      [
        "已關閉",
        m.entries.filter((e) => e.status === "closed").length,
        "closed",
      ],
    ]
      .map(
        ([label, n, s]) =>
          `<button class="stat ${filter === s ? "selected" : ""}" data-filter="${s}"><span><i class="status-dot ${s}"></i>${label}</span><strong>${n.toString().padStart(2, "0")}</strong><small>${s === "closed" ? "下次會議不自動帶入" : s === "all" ? "追蹤本次所有討論" : "保留於下次會議"}</small></button>`,
      )
      .join("")}</div>
<div class="toolbar"><div class="tabs"><button data-filter="all" class="${filter === "all" ? "chosen" : ""}">所有議題</button><button data-filter="open" class="${filter === "open" ? "chosen" : ""}">進行中</button><button data-filter="closed" class="${filter === "closed" ? "chosen" : ""}">已關閉</button></div><div class="tools"><button id="rename-topics" class="secondary">整理所有議題名稱 / Topic names</button><button id="import" class="secondary">↑ 匯入 Word</button><button id="export" class="secondary">↓ 匯出 Word</button></div></div>
<section class="meeting-attachments"><div class="list-heading"><h2>本次會議簡報 <span>${attachments.length} 份 · 僅保留在本機與一般備份</span></h2><div><button id="storage-info" class="text-button">儲存空間 / Storage</button> <button id="ppt" class="secondary">＋ 上傳會議 PPT</button></div></div><p class="subtitle">上傳 .pptx 後可預覽自動整理的中英文議題與摘錄重點。僅本機處理、不對外傳送。<br>Upload slides to prepare bilingual topics and extractive key points locally.</p><div class="attachment-list">${attachments.map((p) => `<div class="attachment ${p.id === presentationId ? "active" : ""}"><button data-presentation="${esc(p.id)}">▤ ${esc(p.name)} <small>${p.slides.length} 頁</small></button><button class="text-button" data-prepare-ppt="${esc(p.id)}">整理成會議紀錄 / Prepare minutes</button>${p.data || p.blobId ? `<button data-download-ppt="${esc(p.id)}" class="text-button">下載原檔</button>` : '<span class="text-only-note">文字與表格 · 原檔未保留 / Text only</span>'}<button data-remove-ppt="${esc(p.id)}" class="text-button danger">移除</button></div>`).join("") || '<div class="attachment-empty">尚未上傳本次簡報。可先新增議題開始記錄。</div>'}</div></section><div class="workbench"><section class="issue-list"><div class="list-heading"><h2>議題列表 <span>${list.length}</span></h2><button id="add" class="primary">＋ 新增議題</button></div><input id="search" class="search" placeholder="搜尋議題或負責人…" value="${esc(query)}" aria-label="搜尋議題"><div class="issue-scroll" role="region" aria-label="議題列表 / Topic list" tabindex="0" data-scroll-key="${esc(issueScrollKey)}">${
      list.length
        ? list
            .map((x, i) => {
              const p = previousEntry(state, m.id, x.issueId);
              return `<button class="issue ${x.issueId === entryId ? "selected" : ""}" data-entry="${esc(x.issueId)}"><div class="issue-top"><span class="issue-number">${String(m.entries.indexOf(x) + 1).padStart(2, "0")}</span><span class="badge ${x.status}">${statuses[x.status]}</span></div><h3>${esc(x.topic || "待補中文議題")}</h3><div class="topic-en">${esc(x.topicEn || "English title pending")}</div><p>${esc(x.description || x.summary || "等待本週討論紀錄")}</p><div class="issue-meta"><span>${esc(x.owner || "未指定負責人")}</span><span>${p ? "延續議題" : "本次新增"}</span></div></button>`;
            })
            .join("")
        : '<div class="empty">沒有符合的議題<br><small>按「新增議題」即可直接編寫紀錄。</small></div>'
    }</div></section>
<section class="editor">${
      e
        ? `<div class="editor-top"><div class="eyebrow">議題 ${String(m.entries.indexOf(e) + 1).padStart(2, "0")} </div><div class="topic-actions"><span class="badge ${e.status}">${statuses[e.status]}</span><button id="topic-up" class="secondary" ${m.entries.indexOf(e) === 0 ? "disabled" : ""} title="依本次完整議題順序上移">↑ 上移 / Up</button><button id="topic-down" class="secondary" ${m.entries.indexOf(e) === m.entries.length - 1 ? "disabled" : ""} title="依本次完整議題順序下移">↓ 下移 / Down</button><button id="delete-top" class="text-button danger">刪除議題 / Delete</button></div></div>${bilingualInputs(e, "topic", "議題名稱 / Topic")}<div class="editor-fields"><label class="field">議題狀態 / Status<select data-field="status">${Object.entries(
            statuses,
          )
            .map(
              ([v, l]) =>
                `<option value="${v}" ${v === e.status ? "selected" : ""}>${l}</option>`,
            )
            .join(
              "",
            )}</select></label></div>${bilingualInputs(e, "owner", "負責人 / PiC")}<section class="agenda-summary"><div class="panel-heading"><span>簡報內容與重點 / Description & key points</span><small>本機擷取 · Extractive</small></div>${bilingualInputs(e, "summary", "會前重點 / Agenda key point", true)}${e.sourceSlides?.length ? `<details class="source-details"><summary>原文與來源 / Source: ${esc(e.sourceFile || "")} · ${e.sourceSlides.join(", ")}</summary><div class="bilingual-grid"><pre>${esc(e.sourceText || "未提供中文 / Chinese not provided")}</pre><pre>${esc(e.sourceTextEn || "未提供英文 / English not provided")}</pre></div></details>` : '<p class="subtitle">尚未整理本次簡報 / No slides prepared for this meeting</p>'}</section><div class="comparison"><div class="previous"><div class="panel-heading"><span>前次討論 / Previous discussion</span><small>${previous ? esc(previous.meeting.date) : "無歷史紀錄"}</small></div>${previous ? `<div class="previous-text">${esc(previous.entry.description || "未填寫中文 / Chinese not recorded")}<hr>${esc(previous.entry.descriptionEn || "未填寫英文 / English not recorded")}</div><div class="previous-note">備註 / Note：${esc(previous.entry.note || "—")}<br>${esc(previous.entry.noteEn || "—")}<br>PiC：${esc(previous.entry.owner || "—")} / ${esc(previous.entry.ownerEn || "—")} · ${statuses[previous.entry.status]}</div>` : '<p class="empty-history">本次新增的議題。<br>從這裡開始累積討論歷程。</p>'}</div><div class="this-week"><div class="panel-heading"><span>本次討論 / Current discussion</span><small>${esc(m.date)}</small></div><label class="discussion-label">中文</label><textarea data-field="description" aria-label="本次討論" placeholder="只需補充本次討論、決議與下一步…">${esc(e.description)}</textarea><label class="discussion-label">English</label><textarea data-field="descriptionEn" aria-label="Current discussion (English)" placeholder="Record the discussion and decisions in English…">${esc(e.descriptionEn || "")}</textarea></div></div>${bilingualInputs(e, "note", "備註與後續待辦 / Notes and actions", true)}<div class="editor-footer"><span>✓ 編輯後自動儲存於此瀏覽器，請定期下載備份</span><button id="history" class="text-button">檢視完整歷程 ↗</button><button id="delete" class="text-button danger">移除本次議題</button></div>`
        : '<div class="empty editor-empty"><strong>從簡報開始準備會議紀錄<br>Prepare minutes from your slides</strong><br>上傳 PPT，自動整理議題與重點，再補充會議討論。<br>也可以按「新增議題」手動加入。</div>'
    }</section></div><footer>MEETING DESK <span>議題跨週追蹤 · 週會紀錄整理</span><span>對方紀錄比對規劃中</span><button id="privacy" class="text-button page-privacy">資料保護與使用說明 ↗</button></footer></section></main><div id="toast" role="status"></div><dialog id="dialog"></dialog><input id="file" type="file" hidden>`;
  bind();
  const issuePane = $(".issue-scroll");
  if (issuePane)
    issuePane.scrollTop = issueScrollPositions.get(issueScrollKey) || 0;
  const nav = $(".sidebar nav"),
    active = nav?.querySelector(".meeting.active");
  if (nav) {
    nav.scrollTop = navScroll;
    nav.scrollLeft = navLeft;
    if (active) {
      const n = nav.getBoundingClientRect(),
        a = active.getBoundingClientRect();
      if (nav.scrollHeight > nav.clientHeight) {
        if (a.top < n.top) nav.scrollTop -= n.top - a.top;
        else if (a.bottom > n.bottom) nav.scrollTop += a.bottom - n.bottom;
      }
      if (nav.scrollWidth > nav.clientWidth) {
        if (a.left < n.left) nav.scrollLeft -= n.left - a.left;
        else if (a.right > n.right) nav.scrollLeft += a.right - n.right;
      }
    }
  }
}
function modal(title, body, onSubmit) {
  const d = $("#dialog");
  d.innerHTML = `<form id="modal-form"><div class="modal-heading"><h2>${title}</h2><button type="button" id="close-modal" aria-label="關閉">×</button></div>${body}</form>`;
  const ni = d.querySelector('[name="number"]'),
    ti = d.querySelector('[name="title"]');
  if (ni && ti)
    ni.addEventListener("input", () => {
      if (/^第\s*\d+\s*次週會$/.test(ti.value))
        ti.value = `第 ${ni.value} 次週會`;
      const en = d.querySelector("[name=titleEn]");
      if (en && /^Weekly Meeting #\d+$/.test(en.value))
        en.value = `Weekly Meeting #${ni.value}`;
    });
  d.showModal();
  $("#close-modal").onclick = () => d.close();
  $("#modal-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const b = $('#modal-form button[type="submit"]');
    if (b) b.disabled = true;
    try {
      await onSubmit?.(new FormData(ev.target));
    } catch (err) {
      $("#modal-error").textContent = err.message;
    } finally {
      if (b) b.disabled = false;
    }
  };
}
const error = '<p id="modal-error" class="error" role="alert"></p>';
function chooseFile(accept, handler) {
  const f = $("#file");
  f.accept = accept;
  f.multiple = false;
  f.value = "";
  f.onchange = async () => {
    if (!f.files[0]) return;
    try {
      await handler(f.files[0]);
    } catch (e) {
      toast(e.message);
    }
  };
  f.click();
}
function bind() {
  $("#rename-topics").onclick = () => {
    const meeting = current(), proposals = proposeTopicNames(meeting);
    if (!proposals.length) return toast("本次會議尚無議題");
    modal("整理本次所有議題名稱 / Review topic names",
      `<p>依簡報原文重新整理所有議題的中英文名稱。可在此修正建議；只更新名稱，討論、備註與狀態會保留。</p><div class="import-list">${proposals.map((p,i) => {
        const old=meeting.entries[i];
        return `<article><h3>${i+1}. ${esc(old.topic || old.topicEn)}</h3><div class="bilingual-grid"><label class="field">新名稱 / Topic (ZH)<input name="rename-zh-${i}" value="${esc(p.topic)}"></label><label class="field">新名稱 / Topic (EN)<input name="rename-en-${i}" value="${esc(p.topicEn)}"></label></div><details><summary>來源原文 / Source</summary><pre>${esc(old.sourceText || old.topic)}</pre><pre>${esc(old.sourceTextEn || old.topicEn)}</pre></details></article>`;
      }).join("")}</div><button type="submit" class="primary">套用所有名稱 / Apply names</button>`,
      f => {
        proposals.forEach((p,i) => {
          const entry=meeting.entries.find(e=>e.issueId===p.issueId);
          if(entry){entry.topic=String(f.get(`rename-zh-${i}`)||"").trim();entry.topicEn=String(f.get(`rename-en-${i}`)||"").trim();}
        });
        change();render();toast("本次所有議題名稱已更新");
      });
  };
  $("#storage-info").onclick = async () => {
    let info = {};
    try {
      info = (await navigator.storage?.estimate?.()) || {};
    } catch {}
    const mb = (n) =>
      Number.isFinite(n)
        ? n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(2) + " GB" : (n / 1024 / 1024).toFixed(0) + " MB"
        : "瀏覽器未提供";
    modal(
      "儲存空間 / Storage",
      `<p>單一 PPT 上限 100 MB；歷史原檔總量沒有固定 GB 上限，依瀏覽器配額而定。完整 ZIP 備份上限 20 GB。</p><p>此網站已使用約 ${mb(info.usage)}；瀏覽器總配額約 ${mb(info.quota)}；估計剩餘約 ${mb(Number.isFinite(info.quota) && Number.isFinite(info.usage) ? Math.max(0, info.quota - info.usage) : undefined)}。估計值不是可保證的剩餘容量。</p><p>檔案只存在這部裝置。瀏覽器清除／回收資料或磁碟滿時可能遺失，請定期下載包含原檔的完整 ZIP 備份。</p><button type="button" id="persist-storage" class="primary">嘗試啟用持續保存 / Keep local data</button><p id="persist-result" role="status"></p>`,
    );
    $("#persist-storage").onclick = async () => {
      try {
        const ok = await navigator.storage?.persist?.();
        $("#persist-result").textContent = ok
          ? "已允許持續保存（清除網站資料仍會刪除）。"
          : "瀏覽器未允許持續保存；請定期備份。";
      } catch {
        $("#persist-result").textContent = "無法變更，仍可繼續儲存及下載備份。";
      }
    };
  };

  $("#add-history").onclick = historicalMeeting;
  $("#import-history").onclick = () =>
    modal(
      "批次上傳歷次 PPT / Import historical slides",
      `<p>依封面的次數與日期建立／選取會議。之後逐場確認議題整理。</p><label class="check"><input name="textOnly" type="checkbox"> 僅保存文字與表格，原始 PPT 留在自己的公司資料夾 / Save extracted text only</label><p>勾選後不保留圖片與可下載的原始 PPT，可減少備份大小與本機儲存用量；完整原檔請自行保留。單一上傳檔上限為 100 MB。</p>${error}<button type="submit" class="primary">開始選取 PPT / Choose files</button>`,
      (f) => {
        const textOnly = !!f.get("textOnly");
        $("#dialog").close();
        const file = $("#file");
        file.accept = ".pptx";
        file.multiple = true;
        file.value = "";
        file.onchange = () => importHistoricalPpts([...file.files], textOnly);
        file.click();
      },
    );
  $("#load-demo")?.addEventListener("click", () => {
    state = demo();
    selected = state.meetings.at(-1).id;
    entryId = null;
    isDemo = true;
    render();
  });
  document
    .querySelectorAll("[data-prepare-ppt]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          preparePpt(
            current().presentations.find((p) => p.id === b.dataset.preparePpt),
          )),
    );
  $("#edit-meeting").onclick = editMeeting;
  $("#delete-meeting").onclick = () => {
    const meeting = current();
    modal("刪除本次會議 / Delete meeting",
      `<p>確認刪除「${esc(meeting.title || "未命名會議")}」？本次的議題、紀錄與 PPT 附件會一起移除，其他會議保留。</p>${error}<button type="submit" class="primary">確認刪除會議 / Delete meeting</button>`,
      () => {
        const position = state.meetings.findIndex(m => m.id === meeting.id);
        state.meetings = state.meetings.filter(m => m.id !== meeting.id);
        if (!state.meetings.length) state = blankWorkspace();
        selected = state.meetings[Math.min(Math.max(0, position), state.meetings.length - 1)].id;
        entryId = null; presentationId = null; filter = "all"; query = "";
        change(); render();
      });
  };
  document.querySelectorAll("[data-presentation]").forEach(
    (b) =>
      (b.onclick = () => {
        presentationId = b.dataset.presentation;
        slideIndex = 0;
        render();
      }),
  );
  document.querySelectorAll("[data-download-ppt]").forEach(
    (b) =>
      (b.onclick = async () => {
        const p = current().presentations.find(
          (p) => p.id === b.dataset.downloadPpt,
        );
        try {
          download(
            await getAttachment(p),
            p.name,
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          );
        } catch (e) {
          toast(e.message);
        }
      }),
  );
  document.querySelectorAll("[data-remove-ppt]").forEach(
    (b) =>
      (b.onclick = () =>
        modal(
          "移除本次簡報",
          `<p>會從本次會議移除原檔與文字參考。已下載的備份不受影響。</p>${error}<button type="submit" class="primary">確認移除簡報</button>`,
          () => {
            current().presentations = current().presentations.filter(
              (p) => p.id !== b.dataset.removePpt,
            );
            change();
            render();
          },
        )),
  );
  document.querySelectorAll("[data-meeting]").forEach(
    (b) =>
      (b.onclick = () => {
        selected = b.dataset.meeting;
        filter = "all";
        query = "";
        entryId = null;
        render();
      }),
  );
  document.querySelectorAll("[data-entry]").forEach(
    (b) =>
      (b.onclick = () => {
        entryId = b.dataset.entry;
        render();
        document
          .querySelector(".issue.selected")
          ?.focus({ preventScroll: true });
      }),
  );
  document.querySelectorAll("[data-filter]").forEach(
    (b) =>
      (b.onclick = () => {
        filter = b.dataset.filter;
        render();
      }),
  );
  $("#search").oninput = (e) => {
    const pos = e.target.selectionStart;
    query = e.target.value;
    render();
    $("#search").focus();
    $("#search").setSelectionRange(pos, pos);
  };
  document.querySelectorAll("[data-field]").forEach((el) => {
    el.oninput = () => {
      current().entries.find((e) => e.issueId === entryId)[el.dataset.field] =
        el.value;
      const card = document.querySelector(".issue.selected");
      if (card) {
        if (el.dataset.field === "topic")
          card.querySelector("h3").textContent = el.value;
        if (el.dataset.field === "description")
          card.querySelector("p").textContent = el.value || "等待本週討論紀錄";
        if (el.dataset.field === "owner")
          card.querySelector(".issue-meta span").textContent =
            el.value || "未指定負責人";
        if (el.dataset.field === "topicEn")
          card.querySelector(".topic-en").textContent =
            el.value || "English title pending";
      }
      change();
    };
    if (el.tagName === "SELECT") el.onchange = () => render();
  });
  document
    .querySelectorAll(".new-meeting")
    .forEach((b) => (b.onclick = newMeeting));
  $("#add").onclick = () => {
    filter = "all";
    query = "";
    const e = {
      issueId: uid(),
      topic: "",
      topicEn: "",
      summary: "",
      summaryEn: "",
      description: "",
      descriptionEn: "",
      note: "",
      noteEn: "",
      owner: "",
      ownerEn: "",
      status: "",
      category: "",
      categoryEn: "",
    };
    const entries = current().entries;
    const after = entries.findIndex(entry => entry.issueId === entryId);
    entries.splice(after < 0 ? entries.length : after + 1, 0, e);
    entryId = e.issueId;
    change();
    render();
    $('[data-field="topic"]').focus();
    $('[data-field="topic"]').select();
  };
  const deleteTopic = () =>
    modal(
      "移除本次議題",
      `<p>僅從本次會議移除，其他週的歷史紀錄會保留。若議題已完成，建議改為「已關閉」。</p>${error}<button type="submit" class="primary">確認移除</button>`,
      () => {
        current().entries = current().entries.filter(
          (e) => e.issueId !== entryId,
        );
        change();
        render();
      },
    );
  $("#delete")?.addEventListener("click", deleteTopic);
  $("#delete-top")?.addEventListener("click", deleteTopic);
  const moveTopic = (offset) => {
    const entries = current().entries, from = entries.findIndex(e => e.issueId === entryId), to = from + offset;
    if (from < 0 || to < 0 || to >= entries.length) return;
    [entries[from], entries[to]] = [entries[to], entries[from]];
    change();
    render();
  };
  $("#topic-up")?.addEventListener("click", () => moveTopic(-1));
  $("#topic-down")?.addEventListener("click", () => moveTopic(1));
  $("#import").onclick = () => chooseFile(".docx", importWord);
  $("#ppt").onclick = () => chooseFile(".pptx", uploadPpt);
  $("#export").onclick = () =>
    modal(
      "匯出 Word 紀錄",
      `<p>匯出包含本次所有議題，使用中英文 Item / Topic / Description / Note / PiC 表格；簡報重點與會議討論分開呈現。<br>Export bilingual key points, discussion, notes and owners.</p><p class="warning">英文未填寫的欄位會保持空白，不會自動翻譯。<br>Word 檔案未加密。請存放於公司核准的資料夾，並遵守分享權限。</p>${error}<button type="submit" class="primary">下載 Word</button>`,
      () => {
        download(
          exportDocx(current()),
          `會議紀錄-${current().date}.docx`,
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        );
        $("#dialog").close();
      },
    );
  $("#backup").onclick = async () => {
    const button = $("#backup");
    button.disabled = true;
    button.textContent = "正在封裝備份…";
    try {
      const result = await backupArchive(state);
      download(
        result.data,
        `週會備份-${new Date().toLocaleDateString("sv-SE")}.${result.name}`,
        result.type,
      );
      toast("完整備份已下載，包含所有會議與保留的 PPT 原檔");
    } catch (e) {
      toast(e.message);
    } finally {
      button.disabled = false;
      button.textContent = "↓ 下載備份";
    }
  };
  $("#restore").onclick = () =>
    chooseFile(".json,.zip,.meeting", async (file) => {
      if (file.size > (file.name.toLowerCase().endsWith(".zip") ? MAX_ARCHIVE : 100 * 1024 * 1024))
        throw Error("ZIP 備份上限 20 GB；JSON／舊加密備份上限 100 MB");
      const zipped = file.name.toLowerCase().endsWith(".zip");
      const text = zipped ? null : await file.text();
      let content;
      try {
        content = zipped ? {} : JSON.parse(text);
      } catch {
        throw Error("備份格式不正確");
      }
      const legacy = content.format === "meeting-desk-encrypted";
      let plain;
      if (!legacy && !zipped) plain = readPlainBackup(text);
      modal(
        legacy ? "匯入舊加密備份" : "開啟一般備份",
        `<p>會取代目前工作區。需要保留的資料請先下載備份。</p>${legacy ? '<p>只有舊加密備份需要原密碼；匯入後將以一般方式自動儲存。</p><label class="field">舊備份密碼<input name="password" type="password" required autocomplete="current-password"></label>' : ""}<label class="check"><input type="checkbox" required> 我確認取代目前工作區</label>${error}<button type="submit" class="primary">${legacy ? "解密並開啟" : "開啟備份 / Open backup"}</button>`,
        async (f) => {
          const loaded = zipped
            ? await restoreArchive(file)
            : legacy
              ? await decryptBackup(text, f.get("password"))
              : plain;
          await migrateAttachments(loaded);
          if (!loaded.meetings.length) throw Error("備份沒有會議");
          state = sortMeetings(loaded);
          selected = state.meetings.at(-1).id;
          entryId = null;
          presentationId = null;
          isDemo = false;
          change();
          render();
          toast("備份已開啟，將自動儲存在此瀏覽器");
        },
      );
    });
  $("#clear").onclick = () =>
    modal(
      "建立空白工作區",
      `<p>會清除目前分頁的全部會議及簡報參考。這不會刪除你已下載的檔案。</p><label class="field">第一場會議日期 / Date<input name="date" type="date" required value="${new Date().toLocaleDateString("sv-SE")}"></label><label class="field">會議次數 / Meeting No.<input name="number" type="number" min="1" max="999999" required value="219"></label><label class="field">會議名稱 / Title (ZH)<input name="title" required value="第 219 次週會"></label><label class="field">會議名稱 / Title (EN)<input name="titleEn" value="Weekly Meeting #219"></label><label class="check"><input type="checkbox" required> 我已備份需要保留的資料，確認清除</label>${error}<button type="submit" class="primary">建立空白工作區</button>`,
      (f) => {
        state = {
          version: 1,
          meetings: [
            {
              id: uid(),
              date: f.get("date"),
              title: f.get("title").trim() || `第 ${f.get("number")} 次週會`,
              number: Number(f.get("number")),
              titleEn: f.get("titleEn") || "",
              presentations: [],
              entries: [],
            },
          ],
        };
        selected = state.meetings[0].id;
        entryId = null;
        presentationId = null;
        isDemo = false;
        change();
        render();
      },
    );
  $("#privacy").onclick = () =>
    modal(
      "資料保護與使用說明",
      `<div class="privacy-copy"><h3>自動儲存與一般備份</h3><p>會議紀錄與附件會以未加密方式保存在此瀏覽器的 IndexedDB。同一網站、同一瀏覽器再次開啟會自動載入；換電腦或瀏覽器需要匯入完整 ZIP 或 JSON 備份。清除瀏覽器資料、無痕模式或儲存空間不足可能造成資料遺失，請定期下載備份。</p><h3>本機資料保護</h3><p>不使用外部 AI、追蹤或檔案上傳服務，資料不會寫入 GitHub。共用同一瀏覽器的人、具有權限的擴充功能或受入侵裝置可能讀取紀錄。網站目前沒有登入、雲端同步或存取權限。</p><h3>清除與分享</h3><p>清除工作區會以空白資料取代本機紀錄；不會刪除已下載的備份或原始檔案。JSON／ZIP、Word、原始 PPT 均未加密，請使用公司核准的儲存與分享方式。舊加密備份可用原密碼匯入；不再產生新的加密備份。</p><h3>PPT 整理</h3><p>只做本機文字、表格解析與摘錄，不自動翻譯或執行巨集，圖片與圖表需核對原檔。正式多人使用需要另設登入、權限與公司核准的資料儲存。</p></div>`,
    );
  $("#history")?.addEventListener("click", () => {
    const history = state.meetings
      .map((m) => ({ m, e: m.entries.find((e) => e.issueId === entryId) }))
      .filter((x) => x.e);
    modal(
      "議題完整歷程",
      `<div class="history">${history.map(({ m, e }) => `<article><small>${esc(m.date)} · ${esc(m.title)}</small><h3>${esc(e.topic)} <span class="badge ${e.status}">${statuses[e.status]}</span></h3><div class="bilingual-grid"><p>${esc(e.description || "中文未填寫")}</p><p>${esc(e.descriptionEn || "English not recorded")}</p></div><div class="bilingual-grid"><p>${esc(e.summary || "")}</p><p>${esc(e.summaryEn || "")}</p></div><small>備註：${esc(e.note || "—")} · PiC：${esc(e.owner || "—")}</small></article>`).join("")}</div>`,
    );
  });
  $("#slide-prev")?.addEventListener("click", () => {
    slideIndex--;
    render();
  });
  $("#slide-next")?.addEventListener("click", () => {
    slideIndex++;
    render();
  });
}
function newMeeting() {
  const last = state.meetings.at(-1);
  const number = meetingNumber(last) + 1;
  const date = new Date(`${last.date}T12:00:00`);
  date.setDate(date.getDate() + 7);
  modal(
    "建立下次會議",
    `<p>從最新一場「${esc(last.title)}」帶入 ${last.entries.filter((e) => e.status !== "closed").length} 個未關閉議題。前次討論保留於對照欄，本次討論與備註留白。</p><label class="field">會議日期 / Date<input name="date" type="date" required value="${date.toLocaleDateString("sv-SE")}"></label><label class="field">會議次數 / Meeting No.<input name="number" type="number" min="1" max="999999" required value="${number}"></label><label class="field">會議名稱 / Title (ZH)<input name="title" required value="第 ${number} 次週會"></label><label class="field">會議名稱 / Title (EN)<input name="titleEn" value="Weekly Meeting #${number}"></label><label class="check"><input name="carry" type="checkbox" checked> 帶入未關閉議題（匯入已完成紀錄時可取消）</label>${error}<button type="submit" class="primary">建立並帶入議題</button>`,
    (f) => {
      if (f.get("date") <= last.date)
        throw Error("下次會議日期必須晚於最新會議");
      const m = nextMeeting(
        last,
        f.get("date"),
        f.get("title").trim() || "每週工程會議",
      );
      m.number = Number(f.get("number"));
      m.titleEn = f.get("titleEn") || "";
      if (state.meetings.some((x) => meetingNumber(x) === m.number))
        throw Error("此會議次數已存在");
      if (!f.get("carry")) m.entries = [];
      addMeeting(state, m);
      selected = m.id;
      entryId = null;
      query = "";
      filter = "all";
      change();
      render();
    },
  );
}
async function importWord(file) {
  const entries = await readDocx(file);
  const idx = state.meetings.findIndex((m) => m.id === selected);
  const known = new Map();
  state.meetings
    .filter((m) => m.id !== selected)
    .forEach((m) => m.entries.forEach((e) => known.set(e.issueId, e)));
  const normalize = (s) => s.replace(/\s+/g, "").toLowerCase();
  modal(
    "確認 Word 匯入",
    `<p>將 ${entries.length} 個議題新增至「${esc(current().title)}」。名稱相同僅提供建議，請確認連結；名稱不同但為同一議題，可手動選擇。現有議題不會被覆寫。</p><div class="import-list">${entries
      .map((e, i) => {
        const suggested = [...known].find(
          ([id, x]) => normalize(x.topic) === normalize(e.topic),
        )?.[0];
        return `<article><h3>${i + 1}. ${esc(e.topic)} <span class="badge ${e.status}">${statuses[e.status]}</span></h3><p>${esc(e.description)}</p><label class="field">跨週議題連結<select name="link-${i}"><option value="">新增獨立議題</option>${[...known].map(([id, x]) => `<option value="${esc(id)}" ${id === suggested ? "selected" : ""}>連結其他會議：${esc(x.topic)}</option>`).join("")}</select></label></article>`;
      })
      .join(
        "",
      )}</div>${error}<button type="submit" class="primary">確認匯入 ${entries.length} 個議題</button>`,
    (f) => {
      const existing = new Set(current().entries.map((e) => e.issueId));
      const added = entries.map((e, i) => {
        const issueId = f.get(`link-${i}`) || uid();
        if (existing.has(issueId))
          throw Error(
            "同一議題在本次會議已有紀錄，請改為新增獨立議題或取消後編輯現有紀錄",
          );
        existing.add(issueId);
        return { ...e, issueId };
      });
      current().entries.push(...added);
      entryId = added[0].issueId;
      change();
      render();
      toast(`已匯入 ${added.length} 個議題，請檢查內容與狀態`);
    },
  );
}
async function uploadPpt(
  file,
  {
    target = current(),
    prepare = true,
    parsedSlides,
    retainOriginal = true,
  } = {},
) {
  const meeting = target;
  if (!file.name.toLowerCase().endsWith(".pptx"))
    throw Error("請先將舊版 .ppt 另存為 .pptx");
  if ((meeting.presentations || []).length >= 20)
    throw Error("每場會議最多 20 份簡報");
  const slides = parsedSlides || (await readPptx(file));
  if (slides.length > 500 || slides.some((s) => s.text.length > 1000000))
    throw Error("簡報內容過大");
  const p = {
    id: uid(),
    name: file.name,
    data: "",
    ...(retainOriginal
      ? { blobId: await putAttachment(file), size: file.size }
      : {}),
    slides,
  };
  (meeting.presentations ??= []).push(p);
  selected = meeting.id;
  presentationId = p.id;
  slideIndex = 0;
  change();
  render();
  toast("簡報已加入本次會議，請下載一般備份保存");
  if (prepare) preparePpt(p);
}
function bilingualInputs(e, key, label, textarea = false) {
  const input = (k, lang) =>
    textarea
      ? `<textarea data-field="${k}" aria-label="${esc(label)} (${lang})">${esc(e[k] || "")}</textarea>`
      : `<input data-field="${k}" aria-label="${key === "topic" && lang === "ZH" ? "議題名稱" : esc(label) + " (" + lang + ")"}" value="${esc(e[k] || "")}">`;
  const [zh, en] = label.split(" / ");
  return `<div class="bilingual-grid"><label class="field">${esc(zh)}${input(key, "ZH")}</label><label class="field">${esc(en)}${input(key + "En", "EN")}</label></div>`;
}
async function preparePpt(p) {
  if (p.slides.some((s) => s.tables === undefined)) {
    try {
      p.slides = await readPptx(new File([await getAttachment(p)], p.name));
      change();
    } catch (e) {
      return toast(e.message);
    }
  }
  const meeting = current(),
    drafts = prepareAgenda(p.slides, p.id, p.name);
  if (!drafts.length)
    return toast(
      "未辨識到可整理的議題，請參考原文或手動新增 / No topics detected",
    );
  const metadata = presentationMetadata(p.slides),
    idx = state.meetings.indexOf(meeting),
    known = new Map();
  const fits =
    metadata.number &&
    metadata.date &&
    !state.meetings.some(
      (m) => m.id !== meeting.id && meetingNumber(m) === metadata.number,
    );
  state.meetings.forEach((m) =>
    m.entries.forEach((e) => known.set(e.issueId, e)),
  );
  const normalized = (s) =>
    (s || "").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
  const suggestions = drafts.map(e => {
    const sameSource = meeting.entries.filter(
      (x) =>
        x.sourcePresentationId === p.id &&
        x.sourceItem === e.sourceItem &&
        x.sourceSlides?.some((n) => e.sourceSlides.includes(n)),
    );
    const exact = [...known].filter(
      ([id, x]) =>
        (e.topic && normalized(x.topic) === normalized(e.topic)) ||
        (e.topicEn && normalized(x.topicEn) === normalized(e.topicEn)),
    );
    const uniqueSourceItem =
      (e.category || e.categoryEn) &&
      drafts.filter(
        (d) =>
          d.sourceItem === e.sourceItem &&
          normalized(d.category) === normalized(e.category),
      ).length === 1;
    const byItem = [...known].filter(
      ([id, x]) =>
        uniqueSourceItem &&
        e.sourceItem &&
        e.sourceItem === x.sourceItem &&
        normalized(e.category) === normalized(x.category),
    );
    return sameSource.length === 1
        ? sameSource[0].issueId
        : exact.length === 1
          ? exact[0][0]
          : byItem.length === 1
            ? byItem[0][0]
            : "";
  });
  const counts = new Map();
  suggestions.filter(Boolean).forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
  modal(
    "PPT 整理成會議紀錄 / Prepare minutes",
    `${metadata.number || metadata.date ? `<div class="detected-metadata"><p>簡報封面 / Detected cover: 第 ${metadata.number || "—"} 次 · ${metadata.date || "—"}</p><label class="check"><input name="useMetadata" type="checkbox" ${fits && !meeting.entries.length ? "checked" : ""} ${fits ? "" : "disabled"}> 採用封面的次數、日期與雙語會議名稱 / Use cover metadata</label>${fits ? "" : "<p>封面資料不足或與其他會議衝突，請使用「編輯會議資料」確認。 / Check meeting metadata manually.</p>"}</div>` : ""}<p>共 ${p.slides.length} 頁簡報，辨識 ${drafts.length} 個候選議題（不是只取 3 個議題）。請確認摘要、勾選本次要討論的議題，並連結既有議題。原始中英文完整保留，會議討論欄留白。</p><p class="warning">每議題最多摘錄 3 個重點，議題數量沒有 3 個的限制。本機摘錄式摘要，不是 AI 翻譯。可見頁包含關閉議題也會預選；隱藏頁與附錄可另外勾選；圖表內容需人工核對。<br>Extractive summary only. Review source text and fill missing translations.</p><div class="agenda-selection"><strong id="agenda-count"></strong><button type="button" id="agenda-all" class="secondary">全選所有議題 / Select all</button><button type="button" id="agenda-visible" class="secondary">選取可見頁 / Visible pages</button><button type="button" id="agenda-none" class="text-button">取消全選 / Clear</button></div><div class="import-list agenda-preview">${drafts
      .map((e, i) => {
        // Ambiguous matches remain new topics until reviewed; never preselect
        // the same existing issue for multiple distinct presentation rows.
        const suggested = counts.get(suggestions[i]) === 1 ? suggestions[i] : "";
        return `<article data-draft="${i}"><label class="check"><input type="checkbox" name="include-${i}" ${e.recommended ? "checked" : ""}> ${i + 1}. 來源頁 / Slides ${e.sourceSlides.join(", ")} <span class="badge ${e.status}">${statuses[e.status]}</span></label><p class="draft-flags">${e.hidden ? "隱藏頁 / Hidden · " : ""}${e.annex ? "附錄 / Annex · " : ""}${e.confidence === "review" ? "版型需確認 / Layout needs review" : ""}${counts.get(suggestions[i]) > 1 ? " · 既有議題連結有歧義，預設新增獨立議題 / Ambiguous link; new topic selected" : ""}</p><div class="bilingual-grid"><label class="field">Topic<input name="topicEn-${i}" value="${esc(e.topicEn)}"></label><label class="field">議題<input name="topic-${i}" value="${esc(e.topic)}"></label><label class="field">Key points<textarea name="summaryEn-${i}">${esc(e.summaryEn)}</textarea></label><label class="field">重點<textarea name="summary-${i}">${esc(e.summary)}</textarea></label><label class="field">Owner<input name="ownerEn-${i}" value="${esc(e.ownerEn)}"></label><label class="field">負責人<input name="owner-${i}" value="${esc(e.owner)}"></label></div><label class="field">議題連結 / Topic link<select name="agenda-link-${i}"><option value="">新增議題 / New topic</option>${[...known].map(([id, x]) => `<option value="${esc(id)}" ${id === suggested ? "selected" : ""}>${meeting.entries.some((y) => y.issueId === id) ? "更新本次" : "連結其他會議"} / ${meeting.entries.some((y) => y.issueId === id) ? "Update current" : "Link existing"}: ${esc(x.topic || x.topicEn)}</option>`).join("")}</select></label><details class="source-details"><summary>核對中英文原文 / Review source text</summary><div class="bilingual-grid"><pre>${esc(e.sourceTextEn || "English source not provided")}</pre><pre>${esc(e.sourceText || "Chinese source not provided")}</pre></div></details></article>`;
      })
      .join(
        "",
      )}</div><p>更新既有議題時，會保留已寫的討論、備註與狀態。<br>Updating a topic preserves recorded discussion, notes and status.</p>${error}<button type="submit" class="primary">確認建立紀錄 / Apply agenda</button>`,
    (f) => {
      const useMetadata = f.get("useMetadata");
      if (useMetadata && !fits)
        throw Error("封面資料與會議順序衝突，請確認日期與次數");
      const selections = [];
      drafts.forEach((e, i) => {
        if (!f.get(`include-${i}`)) return;
        for (const k of [
          "topic",
          "topicEn",
          "summary",
          "summaryEn",
          "owner",
          "ownerEn",
        ])
          e[k] = String(f.get(`${k}-${i}`) || "").trim();
        if (!e.topic && !e.topicEn)
          throw Error("選取的議題至少需有一個語言的名稱");
        selections.push({
          index: i,
          issueId: f.get(`agenda-link-${i}`) || uid(),
        });
      });
      if (meeting.entries.length + selections.length > 1000)
        throw Error("每場會議最多 1000 個議題");
      const changed = applyPreparedAgenda(meeting, drafts, selections);
      if (useMetadata) {
        meeting.number = metadata.number;
        meeting.date = metadata.date;
        meeting.title = `第 ${metadata.number} 次週會`;
        meeting.titleEn = `Weekly Meeting #${metadata.number}`;
      }
      sortMeetings(state);
      entryId = changed[0].issueId;
      filter = "all";
      query = "";
      change();
      render();
      toast(`已整理 ${changed.length} 個雙語議題 / Topics prepared`);
    },
  );
  const counter = () => {
    $("#agenda-count").textContent =
      `已選 ${document.querySelectorAll(".agenda-preview input[type=checkbox]:checked").length} / ${drafts.length} 個候選議題 · 待確認匯入 / Selected, pending confirmation`;
  };
  document
    .querySelectorAll(".agenda-preview input[type=checkbox]")
    .forEach((b) => (b.onchange = counter));
  $("#agenda-all").onclick = () => {
    document
      .querySelectorAll(".agenda-preview input[type=checkbox]")
      .forEach((b) => (b.checked = true));
    counter();
  };
  $("#agenda-visible").onclick = () => {
    document
      .querySelectorAll(".agenda-preview input[type=checkbox]")
      .forEach((b, i) => (b.checked = !drafts[i].hidden && !drafts[i].annex));
    counter();
  };
  $("#agenda-none").onclick = () => {
    document
      .querySelectorAll(".agenda-preview input[type=checkbox]")
      .forEach((b) => (b.checked = false));
    counter();
  };
  counter();
}
function historicalMeeting() {
  const base = current(),
    date = new Date(`${base.date}T12:00:00`);
  date.setDate(date.getDate() - 7);
  const number = Math.max(1, meetingNumber(base) - 1);
  modal(
    "新增歷史／其他會議 / Add meeting",
    `<p>可加入第 218、217 次或任意日期的會議，不會帶入或改寫其他會議紀錄。 / Add meetings in any date order.</p><label class="field">會議次數 / Meeting No.<input name="number" type="number" min="1" max="999999" required value="${number}"></label><label class="field">會議日期 / Date<input name="date" type="date" required value="${date.toLocaleDateString("sv-SE")}"></label><label class="field">會議名稱 / Title (ZH)<input name="title" required value="第 ${number} 次週會"></label><label class="field">會議名稱 / Title (EN)<input name="titleEn" value="Weekly Meeting #${number}"></label>${error}<button type="submit" class="primary">新增會議 / Add meeting</button>`,
    (f) => {
      const m = {
        id: uid(),
        number: Number(f.get("number")),
        date: f.get("date"),
        title: f.get("title").trim(),
        titleEn: f.get("titleEn") || "",
        entries: [],
        presentations: [],
      };
      addMeeting(state, m);
      state.meetings = state.meetings.filter(
        (x) =>
          x.id === m.id ||
          x.title ||
          meetingNumber(x) ||
          x.entries.length ||
          (x.presentations || []).length,
      );
      selected = m.id;
      entryId = null;
      presentationId = null;
      filter = "all";
      query = "";
      change();
      render();
    },
  );
}
async function importHistoricalPpts(files, textOnly = false) {
  if (!files.length) return;
  const starter =
    state.meetings.length === 1 &&
    !state.meetings[0].title &&
    !meetingNumber(state.meetings[0]) &&
    !state.meetings[0].entries.length &&
    !(state.meetings[0].presentations || []).length
      ? state.meetings[0].id
      : null;
  const results = [];
  for (const file of files) {
    let created = null;
    try {
      const slides = await readPptx(file),
        metadata = presentationMetadata(slides);
      if (!metadata.number || !metadata.date)
        throw Error(
          "無法辨識封面日期或次數，請用「新增歷史／其他會議」手動建立",
        );
      let meeting = state.meetings.find(
        (m) => meetingNumber(m) === metadata.number,
      );
      if (!meeting) {
        meeting = {
          id: uid(),
          number: metadata.number,
          date: metadata.date,
          title: `第 ${metadata.number} 次週會`,
          titleEn: `Weekly Meeting #${metadata.number}`,
          entries: [],
          presentations: [],
        };
        addMeeting(state, meeting);
        created = meeting.id;
      }
      await uploadPpt(file, {
        target: meeting,
        prepare: false,
        parsedSlides: slides,
        retainOriginal: !textOnly,
      });
      if (starter)
        state.meetings = state.meetings.filter((m) => m.id !== starter);
      results.push({
        name: file.name,
        text: `已加入第 ${metadata.number} 次會議${textOnly ? "文字與表格（不含原檔）" : "附件"}`,
      });
    } catch (e) {
      if (created)
        state.meetings = state.meetings.filter((m) => m.id !== created);
      results.push({ name: file.name, text: e.message });
    }
  }
  render();
  modal(
    "歷次 PPT 上傳結果 / Import results",
    `<p>附件已依封面次數分配到會議。每場會議的議題仍需按「整理成會議紀錄」確認，不會自動覆寫既有紀錄。</p><p>不限制原檔合計為 40 MB；可保存的總量依瀏覽器空間而定，未成功的檔案會列出原因。</p><div class="import-list">${results.map((r) => `<article><h3>${esc(r.name)}</h3><p>${esc(r.text)}</p></article>`).join("")}</div>`,
  );
}
function editMeeting() {
  const m = current();
  modal(
    "編輯會議資料",
    `<label class="field">會議次數 / Meeting No.<input name="number" type="number" min="1" max="999999" required value="${meetingNumber(m) || 219}"></label><label class="field">會議名稱 / Title (ZH)<input name="title" required value="${esc(m.title)}"></label><label class="field">會議日期 / Date<input name="date" type="date" required value="${esc(m.date)}"></label><label class="field">會議名稱 / Title (EN)<input name="titleEn" value="${esc(m.titleEn || (meetingNumber(m) ? `Weekly Meeting #${meetingNumber(m)}` : ""))}"></label><p>可修改為任何日期，列表會自動依日期排序。 / Meetings are sorted by date.</p>${error}<button type="submit" class="primary">儲存會議資料</button>`,
    (f) => {
      const date = f.get("date"),
        number = Number(f.get("number"));
      if (
        state.meetings.some((x) => x.id !== m.id && meetingNumber(x) === number)
      )
        throw Error("此會議次數已存在");
      m.date = date;
      m.number = number;
      m.titleEn = f.get("titleEn") || "";
      m.title = f.get("title").trim() || `第 ${number} 次週會`;
      sortMeetings(state);
      change();
      render();
    },
  );
}
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function initialize() {
  try {
    const saved = await readWorkspace();
    if (saved) {
      state = sortMeetings(saved.state);
      revision = saved.revision;
      isDemo = saved.isDemo;
      selected = state.meetings.some((m) => m.id === saved.selectedId)
        ? saved.selectedId
        : state.meetings.at(-1).id;
    }
  } catch (e) {
    storageReady = false;
    saveError = e.message;
  }

  render();
  if (storageReady) {
    try {
      if (await migrateAttachments(state)) change();
    } catch (e) {
      toast(e.message);
    }
  }
  if (saveError) toast(saveError);
}
initialize();
