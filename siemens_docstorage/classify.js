export const norm = (s) =>
  String(s || "")
    .normalize("NFKC")
    .replace(/[\s字第號:：－-]/g, "")
    .toUpperCase();
const labels = [
  "發文單位",
  "發文者",
  "受文者",
  "收文單位",
  "發文字號",
  "來文文號",
  "文號",
  "發文日期",
  "日期",
  "主旨",
  "說明",
  "辦法",
  "附件",
  "正本",
  "副本",
  "文件編號",
  "版次",
  "Subject",
  "Title",
  "Letter No\\.?",
  "Reference",
  "From",
  "To",
  "Date",
  "Document No\\.?",
  "Revision",
  "Rev\\.?",
];
const spaced = (s) =>
  s.replace(/([\u3400-\u9fff])(?=[\u3400-\u9fff])/g, "$1\\s*");
const labelPattern = labels.map(spaced).join("|");
export function normalizeText(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(new RegExp("[ \\t]+(?=(?:" + labelPattern + ")\\s*:)", "gi"), "\n")
    .replace(/(?<=[\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, "")
    .replace(/([\u3400-\u9fff])[ \t]+:/g, "$1:");
}
export function classify(raw, name) {
  const text = normalizeText(raw);
  const field = (label) => {
    const pattern = label.split("|").map(spaced).join("|");
    const m = text.match(
      new RegExp(
        "(?:^|\\n)\\s*(?:" +
          pattern +
          ")(?:[ \\t]*:[ \\t]*|[ \\t]*\\n[ \\t]*)([^\\n]+)",
        "i",
      ),
    );
    return m?.[1]?.trim() || "";
  };
  const extractedSubject = field("主旨|Subject|Title");
  let subject = extractedSubject;
  // A subject may wrap across several lines; stop at the next official field.
  if (subject) {
    const lines = text.split("\n");
    const i = lines.findIndex((l) =>
      new RegExp(
        "^\\s*(?:" + spaced("主旨") + "|Subject|Title)\\s*:",
        "i",
      ).test(l),
    );
    if (i >= 0) {
      for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
        const l = lines[j].trim();
        if (
          !l ||
          new RegExp("^(?:" + labelPattern + ")\\s*:", "i").test(l) ||
          /^[一二三四五六七八九十]+[、.]/.test(l)
        )
          break;
        subject += l;
      }
    }
  }
  if (!subject) subject = name.replace(/\.[^.]+$/, "");
  const no = field("發文字號|來文文號|文號|Letter No\\.?|Reference");
  let sender = field("發文單位|發文者|From");
  if (!sender)
    sender =
      text
        .split("\n")
        .slice(0, 8)
        .map((l) => l.trim())
        .find(
          (l) => /(公司|管理局|工程局)\s*(?:函)?$/.test(l) && !/[:：]/.test(l),
        )
        ?.replace(/\s*函$/, "") || "";
  const recipient = field("受文者|收文單位|To"),
    doc = field("文件編號|Document No\\.?");
  const official =
    !!no ||
    /檢送|檢附.*請|復貴|請查照|函復|please find enclosed|Dear\s/i.test(
      text.slice(0, 4000),
    ) ||
    /主\s*旨\s*:|受\s*文\s*者\s*:|發\s*文\s*字\s*號/.test(text);
  const technical =
    !official &&
    (!!doc ||
      /\b(?:test procedure|technical specification|design report|document number)\b|測試程序|技術規範|設計報告/i.test(
        subject + "\n" + text.slice(0, 3000),
      ));
  const kind = official ? "公文" : technical ? "技術文件" : "待分類";
  const source = extractedSubject ? subject : text.slice(0, 4000),
    scope = extractedSubject ? "主旨" : "文件內文（未找到標準主旨欄位）";
  let category =
      kind === "技術文件"
        ? "技術文件"
        : kind === "公文"
          ? "一般往來"
          : "待分類",
    hit = "";
  if (kind !== "技術文件")
    for (const [c, re] of [
      ["回覆補充", /回覆|補充|補件|回復|response|reply/i],
      ["審查意見", /審查意見|審查結果|review\s*(?:comments|results)/i],
      ["提送文件", /提送|送審|報核|提交.*審查|submit|submission/i],
    ]) {
      const match = source.match(re);
      if (match) {
        category = c;
        hit = match[0];
        break;
      }
    }
  // Content can identify business category without inventing a formal letter number.
  const effectiveKind = kind === "待分類" && hit ? "公文" : kind;
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
  const d = field("發文日期|日期|Date").match(
    /(\d{2,4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})/,
  );
  let date = "";
  if (d) {
    let y = +d[1];
    if (y < 1911) y += 1911;
    const value = `${y}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}`;
    const actual = new Date(value + "T00:00:00Z");
    if (!isNaN(actual) && actual.toISOString().slice(0, 10) === value)
      date = value;
  }
  return {
    subject,
    no,
    customer: /西門子|siemens/i.test(sender) ? recipient : sender,
    category,
    kind: effectiveKind,
    date,
    version:
      field("版次|Revision|Rev\\.?") ||
      text.match(/Rev\.?\s*([A-Z0-9.]+)/i)?.[1] ||
      "",
    topic: doc,
    references,
    evidence: hit
      ? `${scope}含「${hit}」，已自動分類為「${category}」，請核對。`
      : category === "待分類"
        ? "已讀取文字，但未找到足夠分類依據；請查看辨識文字並手動補充。"
        : `依文件欄位判定為「${effectiveKind}／${category}」，已自動分類，請核對。`,
    due:
      text
        .split("\n")
        .find((l) => /期限|文到|截止|deadline|within|請於.*回覆/.test(l)) || "",
  };
}
export function classificationState(r) {
  if (r.status === "queued") return "辨識中";
  if (r.status === "error") return "辨識失敗";
  if (r.confirmed) return "已人工確認";
  if (r.category && r.category !== "待分類" && r.kind !== "待分類")
    return "已自動分類 · 待核對";
  return "未能自動分類";
}
export function applyClassification(record, result) {
  const old = record.references || [];
  const refs = result.references.map((ref) => {
    const saved = old.find((r) => norm(r.no) === norm(ref.no));
    return saved ? { ...ref, status: saved.status, target: saved.target } : ref;
  });
  for (const ref of old)
    if (
      ref.status === "confirmed" &&
      !refs.some((r) => norm(r.no) === norm(ref.no))
    )
      refs.push(ref);
  Object.assign(record, result, { references: refs });
  return record;
}
