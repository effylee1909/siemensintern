// PDF content-stream order need not equal reading order. Group by visible baselines.
export function textFromItems(items) {
  const valid = items.filter(
    (i) =>
      typeof i.str === "string" && i.str.trim() && Array.isArray(i.transform),
  );
  if (!valid.length) return items.map((i) => i.str || "").join("\n");
  const sorted = valid
    .map((i) => ({
      text: i.str,
      x: i.transform[4],
      y: i.transform[5],
      h: Math.max(1, Math.hypot(i.transform[2], i.transform[3])),
      width: i.width || 0,
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const item of sorted) {
    let line = lines
      .slice(-3)
      .find(
        (l) =>
          Math.abs(l.y - item.y) <= Math.max(2, Math.min(l.h, item.h) * 0.3),
      );
    if (!line) {
      line = { y: item.y, h: item.h, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((l) =>
      l.items
        .sort((a, b) => a.x - b.x)
        .map((i) => i.text)
        .join(" "),
    )
    .join("\n");
}
