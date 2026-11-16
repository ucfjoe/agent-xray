import { sessionPath } from "./session-path.js";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import { structuredPatch } from "diff";
import { normalizeSnapshot } from "../core/model.js";
import {
  ackReferent,
  classifyMessage,
  cleanObjective,
  rulesVersion,
  selectCandidate,
  todoObjective,
} from "../core/objectives.js";
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

// Derivation runs after the event scan because an objective is only knowable once
// its turn has closed. Everything it emits carries a label: words the user wrote
// stay `declared`; selection, carries and titles are `inferred`.
function deriveObjectives({
  model,
  turnMessages,
  turnAssistant,
  turnTodos,
  settledByCallId,
}) {
  const turns = new Set([
    ...turnMessages.keys(),
    ...turnAssistant.keys(),
    ...turnTodos.keys(),
  ]);
  const objectiveByTurn = new Map();
  const changeCount = new Map();
  let carried;
  for (const turn of [...turns].sort((a, b) => a - b)) {
    const messages = turnMessages.get(turn) ?? [];
    const assistant = turnAssistant.get(turn) ?? [];
    const priorAssistant = assistant.map((a) => a.text).join("\n");
    const candidates = [];
    let acknowledgement = false;
    for (const message of messages) {
      const { dropped, rule } = classifyMessage({
        text: message.text,
        sourceKind: message.sourceKind,
        priorAssistantText: priorAssistant,
      });
      if (!dropped) {
        candidates.push(message);
        continue;
      }
      if (rule === "R3-brief-ack" || rule === "R4-agreement")
        acknowledgement = true;
      model.events.push({
        id: message.id + ":unaligned",
        seq: message.seq,
        time: message.time,
        // A status question is a step in the session, not a goal; it stays in the
        // Journey. Everything else that is dropped stays out of the timeline.
        type:
          rule === "R8-status-question"
            ? "status-question"
            : "unaligned-request",
        title: cleanObjective(message.text),
        rule,
        turn,
        hunkIds: [],
      });
    }
    let chosen = selectCandidate(candidates);
    let provenance = "declared";
    let selection;
    let sourceId;
    let derivedFrom;
    if (!chosen && acknowledgement) {
      const referent = ackReferent({ assistantMessages: assistant });
      if (referent) {
        chosen = {
          id: "ack:" + turn,
          seq: messages.at(-1)?.seq ?? -1,
          time: messages.at(-1)?.time,
          text: referent.text,
        };
        // The words are the agent's, so this is an inference even though the
        // decision to take them came from a user acknowledgement.
        provenance = "inferred";
        selection = "acknowledgement-referent";
        sourceId = referent.sourceId;
        derivedFrom = messages.map((m) => m.seq);
      }
    }
    if (!chosen) {
      const todo = todoObjective(turnTodos.get(turn) ?? []);
      if (todo) {
        chosen = {
          id: "todo:" + turn,
          seq: messages.at(-1)?.seq ?? turn,
          time: messages.at(-1)?.time,
          text: todo.text,
        };
        provenance = "declared";
        selection = "agent-todo";
        sourceId = todo.sourceId;
      }
    }
    if (chosen) {
      const objective = {
        id: "objective:" + turn,
        turn,
        seq: Number.isInteger(chosen.seq) ? chosen.seq : turn,
        time: chosen.time,
        title: cleanObjective(chosen.text),
        text: chosen.text,
        provenance,
        selection: selection ?? "request",
        derivedFrom: derivedFrom ?? [chosen.seq].filter(Number.isInteger),
        sourceId: sourceId ?? chosen.id,
      };
      model.objectives.push(objective);
      objectiveByTurn.set(turn, objective);
      model.events.push({
        id: objective.id + ":request",
        seq: chosen.seq,
        time: chosen.time,
        type: "request",
        title: objective.title,
        turn,
        objectiveId: objective.id,
        hunkIds: [],
      });
      carried = objective;
    } else if (carried) {
      // Work that continues an earlier objective is attributed to it, explicitly
      // as a continuation rather than as a new request.
      objectiveByTurn.set(turn, carried);
    }
  }

  for (const hunk of model.hunks) {
    const objective = objectiveByTurn.get(hunk.turn);
    const sourceId = hunk.sourceId;
    if (objective) {
      model.relationships.push({
        hunkId: hunk.id,
        kind: "task",
        target: objective.id,
        provenance: objective.turn === hunk.turn ? "observed" : "inferred",
        sourceId,
        rationale:
          objective.turn === hunk.turn
            ? "Change recorded in the same turn as this request."
            : "Continuation of the objective first stated in turn " +
              objective.turn +
              ".",
      });
      changeCount.set(objective.id, (changeCount.get(objective.id) ?? 0) + 1);
    }
    model.relationships.push({
      hunkId: hunk.id,
      kind: "milestone",
      target: objective ? objective.title : "Unnamed work",
      provenance: "inferred",
      sourceId,
    });
  }

  for (const event of model.events) {
    if (!Number.isInteger(event.turn)) continue;
    const objective = objectiveByTurn.get(event.turn);
    if (event.type === "action" && objective) event.objectiveId = objective.id;
    if (event.type === "checkpoint") {
      const label = objective ? objective.title : "Unnamed work";
      event.title = label + " · " + event.fileCount + " files changed";
    }
  }

  for (const check of model.checks) {
    const settled = settledByCallId.get(check.callId);
    if (settled) check.processOutcome = settled;
  }

  const busiest = [...changeCount.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0];
  const headline = busiest && model.objectives.find((o) => o.id === busiest[0]);
  model.title = headline?.title ?? "Session review";
  model.derivationVersion = rulesVersion();
  return model;
}
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
    checkpoints: [],
    derivationVersion: rulesVersion(),
    checkpointSeqs: raw
      .slice(-10000)
      .filter((e) => e.type === "workspace/changes")
      .map((e) => e.seq),
    files: [],
  };
  const calls = new Map();
  const turnMessages = new Map();
  const turnAssistant = new Map();
  const turnTodos = new Map();
  const settledByCallId = new Map();
  let turn = 0;
  const id = (e) => sessionId + ":" + e.seq;
  const at = (map, key) => {
    if (!map.has(key)) map.set(key, []);
    return map.get(key);
  };
  function attach(h, e) {
    h.turn = Number.isInteger(e.data?.turn) ? e.data.turn : turn;
    model.hunks.push(h);
    model.relationships.push({
      hunkId: h.id,
      kind: "module",
      target: h.path.includes("/")
        ? h.path.slice(0, h.path.lastIndexOf("/"))
        : "Repository root",
      provenance: "inferred",
      sourceId: id(e),
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
    }
    if (e.type === "user/message") {
      // Objectives are derived after the turn closes; raw messages are collected
      // here so the derivation sees the whole turn before it decides.
      const body = clean(text(d.content));
      if (body)
        at(turnMessages, turn).push({
          id: id(e),
          seq: e.seq,
          time: e.time,
          text: body,
          sourceKind: d.source?.kind ?? d.source?.type,
        });
    }
    if (e.type === "assistant/message") {
      const body = clean(text(d.message?.content ?? d.content));
      if (body) at(turnAssistant, turn).push({ id: id(e), text: body });
    }
    if (e.type === "todo/write" && Array.isArray(d.todos))
      at(turnTodos, turn).push({
        seq: e.seq,
        todos: d.todos.map((todo, i) => ({ id: id(e) + ":" + i, ...todo })),
      });
    if (e.type === "job/settled") {
      const key = d.toolCall?.callId ?? d.toolCall?.toolCallId;
      if (key) {
        const exit = String(d.detail ?? "").match(/exit code:\s*(-?\d+)/);
        settledByCallId.set(key, {
          killed: d.status === "killed",
          failed: d.status === "failed",
          signal: String(d.detail ?? "").match(/signal:\s*(\S+)/)?.[1],
          exit: exit ? Number(exit[1]) : null,
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
      const call = { ...d, args, eventId: id(e) };
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
        hunkIds: [],
        turn,
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
            seq: e.seq,
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
          callId: d.message?.toolCallId,
          hunkIds: [],
          command: clean(call.args.command),
          output,
          status: d.message?.isError ? "failed" : "recorded",
          toolOutcome: d.message?.isError ? "failed" : "unknown",
          provenance: "observed",
          snapshotId,
          seq: e.seq,
          time: e.time,
          turn,
        });
      }
    }
    if (e.type === "workspace/changes") {
      model.checkpoints.push({ seq: e.seq, turn: d.turn ?? turn });
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
        title: summary.total + " files changed",
        fileCount: summary.total,
        turn: d.turn ?? turn,
        hunkIds: [],
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
            seq: e.seq,
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
  deriveObjectives({
    model,
    turnMessages,
    turnAssistant,
    turnTodos,
    settledByCallId,
  });
  model.capture = {
    checkpointSeq: checkpointSeq ?? null,
    scope: checkpointSeq === undefined ? "bounded-review" : "checkpoint",
    complete: checkpointSeq === undefined ? null : checkpointComplete,
  };
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
  return normalizeSnapshot(model);
}
