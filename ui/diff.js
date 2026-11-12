export const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function diffRows(h) {
  let old = h.oldStart ?? 1,
    next = h.newStart ?? 1;
  return h.lines.map((line) => ({
    kind: line[0] === "+" ? "add" : line[0] === "-" ? "del" : "same",
    old: line[0] === "+" ? "" : old++,
    next: line[0] === "-" ? "" : next++,
    text: line.slice(1),
    sign: line[0],
  }));
}
export function alignedRows(h) {
  const rows = diffRows(h),
    result = [];
  for (let i = 0; i < rows.length; ) {
    if (rows[i].kind === "same") {
      result.push([rows[i], rows[i++]]);
      continue;
    }
    const before = [],
      after = [];
    while (i < rows.length && rows[i].kind !== "same") {
      (rows[i].kind === "del" ? before : after).push(rows[i++]);
    }
    for (let j = 0; j < Math.max(before.length, after.length); j++)
      result.push([before[j], after[j]]);
  }
  return result;
}
export function renderDiff(h, layout) {
  const number = (r, side) =>
    h.rangeKind === "excerpt" ? "·" : (r?.[side] ?? "");
  const cell = (r, side) =>
    r
      ? `<span class="line-number">${number(r, side)}</span><span class="line-sign">${r.sign}</span><code>${escape(r.text) || " "}</code>`
      : "<span></span>";
  if (layout === "split")
    return `<div class="diff-table split-diff"><div class="diff-heading">Before</div><div class="diff-heading">After</div>${alignedRows(
      h,
    )
      .map(
        ([a, b]) =>
          `<div class="code-row ${a?.kind ?? "blank"}">${cell(a, "old")}</div><div class="code-row ${b?.kind ?? "blank"}">${cell(b, "next")}</div>`,
      )
      .join("")}</div>`;
  return `<div class="diff-table">${diffRows(h)
    .map(
      (r) =>
        `<div class="code-row ${r.kind}"><span class="line-number">${number(r, "old")}</span>${cell(r, "next")}</div>`,
    )
    .join("")}</div>`;
}
export function patchText(h) {
  if (h.rangeKind === "excerpt") return h.lines.join("\n");
  return `--- a/${h.path}\n+++ b/${h.path}\n@@ -${h.oldStart},${h.lines.filter((l) => l[0] !== "+").length} +${h.newStart},${h.lines.filter((l) => l[0] !== "-").length} @@\n${h.lines.join("\n")}\n`;
}
