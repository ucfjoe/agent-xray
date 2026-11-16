import { newestFirst } from "./model.js";

// Review IDs, tool success and hunk links are not proof of tested content.
// Two axes stay separate: what the process did (observed), and whether that
// covered the selected change (inferred, and unknown unless evidence binds it).

export function processOutcomeLabel(check) {
  if (check?.processOutcome?.killed) return "killed";
  const exit = check?.processOutcome?.exit;
  if (Number.isInteger(exit)) return "exited " + exit;
  if (check?.toolOutcome === "failed" || check?.status === "failed")
    return "failed";
  return "not recorded";
}

// A command runs after whatever workspace state was recorded last. The host
// records comparisons at turn boundaries, so this is location in time, not proof
// that the command exercised the change on screen.
export function bindCommand(check, checkpoints = []) {
  const before = checkpoints
    .filter((k) => Number.isInteger(k.seq) && k.seq < check.seq)
    .sort((a, b) => a.seq - b.seq);
  const checkpoint = before.at(-1);
  if (!checkpoint)
    return {
      binding: "unlinked",
      boundCheckpointSeq: undefined,
      association: "No workspace checkpoint recorded before this command.",
    };
  return {
    binding: "after-checkpoint",
    boundCheckpointSeq: checkpoint.seq,
    association:
      "Ran after the workspace state recorded at the end of turn " +
      checkpoint.turn +
      ". This does not show that the command exercised this change.",
  };
}

export function projectCheck(snapshot, check, hunk) {
  const demo = snapshot.source === "demo" && check.provenance === "demo";
  if (demo)
    return {
      ...check,
      status: ["passed", "failed", "pending"].includes(check.status)
        ? check.status
        : "not verified",
      testOutcome: check.status,
      toolOutcome: "unknown",
      binding: "illustrative",
      processOutcome: processOutcomeLabel(check),
      association: "Illustrative result, not an executed test.",
    };
  const contextual = Boolean(
    hunk &&
      ((Array.isArray(check.hunkIds) && check.hunkIds.includes(hunk.id)) ||
        (hunk.eventId && check.eventId === hunk.eventId)),
  );
  const bound = bindCommand(check, snapshot.checkpoints ?? []);
  return {
    ...check,
    status: "not verified",
    testOutcome: "unknown",
    toolOutcome:
      check.toolOutcome === "failed" || check.status === "failed"
        ? "failed"
        : "unknown",
    processOutcome: processOutcomeLabel(check),
    binding: contextual ? "contextual" : bound.binding,
    boundCheckpointSeq: bound.boundCheckpointSeq,
    association: bound.association,
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
