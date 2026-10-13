// Extractive preparation only: no network calls, translation or invented decisions.
export function splitLanguages(text = "") {
  const zh = [],
    en = [];
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const han = (line.match(/[\u3400-\u9fff]/g) || []).length,
      latin = (line.match(/[A-Za-z]/g) || []).length;
    if (!han) {
      if (latin) en.push(line);
      else if (zh.length) zh[zh.length - 1] += " " + line;
      else en.push(line);
      continue;
    }
    // English sentences may contain Chinese letter numbers, quoted names or dates.
    if (latin > han * 3 && /^[A-Za-z<]/.test(line)) {
      en.push(line);
      continue;
    }
    const boundary = line.search(
      /(?<=[\u3400-\u9fff）)])\s*(?:[A-Z][a-z]{2,}|[A-Z]{2,}(?:\s|\/|$))/,
    );
    if (
      boundary > 0 &&
      /[\u3400-\u9fff]/.test(line.slice(0, boundary)) &&
      !/[\u3400-\u9fff]/.test(line.slice(boundary))
    ) {
      zh.push(line.slice(0, boundary).trim());
      en.push(line.slice(boundary).trim());
    } else zh.push(line);
  }
  return { zh: zh.join("\n"), en: en.join("\n") };
}
export function summarize(text, language = "zh", limit = 3) {
  const pieces = text
    .split(
      language === "zh"
        ? /(?<=[。！？；])|\n+/
        : /(?<=[.!?;])\s+(?!January\b|February\b|March\b|April\b|May\b|June\b|July\b|August\b|September\b|October\b|November\b|December\b|Jan\b|Feb\b|Mar\b|Apr\b|Jun\b|Jul\b|Aug\b|Sep\b|Sept\b|Oct\b|Nov\b|Dec\b)|\n+/i,
    )
    .map((s) => s.trim())
    .filter(Boolean);
  const unique = [...new Set(pieces)];
  if (unique.length <= limit) return unique.map((s) => "• " + s).join("\n");
  const action =
    /待|須|需|請|未|預計|預定|已於|目前|pending|await|need|shall|must|request|planned|scheduled|currently|remaining|already/i;
  const ranked = unique
    .map((s, i) => ({
      s,
      i,
      score:
        (action.test(s) ? 5 : 0) + (i === 0 ? 3 : 0) + (i / unique.length) * 2,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .sort((a, b) => a.i - b.i);
  return ranked.map((x) => "• " + x.s).join("\n");
}
function shortTitle(text, lang) {
  const first = text.split(/\n|[。！？]/)[0]?.trim() || "";
  const max = lang === "zh" ? 70 : 120;
  if (first.length <= max) return first;
  let s = first.slice(0, max);
  if (lang === "en") s = s.replace(/\s+\S*$/, "");
  return s + "…";
}
// Prefer names present in the source, not dates, letter numbers or narrative verbs.
export function extractTopic(text, lang, explicit = false) {
  if (explicit) return shortTitle(text, lang);
  if (lang === "zh") {
    const match = text.match(
      /(?:提送|提交|修訂|更新|提供|確認)\s*((?:[^，。；：\n（）()]){2,70}?(?:測試程序|測試計畫|測試報告|安全文件|聯合會勘|施工計畫|施工時程|切換時程|會議紀錄|測試紀錄|軌道佈置圖|聯鎖圖表))/,
    );
    if (match)
      return match[1]
        .replace(/^(?:辦理|安排|進行|有關|關於|本案)\s*/, "")
        .trim();
  } else {
    const named = text.match(
      /\b((?:[A-Z][A-Za-z0-9/&-]*\s+){1,10}(?:Procedure|Plan|Report|Schedule|Survey|Test|Testing|Documentation|Documents?))\b/,
    );
    if (named) return named[1].trim();
    const phrase = text.match(
      /\b(?:the|a|an)\s+((?:[a-z0-9&/-]+\s+){0,6}(?:test procedure|test plan|test report|site survey|safety documents|construction schedule|switchover schedule|installation progress))\b/i,
    );
    if (phrase) return phrase[1].trim();
  }
  return shortTitle(text, lang);
}
const normalize = (s) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
export function prepareAgenda(slides, presentationId = "", fileName = "") {
  const drafts = [];
  for (const slide of slides) {
    const category = splitLanguages(slide.section || "");
    let made = false;
    for (const table of slide.tables || []) {
      if (table.length < 2) continue;
      const header = table[0].map((s) => s.toLowerCase().replace(/\s/g, ""));
      const desc = header.findIndex((s) => /辦理內容|description/.test(s)),
        topic = header.findIndex((s) => /議題|topic|執行工作及待辦/.test(s)),
        owner = header.findIndex((s) =>
          /actionowner|requiredby|負責人|^pic$|^owner$/.test(s),
        ),
        status = header.findIndex((s) => /status|狀態/.test(s)),
        item = header.findIndex((s) => /^(項次|item|no\.?)/.test(s));
      if (desc < 0 && topic < 0) continue;
      for (const row of table.slice(1)) {
        const text = row[desc >= 0 ? desc : topic] || "";
        if (!text.trim()) continue;
        const title = splitLanguages(topic >= 0 ? row[topic] : text),
          body = splitLanguages(text),
          responsible = splitLanguages(row[owner] || ""),
          rawStatus = row[status] || "";
        const closed = /\bclosed\b|關閉/i.test(rawStatus),
          blocked = /pending|await|待協調/i.test(rawStatus),
          open = /\bopen\b|\bongoing\b|進行中/i.test(rawStatus);
        drafts.push({
          topic: extractTopic(title.zh, "zh", topic >= 0) || "",
          topicEn: extractTopic(title.en, "en", topic >= 0) || "",
          summary: summarize(body.zh),
          summaryEn: summarize(body.en, "en"),
          description: "",
          descriptionEn: "",
          note: "",
          noteEn: "",
          owner: responsible.zh,
          ownerEn: responsible.en,
          category: category.zh,
          categoryEn: category.en,
          status: closed ? "closed" : blocked ? "blocked" : open ? "open" : "",
          sourceText: body.zh,
          sourceTextEn: body.en,
          sourceSlides: [slide.number],
          sourcePresentationId: presentationId,
          sourceFile: fileName,
          sourceItem: item >= 0 ? row[item] || "" : "",
          recommended: !slide.hidden && !slide.annex,
          hidden: !!slide.hidden,
          annex: !!slide.annex,
          confidence: desc >= 0 ? "table" : "review",
        });
        made = true;
      }
    }
    // Non-agenda tables, chart pages and standalone bilingual titles need review.
    if (!made && slide.content?.trim() && !slide.structural) {
      const body = splitLanguages(slide.content),
        title = splitLanguages(slide.title || slide.content);
      drafts.push({
        topic: shortTitle(title.zh, "zh"),
        topicEn: shortTitle(title.en, "en"),
        summary: summarize(body.zh),
        summaryEn: summarize(body.en, "en"),
        description: "",
        descriptionEn: "",
        note: "",
        noteEn: "",
        owner: "",
        ownerEn: "",
        category: category.zh,
        categoryEn: category.en,
        status: "",
        sourceText: body.zh,
        sourceTextEn: body.en,
        sourceSlides: [slide.number],
        sourcePresentationId: presentationId,
        sourceFile: fileName,
        sourceItem: "",
        recommended: !slide.hidden && !slide.annex,
        hidden: !!slide.hidden,
        annex: !!slide.annex,
        confidence: "review",
      });
    }
  }
  // Same numbered item on adjacent ZH/EN pages: merge only complementary languages.
  const result = [];
  for (const d of drafts) {
    const last = result.at(-1),
      sameItem =
        last &&
        d.sourceItem &&
        last.sourceItem === d.sourceItem &&
        last.category === d.category &&
        last.hidden === d.hidden &&
        d.sourceSlides[0] - last.sourceSlides.at(-1) === 1;
    const complementary =
      last &&
      ((last.sourceText &&
        !last.sourceTextEn &&
        !d.sourceText &&
        d.sourceTextEn) ||
        (!last.sourceText &&
          last.sourceTextEn &&
          d.sourceText &&
          !d.sourceTextEn));
    if (sameItem && complementary && (last.category || last.categoryEn)) {
      for (const k of ["sourceText", "sourceTextEn"])
        last[k] = [...new Set([last[k], d[k]].filter(Boolean))].join("\n");
      last.summary = summarize(last.sourceText);
      last.summaryEn = summarize(last.sourceTextEn, "en");
      for (const k of ["topic", "topicEn", "owner", "ownerEn"])
        last[k] ||= d[k];
      last.sourceSlides = [
        ...new Set([...last.sourceSlides, ...d.sourceSlides]),
      ];
      if (last.status !== d.status) {
        last.status = "";
        last.confidence = "review";
      }
      last.recommended = last.recommended || d.recommended;
    } else result.push(d);
  }
  return result;
}
export function applyPreparedAgenda(meeting, drafts, selections) {
  const updates = [];
  const ids = new Set();
  selections.forEach(({ index, issueId }) => {
    const draft = drafts[index];
    if (!draft) throw Error("議題選擇不正確");
    if (ids.has(issueId)) throw Error("同一個既有議題只能連結一次，請調整連結");
    ids.add(issueId);
    const old = meeting.entries.find((e) => e.issueId === issueId);
    const { recommended, hidden, annex, confidence, ...entry } = draft;
    // When updating an existing agenda, preserve live notes and user-set status/owner.
    updates.push({
      ...entry,
      issueId,
      ...(old
        ? {
            description: old.description,
            descriptionEn: old.descriptionEn || "",
            note: old.note,
            noteEn: old.noteEn || "",
            status: old.status,
            owner: old.owner || entry.owner,
            ownerEn: old.ownerEn || entry.ownerEn,
          }
        : {}),
    });
  });
  if (!updates.length) throw Error("請至少選擇一個議題");
  const result = meeting.entries.map(
    (e) => updates.find((u) => u.issueId === e.issueId) || e,
  );
  for (const e of updates)
    if (!result.some((x) => x.issueId === e.issueId)) result.push(e);
  meeting.entries = result;
  return updates;
}
export function presentationMetadata(slides) {
  const text = slides
    .slice(0, 3)
    .map((s) => s.text || "")
    .join("\n");
  const number = Number(
    text
      .match(/第\s*(\d+)\s*次|Weekly\s*Meeting\s*#?\s*(\d+)/i)
      ?.slice(1)
      .find(Boolean) || 0,
  );
  let date = "";
  const zh = text.match(/(\d{3,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (zh) {
    let y = Number(zh[1]);
    if (y < 1911) y += 1911;
    date = `${y}-${zh[2].padStart(2, "0")}-${zh[3].padStart(2, "0")}`;
  } else {
    const en = text.match(
      /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i,
    );
    if (en) {
      const months = [
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
      ];
      date = `${en[3]}-${String(months.indexOf(en[2].toLowerCase()) + 1).padStart(2, "0")}-${en[1].padStart(2, "0")}`;
    }
  }
  if (date) {
    const parsed = new Date(date + "T12:00:00Z");
    if (
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    )
      date = "";
  }
  return { number: number >= 1 && number <= 999999 ? number : 0, date };
}
