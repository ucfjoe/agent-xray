import { readSessionReview } from "./dsh-adapter.js";
import { readWorkspaceReview } from "./workspace.js";
import { enrichSaved } from "./checkpoints.js";

export async function readReview({
  services,
  store,
  sessionId,
  snapshotId,
  scope,
}) {
  let snapshot, latestSnapshotId;
  if (snapshotId && scope !== "workspace") {
    if (!sessionId || !services.sessionQuery)
      throw Error("Session history support is required.");
    const log = await services.sessionQuery.readSession(sessionId);
    if (log.session.id !== sessionId) throw Error("Session identity mismatch");
    snapshot = await store.get(sessionId, snapshotId);
    if (!snapshot)
      throw Object.assign(Error("This historical snapshot is unavailable."), {
        statusCode: 404,
      });
  } else {
    const current = await readSessionReview(services, sessionId);
    if (scope === "workspace")
      return readWorkspaceReview({
        sessionId,
        workspaceId: current.workspaceId,
        root: current.root,
      });
    snapshot = (await store.get(sessionId, current.snapshotId)) ?? current;
    await store.put(current);
    latestSnapshotId = current.snapshotId;
  }
  const history = await store.list(sessionId);
  return {
    ...(await enrichSaved(snapshot, store)),
    history: history.map((s) => ({
      id: s.snapshotId,
      time: s.capturedAt,
      title: s.title,
      count: s.count,
    })),
    latestSnapshotId:
      latestSnapshotId ?? history.at(-1)?.snapshotId ?? snapshot.snapshotId,
  };
}
