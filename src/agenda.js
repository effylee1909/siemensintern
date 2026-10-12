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
    .split(language === "zh" ? /(?<=[。！？；])|\n+/ : /(?<=[.!?;])\s+|\n+/)
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
          /actionowner|requiredby|pic|負責人|後續待辦/.test(s),
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
        const closed = /closed|關閉|merged|合併/i.test(rawStatus),
          blocked = /pending|await|待協調/i.test(rawStatus);
        drafts.push({
          topic: shortTitle(title.zh, "zh") || "",
          topicEn: shortTitle(title.en, "en") || "",
          summary: summarize(body.zh),
          summaryEn: summarize(body.en, "en"),
          description: "",
          descriptionEn: "",
          note: "",
          noteEn: "",
          owner: responsible.zh,
          ownerEn: responsible.en,
          category: category.zh || "議題",
          categoryEn: category.en || "Agenda",
          status: closed ? "closed" : blocked ? "blocked" : "open",
          sourceText: body.zh,
          sourceTextEn: body.en,
          sourceSlides: [slide.number],
          sourcePresentationId: presentationId,
          sourceFile: fileName,
          sourceItem: item >= 0 ? row[item] || "" : "",
          recommended: !slide.hidden && !slide.annex && !closed,
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
        category: category.zh || "其他議題",
        categoryEn: category.en || "Other topics",
        status: "open",
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
    const sameTitle =
      last &&
      ((d.topic && normalize(d.topic) === normalize(last.topic)) ||
        (d.topicEn && normalize(d.topicEn) === normalize(last.topicEn)));
    const sharedTerms =
      last &&
      [
        ...(last.topic + " " + last.topicEn).matchAll(
          /\b[A-Z][A-Z0-9-]{2,}\b/g,
        ),
      ].some((t) => (d.topic + " " + d.topicEn).includes(t[0]));
    const chartPair =
      last &&
      complementary &&
      !last.sourceItem &&
      !d.sourceItem &&
      last.confidence === "review" &&
      d.confidence === "review" &&
      sharedTerms &&
      last.category === d.category &&
      last.hidden === d.hidden &&
      d.sourceSlides[0] === last.sourceSlides.at(-1) + 1;
    if (
      (sameItem && complementary) ||
      chartPair ||
      (sameTitle && last?.category === d.category && last?.hidden === d.hidden)
    ) {
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
        last.status = "open";
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
