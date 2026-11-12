// A projection-only repair for previously filtered session evidence. No cache rewrite.
export function recoverSession(saved, replayed) {
  if (
    saved.sessionId !== replayed.sessionId ||
    saved.snapshotId !== replayed.snapshotId
  )
    return structuredClone(saved);
  const result = structuredClone(saved);
  let bytes = JSON.stringify(result).length,
    limited = false;
  const admit = (item) => {
    const size = JSON.stringify(item).length;
    if (bytes + size > 4000000) {
      limited = true;
      return false;
    }
    bytes += size;
    return true;
  };
  for (const key of ["hunks", "files", "objectives", "checks"]) {
    result[key] ??= [];
    for (const item of replayed[key] ?? []) {
      const identity = key === "files" ? "path" : "id";
      if (!result[key].some((x) => x[identity] === item[identity])) {
        if (
          result[key].length >=
          (key === "hunks" || key === "files" ? 1000 : 10000)
        ) {
          limited = true;
          continue;
        }
        if (admit(item)) result[key].push(structuredClone(item));
      }
    }
  }
  const hunkIds = new Set(result.hunks.map((h) => h.id));
  result.events ??= [];
  for (const event of replayed.events ?? []) {
    const existing = result.events.find((e) => e.id === event.id);
    if (existing) {
      const additions = (event.hunkIds ?? []).filter(
        (id) => hunkIds.has(id) && !(existing.hunkIds ?? []).includes(id),
      );
      if (additions.length && admit(additions))
        existing.hunkIds = [...(existing.hunkIds ?? []), ...additions];
    } else if (result.events.length < 10000 && admit(event))
      result.events.push({
        ...structuredClone(event),
        hunkIds: (event.hunkIds ?? []).filter((id) => hunkIds.has(id)),
      });
    else limited = true;
  }
  result.relationships ??= [];
  const key = (r) => JSON.stringify([r.hunkId, r.kind, r.target, r.sourceId]);
  const known = new Set(result.relationships.map(key));
  for (const r of replayed.relationships ?? [])
    if (hunkIds.has(r.hunkId) && !known.has(key(r)) && admit(r)) {
      result.relationships.push(structuredClone(r));
      known.add(key(r));
    }
  result.pathScopeVersion = 2;
  result.notices = [
    ...new Set([
      ...(result.notices ?? []).filter(
        (n) =>
          n !== "An edit outside this workspace was omitted." &&
          !(
            result.files.length && n.startsWith("No recorded file edits found.")
          ),
      ),
      ...(replayed.notices ?? []),
      ...(limited ? ["Recovered session evidence preview limit reached."] : []),
    ]),
  ];
  return result;
}
