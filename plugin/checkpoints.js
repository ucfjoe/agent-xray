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
    checkpointSeq: type === "workspace/changes" ? seq : undefined,
  });
  if (signal?.aborted) return;
  if (type === "workspace/changes") {
    const sourceId = sessionId + ":" + seq;
    const event = snapshot.events.find(
      (e) => e.id === sourceId && e.type === "checkpoint",
    );
    if (!event || snapshot.capture?.complete === false)
      throw Error("Host turn comparison unavailable or incomplete");
    const hunks = snapshot.hunks.filter(
      (h) => h.sourceId === sourceId && h.rangeKind === "file",
    );
    await store.putCheckpoint(sessionId, seq, {
      sessionId,
      seq,
      event,
      hunks,
      files: snapshot.files,
      relationships: snapshot.relationships.filter((r) =>
        hunks.some((h) => h.id === r.hunkId),
      ),
      notices: snapshot.notices,
      capturedAt: Date.now(),
    });
  }
  if (signal?.aborted) return;
  const aggregate =
    type === "workspace/changes"
      ? await readSessionReview(services, sessionId, {
          throughSeq: seq,
          signal,
        })
      : snapshot;
  if (!signal?.aborted) await store.put(aggregate);
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
    const files = saved.files.filter(
      (f) => !result.files.some((x) => x.path === f.path),
    );
    const existingEvent = result.events.find((e) => e.id === saved.event.id);
    if (!additions.length && !files.length && existingEvent) continue;
    bytes += JSON.stringify(saved).length;
    if (bytes > 4000000 || result.hunks.length + additions.length > 1000) {
      result.notices.push("Supplemental history preview limit reached.");
      break;
    }
    result.hunks.push(...additions);
    for (const f of saved.files)
      if (!result.files.some((x) => x.path === f.path)) result.files.push(f);
    if (!existingEvent) result.events.push(saved.event);
    else
      existingEvent.hunkIds = [
        ...new Set([...(existingEvent.hunkIds ?? []), ...saved.event.hunkIds]),
      ];
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
