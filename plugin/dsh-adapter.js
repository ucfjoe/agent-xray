import { classifyPaths } from "../core/evidence.js";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
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
  { throughSeq = Infinity, signal } = {},
) {
  if (!sessionId || !services.sessionQuery)
    throw Error(
      "Select a session with history support to inspect its changes.",
    );
  const log = await services.sessionQuery.readSession(sessionId);
  if (log.session.id !== sessionId) throw Error("Session identity mismatch");
  const cwd = log.session.cwd;
  if (!cwd || !isAbsolute(cwd))
    throw Error("This session has no workspace directory.");
  const root = await realpath(cwd);
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
  if (raw.length > 10000)
    model.notices.push(
      "Showing the latest 10,000 history events. Earlier activity is omitted from this preview.",
    );
  for (const e of raw.slice(-10000)) {
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
      const diffs = Array.isArray(d.meta?.diffs) ? d.meta.diffs : [];
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
        const path = isAbsolute(diff.path)
          ? relative(root, diff.path)
          : diff.path;
        if (path === ".." || path.startsWith("../")) {
          model.notices.push("An edit outside this workspace was omitted.");
          continue;
        }
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
            path,
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
      let saved;
      try {
        saved = await services.readCheckpoint?.(sessionId, e.seq);
      } catch {
        model.notices.push(
          "A saved turn comparison could not be read; trying the host comparison.",
        );
      }
      if (saved) {
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
      const summary = services.workspaceChanges?.summary(sessionId, e.seq);
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
      for (let i = 0; i < Math.min(summary.files.length, 100); i++) {
        if (model.hunks.length >= 1000 || previewBytes > 4000000) {
          model.notices.push("Turn comparison preview limit reached.");
          break;
        }
        const diff = await services.workspaceChanges.diff(
          sessionId,
          e.seq,
          i,
          signal ?? new AbortController().signal,
        );
        if (!diff) continue;
        const path = diff.path;
        if (isAbsolute(path) || path === ".." || path.startsWith("../"))
          continue;
        model.files.push({ id: path, path, kind: diff.kind });
        if (diff.kind !== "text") continue;
        previewBytes += JSON.stringify(diff).length;
        if (previewBytes > 4000000) {
          model.notices.push("Turn comparison preview limit reached.");
          break;
        }
        for (const [j, p] of diff.hunks.entries()) {
          const h = {
            id: id(e) + ":" + i + ":" + j,
            path,
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
      model.events.push(event);
      model.notices.push(
        "Turn checkpoints include workspace changes during the turn; concurrent edits may come from elsewhere.",
      );
    }
  }
  model.title = model.objectives.at(-1)?.title ?? "Session review";
  model.activity =
    raw.at(-1)?.type === "turn/end" ? "Idle" : "Observed history";
  model.notices = [...new Set(model.notices)];
  if (!model.hunks.length)
    model.notices.push(
      "No recorded file edits found. Switch to Workspace to inspect current Git changes without session attribution.",
    );
  return classifyPaths(normalizeSnapshot(model));
}
