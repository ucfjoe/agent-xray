import { escape as e } from "./diff.js";
export function impactFigure(snapshot, hunks) {
  const files = new Map();
  for (const h of hunks) {
    const row = files.get(h.path) ?? {
      path: h.path,
      id: h.id,
      added: 0,
      deleted: 0,
    };
    row.added += h.added;
    row.deleted += h.deleted;
    files.set(h.path, row);
  }
  const rows = [...files.values()]
    .sort((a, b) => b.added + b.deleted - (a.added + a.deleted))
    .slice(0, 6);
  if (!rows.length) return "";
  const max = Math.max(1, ...rows.map((r) => r.added + r.deleted));
  const height = rows.length * 38 + 8;
  return `<figure class="impact-figure"><figcaption><strong>Change footprint</strong><span>Lines added / removed</span></figcaption><svg viewBox="0 0 300 ${height}" role="img" aria-label="Changed lines by file"><title>Change footprint: largest changed files, by added and removed lines</title>${rows
    .map((r, i) => {
      const y = i * 38 + 6;
      return `<g class="impact-row" data-select="${e(r.id)}" tabindex="0" role="button" aria-label="Inspect ${e(r.path)}, ${r.added} added and ${r.deleted} removed"><text x="0" y="${y + 10}" class="impact-label">${e(r.path.split("/").at(-1).slice(0, 33))}</text><text x="298" y="${y + 10}" text-anchor="end" class="impact-value">+${r.added} −${r.deleted}</text><rect class="impact-track" x="0" y="${y + 18}" width="300" height="5" rx="2.5"/><rect class="impact-add" x="0" y="${y + 18}" width="${(r.added / max) * 300}" height="5" rx="2.5"/><rect class="impact-del" x="${(r.added / max) * 300}" y="${y + 18}" width="${(r.deleted / max) * 300}" height="5" rx="2.5"/></g>`;
    })
    .join(
      "",
    )}</svg><p>${snapshot.scope === "session" ? "Recorded edit volume; repeated edits are not a net repository diff." : "Largest changes in this review."}</p></figure>`;
}
export function traceFigure(snapshot, hunk) {
  const task = snapshot.relationships.find(
    (r) => r.hunkId === hunk.id && r.kind === "task",
  );
  const objective = snapshot.objectives.find((o) => o.id === task?.target);
  const action = snapshot.events.find((ev) => ev.id === hunk.eventId);
  const check = snapshot.checks.find((c) => c.hunkIds?.includes(hunk.id));
  const nodes = [
    {
      label: "Intent",
      icon: "◎",
      title: objective?.title ?? "Not linked",
      source: objective ? "User request" : "Unknown",
      action: "trace-intent",
    },
    {
      label: "Action",
      icon: "↳",
      title: action?.title ?? "Not recorded",
      source: action ? "Recorded event" : "Unknown",
      action: "trace-action",
    },
    {
      label: "Code",
      icon: "±",
      title: hunk.path.split("/").at(-1),
      source:
        hunk.rangeKind === "excerpt"
          ? "Recorded excerpt"
          : "Exact changed lines",
      action: "trace-code",
    },
    {
      label: "Verification",
      icon: "✓",
      title: check?.status ?? "Not established",
      source:
        check?.provenance === "demo"
          ? "Illustrative result"
          : check
            ? "Linked evidence"
            : "No exact-change proof",
      action: "trace-check",
    },
  ];
  return `<figure class="trace-figure"><figcaption>Evidence trail <span>${snapshot.source === "demo" ? "Example relationships" : "What connects this change"}</span></figcaption><div class="trace-grid">${nodes.map((n, i) => `<button class="trace-node ${n.source === "Unknown" || n.title === "Not established" ? "unknown" : ""}" data-action="${n.action}" title="${e(n.title)}"><span class="trace-label"><b>${n.icon}</b>${i + 1}. ${n.label}</span><strong>${e(n.title)}</strong><small>${e(n.source)}</small><span class="trace-arrow" aria-hidden="true">→</span></button>`).join("")}</div></figure>`;
}
export function layoutGraph(nodes, edges, compact) {
  const levels = new Map(nodes.map((n) => [n, 0]));
  // Bounded relaxation gives a layered DAG layout. Cycles stay in the last column.
  for (let pass = 0; pass < Math.min(nodes.length, 4); pass++)
    for (const edge of edges) {
      if (levels.has(edge.from) && levels.has(edge.to) && edge.from !== edge.to)
        levels.set(
          edge.to,
          Math.min(3, Math.max(levels.get(edge.to), levels.get(edge.from) + 1)),
        );
    }
  const columns = new Map();
  for (const node of nodes) {
    const level = compact ? 0 : levels.get(node);
    if (!columns.has(level)) columns.set(level, []);
    columns.get(level).push(node);
  }
  const sorted = [...columns.keys()].sort((a, b) => a - b);
  const positions = new Map();
  for (const [col, level] of sorted.entries())
    for (const [row, node] of columns.get(level).entries())
      positions.set(node, { x: 20 + col * 270, y: 28 + row * 108 });
  return {
    positions,
    width: compact ? 310 : Math.max(310, sorted.length * 270 + 20),
    height: Math.max(
      220,
      ...[...columns.values()].map((c) => c.length * 108 + 30),
    ),
  };
}
