// Project file-level evidence onto the directory groups actually drawn by the map.
export function mapDependencies(snapshot, hunks) {
  const modules = new Map(
    (snapshot.relationships ?? [])
      .filter((r) => r.kind === "module")
      .map((r) => [r.hunkId, r.target]),
  );
  const groups = new Map(
    hunks.map((h) => [h.path, modules.get(h.id) ?? h.path]),
  );
  const names = new Set(groups.values());
  return (snapshot.dependencies ?? [])
    .filter(
      (d) =>
        d.resolution !== "unresolved" &&
        (groups.has(d.from) ||
          groups.has(d.to) ||
          names.has(d.from) ||
          names.has(d.to)),
    )
    .map((d) => ({
      ...d,
      evidenceFrom: d.from,
      evidenceTo: d.to,
      from: groups.get(d.from) ?? d.from,
      to: groups.get(d.to) ?? d.to,
    }));
}
