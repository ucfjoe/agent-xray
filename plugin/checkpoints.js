import { readSessionReview } from "./dsh-adapter.js";

export async function captureReview({
  services,
  store,
  sessionId,
  seq,
  type,
  signal,
}) {
  const snapshot = await readSessionReview(services, sessionId, {
    throughSeq: seq,
    signal,
  });
  if (signal?.aborted) return;
  if (type === "workspace/changes") {
    const sourceId = sessionId + ":" + seq;
    const event = snapshot.events.find(
      (e) => e.id === sourceId && e.type === "checkpoint",
    );
    if (!event) throw Error("Host turn comparison unavailable");
    const hunks = snapshot.hunks.filter(
      (h) => h.sourceId === sourceId && h.rangeKind === "file",
    );
    const paths = new Set(hunks.map((h) => h.path));
    await store.putCheckpoint(sessionId, seq, {
      sessionId,
      seq,
      event,
      hunks,
      files: snapshot.files.filter((f) => paths.has(f.path)),
      relationships: snapshot.relationships.filter((r) =>
        hunks.some((h) => h.id === r.hunkId),
      ),
      notices: snapshot.notices,
      capturedAt: Date.now(),
    });
  }
  if (!signal?.aborted) await store.put(snapshot);
}

// Additional evidence is projected at read time; the saved aggregate is never rewritten.
export async function enrichSaved(snapshot, store) {
  const result = structuredClone(snapshot);
  const seqs =
    snapshot.checkpointSeqs ??
    snapshot.events.filter((e) => e.type === "checkpoint").map((e) => e.seq);
  let bytes = JSON.stringify(result).length;
  for (const seq of seqs) {
    let saved;
    try {
      saved = await store.getCheckpoint(snapshot.sessionId, seq);
    } catch {
      result.notices.push("A saved turn comparison could not be read.");
      continue;
    }
    if (!saved) continue;
    const additions = saved.hunks.filter(
      (h) => !result.hunks.some((x) => x.id === h.id),
    );
    if (!additions.length) continue;
    bytes += JSON.stringify(saved).length;
    if (bytes > 4000000 || result.hunks.length + additions.length > 1000) {
      result.notices.push("Supplemental history preview limit reached.");
      break;
    }
    result.hunks.push(...additions);
    for (const f of saved.files)
      if (!result.files.some((x) => x.path === f.path)) result.files.push(f);
    if (!result.events.some((e) => e.id === saved.event.id))
      result.events.push(saved.event);
    result.relationships.push(
      ...(saved.relationships ?? []).filter((r) =>
        additions.some((h) => h.id === r.hunkId),
      ),
    );
    result.notices.push(
      "Additional saved turn evidence is shown; the original snapshot is unchanged.",
    );
  }
  result.notices = [...new Set(result.notices)];
  return result;
}
