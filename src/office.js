import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  A = "http://schemas.openxmlformats.org/drawingml/2006/main";
function xml(bytes) {
  const d = new DOMParser().parseFromString(
    strFromU8(bytes),
    "application/xml",
  );
  if (d.querySelector("parsererror")) throw Error("文件 XML 格式不正確");
  return d;
}
function texts(el, ns, tag) {
  return [...el.getElementsByTagNameNS(ns, tag)]
    .map((x) => x.textContent)
    .join("");
}
async function archive(file) {
  if (file.size > 100 * 1024 * 1024) throw Error("單一檔案上限為 100 MB");
  let total = 0,
    count = 0;
  return unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (f) => {
      if (++count > 5000) throw Error("封裝項目過多");
      const selected =
        /^(word\/document\.xml|ppt\/slides\/slide\d+\.xml|ppt\/presentation\.xml|ppt\/_rels\/presentation\.xml.rels)$/.test(
          f.name,
        );
      if (selected) {
        total += f.originalSize;
        if (f.originalSize > 30 * 1024 * 1024 || total > 60 * 1024 * 1024)
          throw Error("解壓縮內容過大");
      }
      return selected;
    },
  });
}
export async function readDocx(file) {
  const z = await archive(file);
  if (!z["word/document.xml"]) throw Error("請使用 .docx 格式");
  const d = xml(z["word/document.xml"]);
  const entries = [];
  let tableNo = 0;
  for (const table of d.getElementsByTagNameNS(W, "tbl")) {
    tableNo++;
    const rows = [...table.getElementsByTagNameNS(W, "tr")];
    if (!rows.length) continue;
    const cells = (r) =>
      [...r.children]
        .filter((c) => c.localName === "tc")
        .map((c) =>
          [...c.getElementsByTagNameNS(W, "p")]
            .map((p) => texts(p, W, "t"))
            .join("\n")
            .trim(),
        );
    const header = cells(rows[0]).map((s) => s.trim().toLowerCase());
    const ti = header.findIndex((x) => /topic|議題/.test(x));
    const di = header.findIndex((x) => /description|討論紀錄/.test(x));
    if (ti < 0 || di < 0) continue;
    const ni = header.findIndex((x) => /note|備註/.test(x)),
      pi = header.findIndex((x) => /\bpic\b|負責人/.test(x));
    for (const row of rows.slice(1)) {
      const c = cells(row);
      if (!c[ti] && !c[di]) continue;
      const note = c[ni] || "";
      const bi = readBilingualCells(c[ti], c[di], note, c[pi]);
      entries.push(
        bi || {
          topic: c[ti] || "",
          description: c[di] || "",
          note,
          owner: c[pi] || "",
          category: "",
          status: /\bclosed\b|已關閉/i.test(note) ? "closed" : "",
        },
      );
    }
  }
  if (!entries.length)
    throw Error("找不到 Topic / Description 表格；空白範本不會建立議題");
  return entries;
}
export async function readPptx(file) {
  const z = await archive(file);
  let names = Object.keys(z)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort(
      (a, b) =>
        Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]),
    );
  const P = "http://schemas.openxmlformats.org/presentationml/2006/main",
    R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  if (z["ppt/presentation.xml"] && z["ppt/_rels/presentation.xml.rels"]) {
    const rel = xml(z["ppt/_rels/presentation.xml.rels"]),
      map = new Map(
        [...rel.documentElement.children].map((x) => [
          x.getAttribute("Id"),
          x.getAttribute("Target"),
        ]),
      );
    const order = [
      ...xml(z["ppt/presentation.xml"]).getElementsByTagNameNS(P, "sldId"),
    ]
      .map((x) => map.get(x.getAttributeNS(R, "id")))
      .map((n) => n?.replace(/^\/?ppt\//, "").replace(/^\.\//, ""))
      .map((n) => "ppt/" + n)
      .filter((n) => z[n]);
    if (order.length === names.length) names = order;
  }
  if (!names.length) throw Error("找不到簡報頁面，請使用 .pptx");
  const lines = (node) =>
    [...node.getElementsByTagNameNS(A, "p")]
      .map((p) => texts(p, A, "t"))
      .filter(Boolean)
      .join("\n");
  return names.map((n, i) => {
    const d = xml(z[n]);
    const shapes = [...d.getElementsByTagNameNS(P, "sp")]
      .map((sp) => ({
        text: lines(sp),
        type: sp.getElementsByTagNameNS(P, "ph")[0]?.getAttribute("type"),
      }))
      .filter(
        (x) => x.text.trim() && !["sldNum", "ftr", "dt"].includes(x.type),
      );
    const stage = shapes.filter((x) =>
      /第[一二三四]階段|Progress of Discussion on Key Issues|Switchover Topics|附錄|^Annex$/i.test(
        x.text,
      ),
    );
    const misc = shapes.filter(
      (x) =>
        !stage.includes(x) &&
        !/^更新[：:]|^Updated for|^Page \d+|^\d+$|Confidential.*©/i.test(
          x.text,
        ) &&
        x.text.trim() !== ".",
    );
    const tables = [...d.getElementsByTagNameNS(A, "tbl")].map((t) =>
      [...t.children]
        .filter((r) => r.localName === "tr")
        .map((r) =>
          [...r.children].filter((c) => c.localName === "tc").map(lines),
        ),
    );
    const title =
      misc.find((x) => x.type === "title")?.text || misc[0]?.text || "";
    const structural =
      /目錄|^Content$|End of Presentation|簡報完畢|Thank you|工程週會.*第\s*\d+\s*次|Weekly Meeting\s*#/i.test(
        misc.map((x) => x.text).join("\n"),
      );
    return {
      number: i + 1,
      text: lines(d),
      hidden: d.documentElement.getAttribute("show") === "0",
      section: stage.map((x) => x.text).join("\n"),
      title,
      tables,
      content: [
        ...misc.map((x) => x.text),
        ...tables.flatMap((t) => t.slice(1).flatMap((r) => r)),
      ].join("\n"),
      structural,
      annex: stage.some((x) => /附錄|Annex/i.test(x.text)),
    };
  });
}
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
const para = (s) =>
  String(s)
    .split("\n")
    .map(
      (l) => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`,
    )
    .join("");
const empty = "";
const block = (label, value) => `${label}\n${value || empty}`;
const markers = {
  topic: "議題 / Topic (ZH)",
  topicEn: "議題 / Topic (EN)",
  summary: "簡報重點 / Slide key points (ZH)",
  summaryEn: "簡報重點 / Slide key points (EN)",
  description: "會議討論 / Discussion (ZH)",
  descriptionEn: "會議討論 / Discussion (EN)",
  note: "備註 / Note (ZH)",
  noteEn: "備註 / Note (EN)",
  owner: "負責人 / Owner (ZH)",
  ownerEn: "負責人 / Owner (EN)",
  category: "階段 / Category (ZH)",
  categoryEn: "階段 / Category (EN)",
  status: "狀態 / Status",
};
function readBilingualCells(topic, description, note, owner) {
  if (
    !topic?.includes(markers.topic) ||
    !description?.includes(markers.description)
  )
    return null;
  const result = {
    topic: "",
    description: "",
    note: "",
    owner: "",
    category: "",
    status: "",
  };
  const reverse = new Map(Object.entries(markers).map(([k, v]) => [v, k]));
  let key = "";
  for (const line of [topic, description, note, owner].join("\n").split("\n")) {
    if (line.startsWith("來源 / Source:")) {
      key = "";
      continue;
    }
    if (reverse.has(line.trim())) {
      key = reverse.get(line.trim());
      result[key] = "";
    } else if (
      key &&
      line.trim() !== empty &&
      line.trim() !== "[未填寫 / Not provided]"
    )
      result[key] += (result[key] ? "\n" : "") + line;
  }
  const status = result.status;
  result.status = /closed|關閉/i.test(status)
    ? "closed"
    : /blocked|待協調/i.test(status)
      ? "blocked"
      : /\bopen\b|進行中/i.test(status)
        ? "open"
        : "";
  return result;
}
export function exportDocx(meeting) {
  const row = (values) =>
    `<w:tr>${values.map((v) => `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr>${para(v)}</w:tc>`).join("")}</w:tr>`;
  const field = (k, e) => block(markers[k], e[k]);
  const status = {
    open: "進行中 / Open",
    blocked: "待協調 / Pending coordination",
    closed: "已關閉 / Closed",
  };
  const body =
    para(`會議紀錄 / Minutes of Meeting: ${meeting.title} — ${meeting.date}`) +
    para(`會議次數 / Meeting No.: ${meeting.number || ""}`) +
    para(`English meeting title: ${meeting.titleEn || ""}`) +
    `<w:tbl><w:tblPr><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((k) => `<w:${k} w:val="single" w:sz="4"/>`).join("")}</w:tblBorders></w:tblPr>${row(["項次 / Item", "議題 / Topic", "內容 / Description", "備註 / Note", "負責人 / PiC"])}${meeting.entries.map((e, i) => row([i + 1, [field("topic", e), field("topicEn", e), field("category", e), field("categoryEn", e)].join("\n"), [field("summary", e), field("summaryEn", e), field("description", e), field("descriptionEn", e)].join("\n"), [block(markers.status, status[e.status] || ""), field("note", e), field("noteEn", e), ...(e.sourceSlides?.length ? [`來源 / Source: ${e.sourceFile || ""} · Slides ${e.sourceSlides.join(", ")}`] : [])].join("\n"), [field("owner", e), field("ownerEn", e)].join("\n")])).join("")}</w:tbl><w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/></w:sectPr>`;
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    "word/document.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    ),
  });
}
