export const uid = () => crypto.randomUUID();
export function demo() {
  const a = uid(),
    b = uid(),
    c = uid();
  return {
    version: 1,
    meetings: [
      {
        id: uid(),
        date: "2026-09-09",
        number: 219,
        title: "第 219 次週會",
        entries: [
          {
            issueId: a,
            topic: "設備安裝測試程序",
            description: "初稿完成，等待審查意見。",
            note: "確認回覆日期",
            owner: "王工程師",
            status: "open",
            category: "關鍵議題",
          },
          {
            issueId: b,
            topic: "現場聯合會勘",
            description: "安排下一次現場確認。",
            note: "",
            owner: "李工程師",
            status: "open",
            category: "關鍵議題",
          },
        ],
      },
      {
        id: uid(),
        date: "2026-10-07",
        number: 220,
        title: "第 220 次週會",
        entries: [
          {
            issueId: a,
            topic: "設備安裝測試程序",
            description: "審查意見已整理，本週提交修訂版。",
            note: "追蹤正式發文",
            owner: "王工程師",
            status: "open",
            category: "關鍵議題",
          },
          {
            issueId: b,
            topic: "現場聯合會勘",
            description: "會勘完成，紀錄已確認。",
            note: "closed",
            owner: "李工程師",
            status: "closed",
            category: "關鍵議題",
          },
          {
            issueId: c,
            topic: "備援設備抽樣測試",
            description: "請安排抽樣送檢與測試時程。",
            note: "",
            owner: "陳工程師",
            status: "open",
            category: "其他議題",
          },
        ],
      },
    ],
  };
}
export function meetingNumber(m) {
  return m.number ?? Number(m.title.match(/第\s*(\d+)\s*次/)?.[1] || 0);
}
export function nextMeeting(previous, date, title) {
  return {
    id: uid(),
    date,
    title,
    number: meetingNumber(previous) + 1,
    presentations: [],
    entries: previous.entries
      .filter((e) => e.status !== "closed")
      .map((e) => ({
        ...e,
        description: "",
        descriptionEn: "",
        note: "",
        noteEn: "",
        summary: "",
        summaryEn: "",
        sourceText: "",
        sourceTextEn: "",
        sourceSlides: [],
        sourceFile: "",
        sourcePresentationId: "",
      })),
  };
}
export function previousEntry(state, meetingId, issueId) {
  const i = state.meetings.findIndex((m) => m.id === meetingId);
  for (let j = i - 1; j >= 0; j--) {
    const e = state.meetings[j].entries.find((e) => e.issueId === issueId);
    if (e) return { meeting: state.meetings[j], entry: e };
  }
  return null;
}
export function validateState(s) {
  if (
    s?.version !== 1 ||
    !Array.isArray(s.meetings) ||
    s.meetings.length > 1000
  )
    throw Error("備份格式不支援");
  const ids = new Set();
  for (const m of s.meetings) {
    if (
      typeof m.id !== "string" ||
      ids.has(m.id) ||
      typeof m.title !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(m.date) ||
      !Array.isArray(m.entries) ||
      m.entries.length > 1000
    )
      throw Error("會議資料格式不正確");
    if (
      m.titleEn !== undefined &&
      (typeof m.titleEn !== "string" || m.titleEn.length > 100000)
    )
      throw Error("英文會議名稱格式不正確");
    if (
      m.number !== undefined &&
      (!Number.isSafeInteger(m.number) || m.number < 1 || m.number > 999999)
    )
      throw Error("會議次數不正確");
    if (m.presentations !== undefined) {
      if (!Array.isArray(m.presentations) || m.presentations.length > 20)
        throw Error("簡報附件格式不正確");
      const ps = new Set();
      for (const p of m.presentations) {
        if (
          typeof p.id !== "string" ||
          ps.has(p.id) ||
          typeof p.name !== "string" ||
          !p.name.toLowerCase().endsWith(".pptx") ||
          typeof p.data !== "string" ||
          (p.data !== "" && !/^UEs[A-Za-z0-9+/]*={0,2}$/.test(p.data)) ||
          p.data.length > Math.ceil((100 * 1024 * 1024) / 3) * 4 ||
          !Array.isArray(p.slides) ||
          p.slides.length > 500 ||
          p.slides.some(
            (x) =>
              !Number.isInteger(x.number) ||
              x.number < 1 ||
              typeof x.text !== "string" ||
              x.text.length > 1000000,
          )
        )
          throw Error("簡報附件格式不正確");
        for (const slide of p.slides) {
          for (const k of ["section", "title", "content"])
            if (
              slide[k] !== undefined &&
              (typeof slide[k] !== "string" || slide[k].length > 1000000)
            )
              throw Error("簡報文字格式不正確");
          for (const k of ["hidden", "annex", "structural"])
            if (slide[k] !== undefined && typeof slide[k] !== "boolean")
              throw Error("簡報屬性格式不正確");
          if (
            slide.tables !== undefined &&
            (!Array.isArray(slide.tables) ||
              slide.tables.length > 200 ||
              slide.tables.some(
                (t) =>
                  !Array.isArray(t) ||
                  t.length > 1000 ||
                  t.some(
                    (r) =>
                      !Array.isArray(r) ||
                      r.length > 50 ||
                      r.some(
                        (c) => typeof c !== "string" || c.length > 1000000,
                      ),
                  ),
              ))
          )
            throw Error("簡報表格格式不正確");
        }
        if (
          p.blobId !== undefined &&
          (typeof p.blobId !== "string" || !p.blobId)
        )
          throw Error("原檔參照格式不正確");
        if (
          p.size !== undefined &&
          (!Number.isSafeInteger(p.size) ||
            p.size < 0 ||
            p.size > 100 * 1024 * 1024)
        )
          throw Error("原檔大小格式不正確");
        ps.add(p.id);
      }
    }
    ids.add(m.id);
    const issues = new Set();
    for (const e of m.entries) {
      if (
        typeof e.issueId !== "string" ||
        issues.has(e.issueId) ||
        !["", "open", "blocked", "closed"].includes(e.status) ||
        ["topic", "description", "note", "owner", "category"].some(
          (k) => typeof e[k] !== "string" || e[k].length > 100000,
        )
      )
        throw Error("議題資料格式不正確");
      for (const k of [
        "topicEn",
        "summary",
        "summaryEn",
        "descriptionEn",
        "noteEn",
        "ownerEn",
        "categoryEn",
        "sourceText",
        "sourceTextEn",
        "sourceFile",
        "sourcePresentationId",
        "sourceItem",
      ])
        if (
          e[k] !== undefined &&
          (typeof e[k] !== "string" || e[k].length > 1000000)
        )
          throw Error("雙語議題格式不正確");
      if (
        e.sourceSlides !== undefined &&
        (!Array.isArray(e.sourceSlides) ||
          e.sourceSlides.length > 500 ||
          e.sourceSlides.some((n) => !Number.isInteger(n) || n < 1 || n > 500))
      )
        throw Error("來源頁碼格式不正確");
      issues.add(e.issueId);
    }
  }
  return s;
}
export async function encryptBackup(state, password) {
  if (password.length < 12) throw Error("密碼至少需要 12 個字元");
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(password, salt);
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(state)),
  );
  return JSON.stringify({
    format: "meeting-desk-encrypted",
    version: 1,
    iterations: 310000,
    salt: base64(salt),
    iv: base64(iv),
    data: base64(new Uint8Array(data)),
  });
}
export async function decryptBackup(text, password) {
  const o = JSON.parse(text);
  if (
    o.format !== "meeting-desk-encrypted" ||
    o.version !== 1 ||
    o.iterations !== 310000
  )
    throw Error("不是支援的加密備份");
  const salt = bytes(o.salt),
    iv = bytes(o.iv);
  if (salt.length !== 16 || iv.length !== 12) throw Error("備份格式不正確");
  try {
    const key = await derive(password, salt);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      bytes(o.data),
    );
    return validateState(JSON.parse(new TextDecoder().decode(plain)));
  } catch {
    throw Error("密碼錯誤、檔案損毀或內容格式不正確");
  }
}
async function derive(password, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export function base64(a) {
  let s = "";
  for (let i = 0; i < a.length; i += 8192)
    s += String.fromCharCode(...a.subarray(i, i + 8192));
  return btoa(s);
}
export function bytes(s) {
  if (typeof s !== "string") throw Error("備份格式不正確");
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
export function sortMeetings(state) {
  state.meetings.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || meetingNumber(a) - meetingNumber(b),
  );
  return state;
}
export function addMeeting(state, meeting) {
  if (
    state.meetings.some(
      (m) =>
        m.id === meeting.id ||
        (meetingNumber(meeting) > 0 &&
          meetingNumber(m) === meetingNumber(meeting)),
    )
  )
    throw Error("此會議次數已存在，請選取既有會議上傳簡報");
  state.meetings.push(meeting);
  sortMeetings(state);
  return meeting;
}
