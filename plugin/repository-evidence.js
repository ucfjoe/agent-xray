import { createHash } from "node:crypto";
import { normalizeSnapshot } from "../core/model.js";
import { sessionPath } from "./session-path.js";

export async function enrichRepositoryEvidence(snapshot, store) {
  const result = structuredClone(snapshot);
  const boundary = result.identity?.throughSeq;
  if (!Number.isSafeInteger(boundary) || !store.getRepositoryCaptures)
    return result;
  const records = await store.getRepositoryCaptures(result.sessionId, boundary);
  let bytes = JSON.stringify(result).length;
  for (const record of records) {
    if (record.sessionId !== result.sessionId || record.seq > boundary)
      continue;
    result.notices.push(...(record.notices ?? []));
    const token = createHash("sha256")
      .update(String(record.callId ?? ""))
      .digest("hex")
      .slice(0, 16);
    const eventId = `repository:${record.seq}:${token}`;
    const event = {
      id: eventId,
      seq: record.seq,
      time: record.capturedAt,
      type: "action",
      title: "Observed repository changes during command",
      status: "recorded",
      hunkIds: [],
    };
    for (const [i, observation] of (record.observations ?? []).entries()) {
      result.notices.push(...(observation.notices ?? []));
      for (const [j, h] of (observation.hunks ?? []).entries()) {
        if (
          result.hunks.length >= 1000 ||
          bytes + JSON.stringify(h).length > 4000000
        ) {
          result.notices.push("Repository evidence preview limit reached.");
          break;
        }
        const location = sessionPath(h.path, result.root, result.root);
        if (!location) continue;
        const row = {
          ...h,
          ...location,
          id: `${eventId}:${i}:${j}`,
          eventId,
          sourceId: eventId,
          seq: record.seq,
          snapshotId: result.snapshotId,
          provenance: "observed",
          attribution: "interval-only",
          rationale:
            "Changed between pre-command and post-command repository observations; concurrent edits may come from elsewhere.",
        };
        if (result.hunks.some((x) => x.id === row.id)) continue;
        result.hunks.push(row);
        bytes += JSON.stringify(row).length;
        event.hunkIds.push(row.id);
        result.relationships.push({
          hunkId: row.id,
          kind: "module",
          target: row.path.includes("/")
            ? row.path.slice(0, row.path.lastIndexOf("/"))
            : "Repository root",
          provenance: "observed",
          sourceId: eventId,
          rationale:
            "Directory grouping only; no exclusive author attribution.",
        });
      }
      for (const f of observation.files ?? []) {
        if (
          result.files.length >= 1000 ||
          bytes + JSON.stringify(f).length > 4000000
        )
          break;
        const location = sessionPath(f.path, result.root, result.root);
        if (location && !result.files.some((x) => x.path === location.path)) {
          const row = { ...f, ...location, id: location.path };
          result.files.push(row);
          bytes += JSON.stringify(row).length;
        }
      }
    }
    if (event.hunkIds.length) {
      result.events.push(event);
      result.notices.push(
        "Repository deltas are observations during command intervals, not proof of exclusive agent authorship. They may overlap host checkpoints; totals are recorded observations, not unique net edits.",
      );
    }
  }
  result.notices = [...new Set(result.notices)].filter(
    (n) =>
      !(result.hunks.length && n.startsWith("No recorded file edits found.")),
  );
  return normalizeSnapshot(result);
}
