import { pathLabel } from "./paths.js";
import { projectCheck, checksForHunk } from "../core/verification.js";
import { impactFigure, traceFigure, layoutGraph } from "./figures.js";
import { projectReview, newestFirst } from "../core/model.js";
import { escape as e, renderDiff } from "./diff.js";
const icons = { story: "≋", changes: "±", map: "◇", journey: "↳" };
const basename = (p) => p.split("/").at(-1);
const dir = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const delta = (h) =>
  `<span class="delta"><span>+${h.added ?? 0}</span><span>−${h.deleted ?? 0}</span></span>`;
const button = (id, title, body, cls = "") =>
  `<button class="${cls}" data-select="${e(id)}" title="${e(title)}">${body}</button>`;
function fileRow(h, state, narrative = false, paths = []) {
  return button(
    h.id,
    h.path,
    `<span class="file-icon">${/test|spec/.test(h.path) ? "✓" : "⌘"}</span><span class="file-label"><strong>${e(narrative ? (h.title ?? basename(h.path)) : basename(h.path))}</strong><small>${e(narrative ? pathLabel(h.path, paths) : [h.symbol, dir(pathLabel(h.path, paths))].filter(Boolean).join(" · "))}</small></span>${delta(h)}`,
    `file-row ${narrative ? "narrative" : ""} ${state.selected === h.id ? "selected" : ""}`,
  );
}
function story(snapshot, p, state) {
  if (!p.hunks.length)
    return empty(
      snapshot.scope === "session"
        ? "No recorded changes yet"
        : "No matching changes",
      "Recorded edits will appear here. You can inspect current Git changes in Workspace, or explore an example from the source menu.",
    );
  return (
    impactFigure(snapshot, p.hunks) +
    `<div class="section-heading"><span>CHANGE STORY</span><span>${p.groups.length} groups</span></div>` +
    p.groups
      .map(
        (g, i) =>
          `<section class="story-group"><div class="story-title"><span class="step-number">${String(i + 1).padStart(2, "0")}</span><div><h2>${e(g.name === "Not yet linked" ? "Changes awaiting context" : g.name)}</h2><p>${new Set(g.hunks.map((h) => h.path)).size} files · ${g.hunks.length} changes</p></div></div><div class="story-files">${g.hunks
            .map((h) =>
              fileRow(
                h,
                state,
                true,
                p.hunks.map((h) => h.path),
              ),
            )
            .join("")}</div></section>`,
      )
      .join("")
  );
}
function explorer(p, state) {
  return (
    `<div class="explorer-tools"><label><span>Group</span><select id="group">${[
      ["task", "Objective"],
      ["capability", "Business capability"],
      ["module", "Module"],
      ["risk", "Review priority"],
      ["milestone", "Milestone"],
    ]
      .map(
        ([v, n]) =>
          `<option value="${v}" ${state.groupBy === v ? "selected" : ""}>${n}</option>`,
      )
      .join("")}</select></label></div>` +
    (p.hunks.length
      ? p.groups
          .map(
            (g) =>
              `<details class="file-group" open><summary>${e(g.name)} <span>${g.hunks.length}</span></summary>${g.hunks
                .map((h) =>
                  fileRow(
                    h,
                    state,
                    false,
                    p.hunks.map((h) => h.path),
                  ),
                )
                .join("")}</details>`,
          )
          .join("")
      : empty("No matching changes", "Try another search or objective."))
  );
}
function journey(snapshot, p, state) {
  const ids = new Set(p.hunks.map((h) => h.id));
  const events = newestFirst(snapshot.events).filter(
    (ev) => !state.objectiveId || ev.objectiveId === state.objectiveId,
  );
  if (!events.length)
    return empty(
      "No recorded activity",
      "Workspace diffs have no agent timeline. Select Session to review recorded actions.",
    );
  return `<div class="section-heading"><span>SESSION JOURNEY</span><span>${events.length} events · Newest first</span></div><ol class="timeline">${events
    .map((ev) => {
      const linked = (ev.hunkIds ?? []).filter((id) => ids.has(id));
      return `<li class="timeline-event ${e(ev.type)}"><span class="timeline-dot"></span><div class="event-meta"><span>${e(ev.type)}</span><time>${Number.isFinite(ev.time) ? new Date(ev.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Time unavailable"}</time></div><h2>${e(ev.title)}</h2>${ev.description ? `<p class="event-description">${e(ev.description)}</p>` : ""}<div>${linked
        .map((id) => {
          const h = snapshot.hunks.find((h) => h.id === id);
          return button(
            id,
            h.path,
            e(
              pathLabel(
                h.path,
                snapshot.hunks.map((h) => h.path),
              ),
            ),
            "event-link " + (state.selected === id ? "selected" : ""),
          );
        })
        .join(
          "",
        )}</div>${ev.status ? `<small class="badge ${e(ev.status)}">${e(ev.status)}</small>` : ""}</li>`;
    })
    .join("")}</ol>`;
}
function map(snapshot, p, state) {
  const relations = snapshot.relationships.filter((r) => r.kind === "module");
  const names = [
    ...new Set(
      p.hunks.map(
        (h) => relations.find((r) => r.hunkId === h.id)?.target ?? h.path,
      ),
    ),
  ];
  if (!names.length)
    return empty(
      "No changes to map",
      "Recorded changes or workspace changes will appear as selectable nodes.",
    );
  const deps = (snapshot.dependencies ?? []).filter(
    (d) => names.includes(d.from) || names.includes(d.to),
  );
  for (const h of p.hunks.filter((h) => h.symbol))
    deps.push({
      from: relations.find((r) => r.hunkId === h.id)?.target ?? h.path,
      to: h.path + "::" + h.symbol,
      kind: "containment",
    });
  const nodes = [
    ...new Set([...names, ...deps.flatMap((d) => [d.from, d.to])]),
  ].slice(0, 40);
  // Match the map grid's actual available pane width.
  const compact =
    (globalThis.innerWidth < 760
      ? globalThis.innerWidth
      : globalThis.innerWidth - Math.max(300, globalThis.innerWidth * 0.4)) -
      32 <
    650;
  const { positions, width, height, edges } = layoutGraph(nodes, deps, compact);
  const selectedNodes = new Set(
    nodes.filter((n) =>
      p.hunks.some(
        (h) =>
          h.id === state.selected &&
          ((relations.find((r) => r.hunkId === h.id)?.target ?? h.path) === n ||
            (h.symbol && h.path + "::" + h.symbol === n)),
      ),
    ),
  );
  const incident = (d) => selectedNodes.has(d.from) || selectedNodes.has(d.to);
  return `<div class="map-toolbar"><span>${nodes.length} nodes · ${edges.filter((d) => d.kind !== "containment").length} dependencies</span><div><button data-action="zoom-out" aria-label="Zoom out">−</button><button data-action="fit">Fit map</button><button data-action="zoom-in" aria-label="Zoom in">+</button></div></div><div class="graph-scroll" tabindex="0" aria-label="Dependency map"><svg class="graph" style="width:${state.mapZoom ?? 100}%;min-width:${Math.round((width * 0.92 * (state.mapZoom ?? 100)) / 100)}px${compact ? `;max-width:${(390 * (state.mapZoom ?? 100)) / 100}px` : ""}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Changed modules and recorded dependencies"><defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker><marker id="arrow-selected" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path class="selected-arrow" d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>${edges
    .map(
      (d) =>
        `<path class="graph-edge ${d.kind === "containment" ? "containment" : ""} ${incident(d) ? "selected" : ""}" d="${d.path}" marker-end="url(#${incident(d) ? "arrow-selected" : "arrow"})"><title>${e(d.from)} ${d.kind === "containment" ? "contains" : "depends on"} ${e(d.to)}</title></path>`,
    )
    .join("")}${nodes
    .map((n) => {
      const pos = positions.get(n);
      const hunks = p.hunks.filter(
        (h) =>
          (relations.find((r) => r.hunkId === h.id)?.target ?? h.path) === n ||
          (h.symbol && h.path + "::" + h.symbol === n),
      );
      const selected = hunks.some((h) => h.id === state.selected);
      return `<g class="graph-node ${selected ? "selected" : ""}" ${hunks.length ? `data-select="${e(hunks[0].id)}" tabindex="0" role="button" aria-label="Inspect ${e(n)}"` : ""} transform="translate(${pos.x},${pos.y})"><rect width="230" height="${pos.height}" rx="9"/><text x="14" y="26">${e(n.length > 28 ? "…" + n.slice(-27) : n)}</text><text class="node-subtitle" x="14" y="48">${hunks.length ? `${hunks.length} ${hunks.length === 1 ? "change" : "changes"}` : "Dependency"}</text></g>`;
    })
    .join(
      "",
    )}</svg></div><p class="map-note">A → B: A depends on B. Dashed edges: A contains B. Highlighted arrows connect the selected change. Up to 40 nodes; use the list for all changes. ${edges.length ? "Arrows show " + (snapshot.source === "demo" ? "illustrative" : "observed static") + " dependencies." : "No dependency edges available. Nodes show changed files or directory groups, not an inferred dependency graph."}</p><details class="map-list"><summary>Browse map as a list</summary>${p.hunks
    .map((h) =>
      fileRow(
        h,
        state,
        false,
        p.hunks.map((h) => h.path),
      ),
    )
    .join("")}</details>`;
}
function empty(title, body) {
  return `<div class="empty"><span class="empty-symbol">◇</span><h2>${e(title)}</h2><p>${e(body)}</p></div>`;
}
function detail(snapshot, h, state, p) {
  if (!h)
    return `<section class="inspector">${empty("Choose a change", "Select a story step, file, map node or timeline event to inspect its code and evidence.")}</section>`;
  const relationships = snapshot.relationships.filter((r) => r.hunkId === h.id);
  const checks = checksForHunk(snapshot, h);
  const action = snapshot.events.find((ev) => ev.id === h.eventId);
  const index = p.hunks.findIndex((x) => x.id === h.id);
  return `<section class="inspector" aria-label="Change inspector"><div class="inspector-title"><button class="back-button" data-action="back" aria-label="Back to changes">←</button><span class="file-icon">⌘</span><div class="file-label"><h2>${e(basename(h.path))}</h2><small title="${e(h.path)}">${e(dir(h.path) || "Repository root")}</small></div>${delta(h)}</div>${traceFigure(snapshot, h)}<div class="diff-toolbar"><span>${h.rangeKind === "excerpt" ? "Recorded excerpt · offsets unavailable" : `Lines ${h.newStart ?? 1}–${(h.newStart ?? 1) + Math.max(0, h.lines.filter((l) => /^[ +]/.test(l)).length - 1)}`}</span><div class="segmented"><button data-layout="unified" aria-pressed="${state.layout === "unified"}">Unified</button><button data-layout="split" aria-pressed="${state.layout === "split"}">Split</button></div></div><div class="code-scroll" tabindex="0" aria-label="Code diff">${renderDiff(h, state.layout, state.selectedLine)}</div><div class="hunk-controls"><span>Change ${index + 1} of ${p.hunks.length}</span><button data-action="previous" aria-label="Previous change" ${index <= 0 ? "disabled" : ""}>↑</button><button data-action="next" aria-label="Next change" ${index >= p.hunks.length - 1 ? "disabled" : ""}>↓</button><button data-action="copy">${h.rangeKind === "excerpt" ? "Copy excerpt" : "Copy patch"}</button></div><details class="context-card" open><summary><span>◈</span> Why this changed</summary>${
    relationships.some((r) => r.kind === "task")
      ? relationships
          .filter((r) => r.kind === "task")
          .map(
            (r) =>
              `<div class="evidence-row"><span class="badge">${e(r.provenance)}</span><div><strong>${e(r.kind === "task" ? (snapshot.objectives.find((o) => o.id === r.target)?.title ?? r.target) : r.target)}</strong><p>${e(r.rationale ?? `${r.kind} relationship from recorded context`)}</p><small>Source ${e(r.sourceId)}</small></div></div>`,
          )
          .join("")
      : "<p>No task or intent evidence is linked to this change. Repository differences alone do not establish why an agent changed it.</p>"
  }<div class="relationship-tags">${relationships
    .filter((r) => r.kind !== "task")
    .map(
      (r) =>
        `<span class="badge" title="${e(r.provenance + ": " + (r.rationale ?? r.kind))}">${e(r.kind)} · ${e(r.target)}</span>`,
    )
    .join(
      "",
    )}</div>${action ? `<div class="action-source"><span>Recorded action</span><strong>${e(action.title)}</strong></div>` : ""}</details><details class="context-card" open><summary><span>✓</span> Verification</summary>${checks.length ? checks.map((c) => `<div class="check"><span class="badge ${e(c.status)}">${e(c.status)}</span>${c.toolOutcome === "failed" ? '<span class="badge failed">Tool failed</span>' : ""}<code>${e(c.command)}</code><pre>${e(c.output)}</pre><p>${e(c.association ?? (c.provenance === "demo" ? "Illustrative result, not an executed test." : ""))}</p></div>`).join("") : "<p>No verification is linked to this exact change. Session commands are available below; they are not automatically proof this code passed.</p>"}</details></section>`;
}
export function render(
  snapshot,
  state,
  { source, scenarios, scenario, error, pending, history },
) {
  const p = projectReview(snapshot, {
    ...state,
    groupBy: state.view === "story" ? "task" : state.groupBy,
  });
  const selected = p.hunks.find((h) => h.id === state.selected);
  const views = {
    story: () => story(snapshot, p, state),
    changes: () =>
      explorer(p, state) +
      (p.fileOnly.length
        ? `<section class="file-group metadata-files"><h2>Other changed files</h2>${p.fileOnly.map((f) => `<details><summary>${e(f.path)}</summary><p>${e(f.kind ?? "No text difference")} · Text preview unavailable for this file.</p></details>`).join("")}</section>`
        : ""),
    map: () => map(snapshot, p, state),
    journey: () => journey(snapshot, p, state),
  };
  return `<header class="app-header"><div class="brand"><span class="brand-mark">⌁</span><strong>Agent X-Ray</strong></div><div class="header-actions"><select id="source" aria-label="Review source"><option value="session" ${source === "session" ? "selected" : ""}>Session</option><option value="workspace" ${source === "workspace" ? "selected" : ""}>Workspace</option><option value="demo" ${source === "demo" ? "selected" : ""}>Examples</option></select><button data-action="refresh" class="icon-button" aria-label="Refresh review">↻</button></div></header>${source === "demo" ? `<div class="demo-strip"><span>EXAMPLE</span><select id="scenario" aria-label="Example scenario">${scenarios.map((s) => `<option value="${e(s.id)}" ${s.id === scenario ? "selected" : ""}>${e(s.title)}</option>`).join("")}</select><small>Fictional data</small></div>` : ""}<section class="overview"><div class="eyebrow"><span>${source === "demo" ? "DESIGN SANDBOX" : snapshot.scope === "workspace" ? "WORKSPACE OVERVIEW" : "SESSION OVERVIEW"}</span><span class="activity"><i></i>${e(snapshot.activity ?? "Review")}</span></div><h1>${e(snapshot.goal ?? snapshot.title)}</h1><div class="summary-metrics"><span><b>${p.counts.files}</b> files</span><span><b>${p.counts.hunks}</b> changes</span><span><b>${p.counts.objectives}</b> objectives</span>${delta(p.counts)}</div>${snapshot.events.some((ev) => ev.type === "action") ? `<p class="action-progress">${snapshot.events.filter((ev) => ev.type === "action" && ev.status === "completed").length} of ${snapshot.events.filter((ev) => ev.type === "action").length} recorded actions completed · ${snapshot.events.filter((ev) => ev.status === "failed").length} failed</p>` : ""}${source === "session" ? '<p class="scope-summary">Recorded edits across folders · some shell changes may be unavailable.</p>' : source === "workspace" ? '<p class="scope-summary">Current Git changes in the opened repository · includes edits outside this session.</p>' : ""}</section>${error ? `<div class="notice error" role="alert">${e(error)}</div>` : ""}${pending ? `<button class="update-banner" data-action="catchup">New activity available <span>Catch up →</span></button>` : ""}<div class="view-bar" role="tablist" aria-label="Review views">${Object.keys(
    views,
  )
    .map(
      (v) =>
        `<button role="tab" aria-label="${{ story: "Story", changes: "Changes", map: "Map", journey: "Journey" }[v]}" aria-selected="${state.view === v}" data-view="${v}"><span>${icons[v]}</span>${{ story: "Story", changes: "Changes", map: "Map", journey: "Journey" }[v]}</button>`,
    )
    .join(
      "",
    )}</div><div class="filter-bar"><input id="search" type="search" placeholder="Find a file or symbol…" aria-label="Find changed files" value="${e(state.query)}"><select id="objective" aria-label="Filter objective"><option value="">All objectives</option>${newestFirst(
    snapshot.objectives,
    snapshot.events,
  )
    .map(
      (o) =>
        `<option value="${e(o.id)}" ${state.objectiveId === o.id ? "selected" : ""}>${e(o.title)}</option>`,
    )
    .join("")}</select></div>${
    source === "session"
      ? `<div class="history-bar"><select id="history" aria-label="Snapshot"><option value="">Latest observed</option>${newestFirst(
          history ?? [],
        )
          .map(
            (h) =>
              `<option value="${e(h.id)}" ${state.historyId === h.id ? "selected" : ""}>${new Date(h.time).toLocaleString()} · ${h.count} changes</option>`,
          )
          .join(
            "",
          )}</select><button data-action="follow" aria-pressed="${state.follow}">◉ Follow agent</button></div>`
      : ""
  }<div class="review-body ${state.detail && selected ? "show-detail" : ""}" data-view="${state.view}"><section class="navigator" aria-label="${e(state.view)} view">${views[state.view]()}</section>${detail(snapshot, selected, state, p)}</div>${
    snapshot.checks.length && source !== "demo"
      ? `<details class="session-commands"><summary>Session command evidence <span>${snapshot.checks.length}</span></summary>${newestFirst(
          snapshot.checks,
          snapshot.events,
        )
          .map((c) => projectCheck(snapshot, c))
          .map(
            (c) =>
              `<article class="check"><span class="badge ${e(c.status)}">${e(c.status)}</span>${c.toolOutcome === "failed" ? '<span class="badge failed">Tool failed</span>' : ""}<code>${e(c.command)}</code><pre>${e(c.output)}</pre><p>${e(c.association)}</p></article>`,
          )
          .join("")}</details>`
      : ""
  }<footer><span>${source === "demo" ? "Illustrative examples" : snapshot.scope === "workspace" ? "Workspace scope · authorship unknown" : "Session edits across folders"}</span><details><summary>Scope & limitations</summary>${snapshot.notices.map((n) => `<p>${e(n)}</p>`).join("")}<p>${snapshot.files.filter((f) => ["binary", "oversized", "unavailable"].includes(f.kind)).length} files without text preview.</p>${(snapshot.diagnostics ?? []).map((d) => `<p>${e(d.path)}: ${e(d.reason)}</p>`).join("")}</details></footer>`;
}
