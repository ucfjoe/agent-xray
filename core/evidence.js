// These are explicit review heuristics, never statements of agent intent.
export function classifyPaths(snapshot) {
  for (const h of snapshot.hunks) {
    const path = h.path.toLowerCase();
    const sourceId = h.sourceId ?? snapshot.snapshotId;
    const candidates = [
      [
        /auth|session|token|permission/,
        "Account security",
        "Security-sensitive",
      ],
      [/payment|checkout|billing/, "Payments", "Financial flow"],
      [/migrat|schema/, "Data storage", "Schema change"],
      [/catalog|product|search/, "Product discovery", "Behavior change"],
    ];
    const rule = candidates.find(([pattern]) => pattern.test(path));
    if (!rule) continue;
    for (const [kind, target] of [
      ["capability", rule[1]],
      ["risk", rule[2]],
    ]) {
      if (
        snapshot.relationships.some((r) => r.hunkId === h.id && r.kind === kind)
      )
        continue;
      snapshot.relationships.push({
        hunkId: h.id,
        kind,
        target,
        sourceId,
        provenance: "inferred",
        rationale: `Path-based review heuristic from ${h.path}. This is not a declared objective or measured risk.`,
      });
    }
  }
  return snapshot;
}
