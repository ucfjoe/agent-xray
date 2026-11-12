import { recoverSession } from "./recover-session.js";
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
    if (
      snapshot.pathScopeVersion !== 2 &&
      Number.isSafeInteger(snapshot.identity?.throughSeq)
    ) {
      try {
        const replay = await readSessionReview(services, sessionId, {
          throughSeq: snapshot.identity.throughSeq,
        });
        snapshot = recoverSession(snapshot, replay);
      } catch {
        snapshot = {
          ...snapshot,
          notices: [
            ...(snapshot.notices ?? []),
            "Some previously omitted session edits could not be recovered from host history.",
          ],
        };
      }
    }
  } else {
    const current = await readSessionReview(services, sessionId);
    if (scope === "workspace")
      return readWorkspaceReview({
        sessionId,
        workspaceId: current.workspaceId,
        root: current.root,
      });
    const retained = await store.get(sessionId, current.snapshotId);
    snapshot = retained ? recoverSession(retained, current) : current;
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
