import { newestFirst } from "./model.js";

// Review IDs, tool success and hunk links are not proof of tested content.
// No live structured-test adapter is supported yet; fail closed even for legacy metadata.
export function projectCheck(snapshot, check, hunk) {
  const demo = snapshot.source === "demo" && check.provenance === "demo";
  const contextual = Boolean(
    hunk &&
      ((Array.isArray(check.hunkIds) && check.hunkIds.includes(hunk.id)) ||
        (hunk.eventId && check.eventId === hunk.eventId)),
  );
  return {
    ...check,
    status:
      demo && ["passed", "failed", "pending"].includes(check.status)
        ? check.status
        : "not verified",
    testOutcome: demo ? check.status : "unknown",
    toolOutcome:
      !demo && (check.toolOutcome === "failed" || check.status === "failed")
        ? "failed"
        : "unknown",
    binding: demo ? "illustrative" : contextual ? "contextual" : "unlinked",
    association: demo
      ? "Illustrative result, not an executed test."
      : contextual
        ? "Command context for this change. Tested content and coverage are not established."
        : "Recorded command. Tested content and coverage are not established.",
  };
}
export function checksForHunk(snapshot, hunk) {
  return newestFirst(snapshot.checks ?? [], snapshot.events)
    .filter(
      (c) =>
        (Array.isArray(c.hunkIds) && c.hunkIds.includes(hunk.id)) ||
        (hunk.eventId && c.eventId === hunk.eventId),
    )
    .map((c) => projectCheck(snapshot, c, hunk));
}
