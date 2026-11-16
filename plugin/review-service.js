import { enrichRepositoryEvidence } from "./repository-evidence.js";
import { analyzeSessionDependencies } from "../core/session-dependencies.js";
import { recoverSession } from "./recover-session.js";
import { readSessionReview } from "./dsh-adapter.js";
import { readWorkspaceReview } from "./workspace.js";
import { enrichSaved } from "./checkpoints.js";
import { classifyPaths } from "../core/evidence.js";

export async function readReview({
  services,
  store,
  sessionId,
  snapshotId,
  scope,
}) {
  services = {
    ...services,
    writeCheckpoint: (id, seq, value) => store.putCheckpoint(id, seq, value),
  };
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
    if (snapshot.derivationVersion === undefined)
      snapshot = {
        ...snapshot,
        notices: [
          ...new Set([
            ...(snapshot.notices ?? []),
            "This saved review predates derived objectives; it is shown as recorded.",
          ]),
        ],
      };
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
    // Never merge across derivation generations: the saved snapshot's raw message
    // objectives would sit beside the derived one for the same turn and count twice.
    snapshot =
      retained && retained.derivationVersion === current.derivationVersion
        ? recoverSession(retained, current)
        : retained
          ? {
              ...current,
              notices: [
                ...new Set([
                  ...(current.notices ?? []),
                  "A saved review from before derived objectives was rebuilt from recorded history.",
                ]),
              ],
            }
          : current;
    await store.put(current);
    latestSnapshotId = current.snapshotId;
  }
  const history = await store.list(sessionId);
  const enriched = await enrichRepositoryEvidence(
    await enrichSaved(snapshot, store),
    store,
  );
  // Perspectives are applied here, not in the adapter: checkpoint recovery and
  // repository evidence both add hunks after the session read returns, and a
  // change without a perspective is a silent gap in every group count.
  const analysed = classifyPaths({
    ...enriched,
    ...analyzeSessionDependencies(enriched),
  });
  return {
    ...analysed,
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
