import { sessionPath } from "./session-path.js";
import { classifyPaths } from "../core/evidence.js";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import { structuredPatch } from "diff";
import { normalizeSnapshot } from "../core/model.js";
const digest = (x) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 24);
const text = (content) =>
  Array.isArray(content)
    ? content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
    : "";
const clean = (s) =>
  String(s ?? "")
    .replace(/\b(sk-[\w-]{12,}|Bearer\s+[\w.-]+)\b/g, "[redacted]")
    .slice(0, 16000);
export async function readSessionReview(
  services,
  sessionId,
  { throughSeq = Infinity, signal, checkpointSeq } = {},
) {
  if (!sessionId || !services.sessionQuery)
    throw Error(
      "Select a session with history support to inspect its changes.",
    );
  const log = await services.sessionQuery.readSession(sessionId);
  if (signal?.aborted) throw Error("Request cancelled");
  if (log.session.id !== sessionId) throw Error("Session identity mismatch");
  const cwd = log.session.cwd;
  if (!cwd || !isAbsolute(cwd))
    throw Error("This session has no workspace directory.");
  let root;
  try {
    root = await realpath(cwd);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    root = normalize(cwd); // Recorded evidence remains readable after workspace removal.
  }
  const raw = [
    ...new Map(
      log.events
        .filter((e) => e && Number.isSafeInteger(e.seq))
        .map((e) => [e.seq, e]),
    ).values(),
  ]
    .filter((e) => e.seq <= throughSeq)
    .sort((a, b) => a.seq - b.seq);
  const snapshotId = digest([sessionId, raw.at(-1)?.seq ?? -1]);
  const model = {
    sessionId,
    workspaceId: digest(root),
    root,
    snapshotId,
    pathScopeVersion: 2,
    identity: {
      kind: "review-history",
      throughSeq: raw.at(-1)?.seq ?? -1,
      testedContent: "unknown",
    },
    title: "Session review",
    scope: "session",
    capturedAt: raw.at(-1)?.time ?? Date.now(),
    hunks: [],
    objectives: [],
    events: [],
    relationships: [],
    checks: [],
    notices: [],
    milestones: [],
    checkpointSeqs: raw
      .slice(-10000)
      .filter((e) => e.type === "workspace/changes")
      .map((e) => e.seq),
    files: [],
  };
  const calls = new Map();
  let objective;
  let turn = 0;
  const id = (e) => sessionId + ":" + e.seq;
  function attach(h, e, call) {
    model.hunks.push(h);
    const sourceId = id(e);
    if (call?.objectiveId)
      model.relationships.push({
        hunkId: h.id,
        kind: "task",
        target: call.objectiveId,
        provenance: "observed",
        sourceId,
        rationale:
          "File-tool result in the turn containing this request; this is turn context, not a semantic claim about every line.",
      });
    model.relationships.push({
      hunkId: h.id,
      kind: "milestone",
      target: "Turn " + (e.data.turn ?? turn),
      provenance: "observed",
      sourceId,
    });
    model.relationships.push({
      hunkId: h.id,
      kind: "module",
      target: h.path.includes("/")
        ? h.path.slice(0, h.path.lastIndexOf("/"))
        : "Repository root",
      provenance: "inferred",
      sourceId,
      rationale: "Directory containment, not a dependency claim.",
    });
  }
  let previewBytes = 0;
  let checkpointComplete = true;
  if (raw.length > 10000)
    model.notices.push(
      "Showing the latest 10,000 history events. Earlier activity is omitted from this preview.",
    );
  for (const e of checkpointSeq === undefined
    ? raw.slice(-10000)
    : raw.filter((e) => e.seq === checkpointSeq)) {
    if (signal?.aborted) throw Error("Request cancelled");
    const d = e.data ?? {};
    if (e.type === "turn/start") {
      turn = d.turn;
      objective = undefined;
      model.milestones.push({
        id: id(e),
        seq: e.seq,
        title: "Turn " + turn,
        time: e.time,
      });
    }
    if (e.type === "user/message") {
      // Only actual user input is an objective; injected system context is not.
      const kind = d.source?.kind ?? d.source?.type;
      const title = clean(text(d.content));
      if (title && (!kind || ["user", "human", "user-input"].includes(kind))) {
        objective = {
          id: id(e),
          title: title.slice(0, 180),
          text: title,
          provenance: "declared",
          sourceId: id(e),
        };
        model.objectives.push(objective);
        model.events.push({
          id: id(e),
          seq: e.seq,
          time: e.time,
          type: "request",
          title: objective.title,
          objectiveId: objective.id,
          hunkIds: [],
        });
      }
    }
    if (e.type === "tool/call") {
      let args = {};
      try {
        const parsed = JSON.parse(
          typeof d.arguments === "string" && d.arguments.length <= 128000
            ? d.arguments
            : "{}",
        );
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          args = parsed;
      } catch {}
      const call = { ...d, args, eventId: id(e), objectiveId: objective?.id };
      calls.set(d.callId, call);
      model.events.push({
        id: id(e),
        seq: e.seq,
        time: e.time,
        type: "action",
        title: clean(d.name),
        description: clean(
          args.description ?? args.command ?? args.file_path ?? args.path ?? "",
        ),
        objectiveId: objective?.id,
        hunkIds: [],
        status: "pending",
      });
    }
    if (e.type === "tool/result") {
      const call = calls.get(d.message?.toolCallId);
      if (!call) continue;
      const action = model.events.find((x) => x.id === call.eventId);
      action.status = d.message?.isError ? "failed" : "completed";
      let diffs = Array.isArray(d.meta?.diffs) ? d.meta.diffs : [];
      // DSH's write/create presentation intentionally omits diffs and uses call content.
      if (
        call.name === "write" &&
        !d.message?.isError &&
        d.meta?.operation === "create" &&
        Array.isArray(d.meta.diffs) &&
        !d.meta.diffs.length &&
        typeof call.args.file_path === "string" &&
        typeof call.args.content === "string"
      ) {
        diffs = [
          {
            path: call.args.file_path,
            oldText: null,
            newText: call.args.content,
          },
        ];
      }
      for (const [i, diff] of diffs.entries()) {
        if (
          !diff ||
          typeof diff.path !== "string" ||
          typeof diff.newText !== "string" ||
          (diff.oldText !== null && typeof diff.oldText !== "string")
        ) {
          model.notices.push("Malformed edit metadata was omitted.");
          continue;
        }
        if (diff.newText.length + (diff.oldText?.length ?? 0) > 512000) {
          model.notices.push("A recorded edit exceeded the preview limit.");
          continue;
        }
        previewBytes += diff.newText.length + (diff.oldText?.length ?? 0);
        if (previewBytes > 4000000 || model.hunks.length >= 1000) {
          model.notices.push(
            "Recorded edit preview limit reached; additional edits are omitted.",
          );
          continue;
        }
        const location = sessionPath(diff.path, cwd, root);
        if (!location) {
          model.notices.push(
            "An edit with an invalid recorded path was omitted.",
          );
          continue;
        }
        const { path } = location;
        if (
          call.name === "write" &&
          d.meta?.operation === "create" &&
          !d.message?.isError
        )
          model.files.push({ id: path, ...location, kind: "created" });
        const patch = structuredPatch(
          path,
          path,
          diff.oldText ?? "",
          diff.newText,
          "",
          "",
          { context: 3, timeout: 100 },
        );
        if (!patch) {
          model.notices.push("An edit comparison exceeded the time limit.");
          continue;
        }
        for (const [j, p] of patch.hunks.entries()) {
          const h = {
            id: id(e) + ":" + i + ":" + j,
            ...location,
            title: call.name + " " + path.split("/").at(-1),
            lines: p.lines.filter(
              (l) => /^[ +\-]/.test(l) || l.startsWith("\\ No newline"),
            ),
            oldStart: p.oldStart,
            newStart: p.newStart,
            rangeKind: "excerpt",
            eventId: call.eventId,
            sourceId: id(e),
            snapshotId,
          };
          attach(h, e, call);
          action.hunkIds.push(h.id);
        }
      }
      if (typeof call.args.command === "string") {
        const output = clean(text(d.message?.content));
        // Record execution evidence without equating a successful tool invocation to passing tests.
        model.checks.push({
          id: id(e),
          eventId: call.eventId,
          hunkIds: [],
          command: clean(call.args.command),
          output,
          status: d.message?.isError ? "failed" : "recorded",
          toolOutcome: d.message?.isError ? "failed" : "unknown",
          testOutcome: "unknown",
          binding: "unlinked",
          provenance: "observed",
          snapshotId,
          seq: e.seq,
          time: e.time,
          association:
            "Command in this session; exact code snapshot not established.",
        });
      }
    }
    if (e.type === "workspace/changes") {
      let comparisonComplete = true;
      const fileStart = model.files.length,
        hunkStart = model.hunks.length;
      let saved;
      try {
        saved = await services.readCheckpoint?.(sessionId, e.seq);
      } catch {
        model.notices.push(
          "A saved turn comparison could not be read; trying the host comparison.",
        );
      }
      let summary;
      try {
        summary =
          saved?.pathScopeVersion === 2
            ? undefined
            : services.workspaceChanges?.summary(sessionId, e.seq);
      } catch {
        model.notices.push(
          "The host comparison is unavailable; saved evidence is shown where available.",
        );
      }
      if (saved && (saved.pathScopeVersion === 2 || !summary)) {
        if (saved.pathScopeVersion !== 2) {
          checkpointComplete = false;
          comparisonComplete = false;
          model.notices.push(
            "This older saved checkpoint may omit outside-folder changes; the host comparison has expired. Recorded tool edits are still shown.",
          );
        }
        const bytes = JSON.stringify(saved).length;
        if (
          previewBytes + bytes > 4000000 ||
          model.hunks.length + saved.hunks.length > 1000
        ) {
          model.notices.push("Saved turn comparison preview limit reached.");
          continue;
        }
        previewBytes += bytes;
        for (const h of saved.hunks) attach({ ...h }, e, undefined);
        model.files.push(...saved.files);
        model.events.push(saved.event);
        model.notices.push(...saved.notices);
        continue;
      }
      if (!summary) {
        model.notices.push(
          "A turn comparison is no longer available from DSH. Recorded file edits remain available.",
        );
        continue;
      }
      const event = {
        id: id(e),
        seq: e.seq,
        time: e.time,
        type: "checkpoint",
        title: "Turn " + d.turn + " · " + summary.total + " files changed",
        hunkIds: [],
        objectiveId: objective?.id,
      };
      if (summary.files.length > 100) {
        checkpointComplete = false;
        comparisonComplete = false;
        model.notices.push("Turn comparison file limit reached.");
      }
      for (let i = 0; i < Math.min(summary.files.length, 100); i++) {
        if (model.hunks.length >= 1000 || previewBytes > 4000000) {
          checkpointComplete = false;
          comparisonComplete = false;
          model.notices.push("Turn comparison preview limit reached.");
          break;
        }
        let diff;
        try {
          diff = await services.workspaceChanges.diff(
            sessionId,
            e.seq,
            i,
            signal ?? new AbortController().signal,
          );
        } catch {
          model.notices.push(
            "The host comparison became unavailable during recovery.",
          );
        }
        if (signal?.aborted) throw Error("Request cancelled");
        if (!diff) {
          checkpointComplete = false;
          comparisonComplete = false;
          model.notices.push("A host file comparison is unavailable.");
          continue;
        }
        const location = sessionPath(diff.path, cwd, root);
        if (!location) {
          checkpointComplete = false;
          comparisonComplete = false;
          model.notices.push(
            "A checkpoint with an invalid recorded path was omitted.",
          );
          continue;
        }
        const { path } = location;
        model.files.push({ id: path, ...location, kind: diff.kind });
        if (diff.kind !== "text") continue;
        previewBytes += JSON.stringify(diff).length;
        if (previewBytes > 4000000) {
          checkpointComplete = false;
          comparisonComplete = false;
          model.notices.push("Turn comparison preview limit reached.");
          break;
        }
        for (const [j, p] of diff.hunks.entries()) {
          if (model.hunks.length >= 1000) {
            checkpointComplete = false;
            comparisonComplete = false;
            model.notices.push("Turn comparison hunk limit reached.");
            break;
          }
          const h = {
            id: id(e) + ":" + i + ":" + j,
            ...location,
            title: path.split("/").at(-1),
            oldStart: p.oldStart,
            newStart: p.newStart,
            lines: p.lines,
            rangeKind: "file",
            eventId: id(e),
            sourceId: id(e),
            snapshotId,
          };
          // Per-turn workspace capture is observed scope, not proof of authorship in concurrent sessions.
          attach(h, e, undefined);
          event.hunkIds.push(h.id);
        }
      }
      if (!comparisonComplete && saved) {
        for (const h of saved.hunks) {
          if (model.hunks.some((x) => x.id === h.id)) continue;
          const size = JSON.stringify(h).length;
          if (model.hunks.length >= 1000 || previewBytes + size > 4000000)
            break;
          previewBytes += size;
          attach({ ...h }, e, undefined);
          event.hunkIds.push(h.id);
        }
        for (const f of saved.files)
          if (!model.files.some((x) => x.path === f.path)) model.files.push(f);
      }
      model.events.push(event);
      if (comparisonComplete && !signal?.aborted && services.writeCheckpoint) {
        const hunks = model.hunks.slice(hunkStart);
        try {
          await services.writeCheckpoint(sessionId, e.seq, {
            sessionId,
            seq: e.seq,
            pathScopeVersion: 2,
            event,
            hunks,
            files: model.files.slice(fileStart),
            relationships: model.relationships.filter((r) =>
              hunks.some((h) => h.id === r.hunkId),
            ),
            notices: [
              "Saved host checkpoint; concurrent edits may come from elsewhere.",
            ],
            capturedAt: Date.now(),
          });
        } catch {
          model.notices.push(
            "Recovered checkpoint evidence could not be saved; it may expire with the host.",
          );
        }
      }
      model.notices.push(
        "Turn checkpoints include workspace changes during the turn; concurrent edits may come from elsewhere.",
      );
    }
  }
  model.capture = {
    checkpointSeq: checkpointSeq ?? null,
    scope: checkpointSeq === undefined ? "bounded-review" : "checkpoint",
    complete: checkpointSeq === undefined ? null : checkpointComplete,
  };
  model.title = model.objectives.at(-1)?.title ?? "Session review";
  model.activity =
    raw.at(-1)?.type === "turn/end" ? "Idle" : "Observed history";
  model.notices.push(
    "Session evidence includes recorded edits across folders and worktrees. Shell edits without host diff evidence may be unavailable.",
  );
  model.notices = [...new Set(model.notices)];
  if (!model.hunks.length && !model.files.length)
    model.notices.push(
      "No recorded file edits found. Switch to Workspace to inspect current Git changes without session attribution.",
    );
  return classifyPaths(normalizeSnapshot(model));
}
