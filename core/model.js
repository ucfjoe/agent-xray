const unique = (items) => [...new Map(items.map((x) => [x.id, x])).values()];
export function normalizeSnapshot(input = {}) {
  const snapshot = structuredClone({
    source: "live",
    sessionId: "",
    workspaceId: "",
    snapshotId: "current",
    title: "Session changes",
    scope: "session",
    capturedAt: Date.now(),
    hunks: [],
    files: [],
    objectives: [],
    events: [],
    relationships: [],
    checks: [],
    dependencies: [],
    notices: [],
    ...input,
  });
  if (
    snapshot.source !== "demo" &&
    snapshot.relationships.some((r) => r.provenance === "demo")
  )
    throw new Error("demo evidence cannot enter live snapshots");
  snapshot.hunks = unique(snapshot.hunks);
  snapshot.objectives = unique(snapshot.objectives);
  snapshot.events = unique(snapshot.events).sort(
    (a, b) => (a.seq ?? 0) - (b.seq ?? 0),
  );
  snapshot.files = unique([
    ...snapshot.files.map((f) => ({ ...f, id: f.id ?? f.path })),
    ...snapshot.hunks
      .filter((h) => !snapshot.files.some((f) => f.path === h.path))
      .map((h) => ({ id: h.path, path: h.path })),
  ]);
  for (const h of snapshot.hunks) {
    h.lines ??= [];
    h.added = h.lines.filter((l) => l.startsWith("+")).length;
    h.deleted = h.lines.filter((l) => l.startsWith("-")).length;
  }
  return snapshot;
}
export function projectReview(
  snapshot,
  { objectiveId = "", groupBy = "task", query = "" } = {},
) {
  const targets = (h, kind) =>
    snapshot.relationships.filter((r) => r.hunkId === h.id && r.kind === kind);
  const hunks = snapshot.hunks.filter(
    (h) =>
      (!objectiveId ||
        targets(h, "task").some((r) => r.target === objectiveId)) &&
      (!query ||
        [h.path, h.title, h.symbol]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  const groups = new Map();
  for (const h of hunks) {
    const relations = targets(h, groupBy);
    const names = relations.length
      ? relations.map((r) =>
          groupBy === "task"
            ? (snapshot.objectives.find((o) => o.id === r.target)?.title ??
              r.target)
            : r.target,
        )
      : [
          groupBy === "module"
            ? h.path.includes("/")
              ? h.path.slice(0, h.path.lastIndexOf("/"))
              : "Repository root"
            : "Not yet linked",
        ];
    for (const name of new Set(names)) {
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(h);
    }
  }
  const ids = new Set(hunks.map((h) => h.id));
  const fileOnly = objectiveId
    ? []
    : snapshot.files.filter(
        (f) =>
          !snapshot.hunks.some((h) => h.path === f.path) &&
          (!query || f.path.toLowerCase().includes(query.toLowerCase())),
      );
  return {
    fileOnly,
    hunks,
    groups: [...groups].map(([name, hunks]) => ({ name, hunks })),
    counts: {
      hunks: hunks.length,
      files: new Set([
        ...hunks.map((h) => h.path),
        ...fileOnly.map((f) => f.path),
      ]).size,
      objectives: new Set(
        snapshot.relationships
          .filter(
            (r) =>
              r.kind === "task" &&
              ids.has(r.hunkId) &&
              snapshot.objectives.some((o) => o.id === r.target),
          )
          .map((r) => r.target),
      ).size,
      added: hunks.reduce((n, h) => n + h.added, 0),
      deleted: hunks.reduce((n, h) => n + h.deleted, 0),
    },
  };
}
export function fromExample(scenario) {
  const objectives = [...new Set(scenario.changes.map((h) => h.task))].map(
    (title, i) => ({ id: "task-" + i, title }),
  );
  const relationships = [];
  const hunks = scenario.changes.map((h) => {
    for (const kind of ["task", "capability", "module", "risk", "milestone"])
      relationships.push({
        hunkId: h.id,
        kind,
        target:
          kind === "task"
            ? objectives.find((o) => o.title === h.task).id
            : h[kind],
        provenance: "demo",
        sourceId: "event-" + h.id,
        rationale: h.evidence,
      });
    return {
      ...h,
      title: h.story,
      oldStart: h.oldLine,
      newStart: h.newLine,
      eventId: "event-" + h.id,
    };
  });
  return normalizeSnapshot({
    source: "demo",
    sessionId: "demo:" + scenario.id,
    workspaceId: "example-project",
    snapshotId: scenario.id,
    title: scenario.title,
    goal: scenario.goal,
    scope: "demo",
    hunks,
    objectives,
    relationships,
    events: scenario.changes.map((h, i) => ({
      id: "event-" + h.id,
      seq: i,
      time: Date.UTC(2026, 0, 1, 10, i * 2),
      type: "edit",
      title: h.action,
      objectiveId: objectives.find((o) => o.title === h.task).id,
      hunkIds: [h.id],
      provenance: "demo",
    })),
    checks: scenario.changes.map((h) => ({
      id: "check-" + h.id,
      hunkIds: [h.id],
      status: h.check.status.toLowerCase(),
      command: h.check.command,
      output: h.check.output,
      provenance: "demo",
      snapshotId: scenario.id,
    })),
    dependencies: scenario.modules.flatMap((m) =>
      m.dependsOn.map((target) => ({
        from: m.name,
        to: target,
        provenance: "demo",
      })),
    ),
    notices: ["Fictional example. Actions and results are illustrative."],
  });
}
