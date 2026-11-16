import test from "node:test";
import assert from "node:assert/strict";
import { readSessionReview } from "../plugin/dsh-adapter.js";
import { projectCheck } from "../core/verification.js";

// Drives the real adapter over a recorded event sequence: turn close, the
// acknowledgement referent, agent todos, an injected prompt, a command with a
// nonzero exit, and a workspace checkpoint.
const cwd = process.cwd();

function event(seq, type, data) {
  return { seq, time: 1_700_000_000_000 + seq, type, data };
}

function message(text, kind = "user") {
  return {
    content: [{ type: "text", text }],
    source: kind ? { kind } : undefined,
    role: kind ?? "user",
  };
}

function fixture() {
  return [
    event(1, "turn/start", { turn: 1 }),
    event(
      2,
      "user/message",
      message("Protect sign in and rotate the refresh token"),
    ),
    event(3, "assistant/message", {
      message: {
        content: [
          {
            type: "text",
            text: "Next I will update the session module and rerun the suite.",
          },
        ],
      },
    }),
    event(4, "tool/call", {
      turn: 1,
      step: 1,
      callId: "call_a",
      name: "write",
      arguments: JSON.stringify({
        file_path: "src/auth/session.ts",
        content: "export const t = 1;\n",
      }),
    }),
    event(5, "tool/result", {
      turn: 1,
      step: 1,
      message: {
        source: { kind: "tool", callId: "call_a" },
        toolCallId: "call_a",
        isError: false,
        content: [{ type: "text", text: "written" }],
      },
      meta: {
        diffs: [
          {
            path: "src/auth/session.ts",
            oldText: "export const t = 0;\n",
            newText: "export const t = 1;\n",
          },
        ],
      },
    }),
    event(6, "tool/call", {
      turn: 1,
      step: 2,
      callId: "call_b",
      name: "bash",
      arguments: JSON.stringify({ command: "npm test" }),
    }),
    event(7, "tool/result", {
      turn: 1,
      step: 2,
      message: {
        source: { kind: "tool", callId: "call_b" },
        toolCallId: "call_b",
        isError: false,
        content: [
          {
            type: "text",
            text: "2 tests failed\n[Command finished with exit code 2]",
          },
        ],
      },
    }),
    event(8, "job/registered", { jobId: "job_1", label: "npm test" }),
    event(9, "job/settled", {
      jobId: "job_1",
      toolCall: { callId: "call_b", rootCallId: "call_b" },
      status: "completed",
      detail: "exit code: 2",
    }),
    event(10, "workspace/changes", { turn: 1 }),
    event(11, "turn/end", { turn: 1 }),

    event(12, "turn/start", { turn: 2 }),
    event(13, "user/message", message("go for it")),
    event(14, "assistant/message", {
      message: {
        content: [{ type: "text", text: "I will add the expiry guard now." }],
      },
    }),
    event(15, "todo/write", {
      turn: 2,
      todos: [{ content: "Add the expiry guard", status: "in_progress" }],
    }),
    event(16, "tool/call", {
      turn: 2,
      step: 1,
      callId: "call_c",
      name: "bash",
      arguments: JSON.stringify({ command: "npm run lint" }),
    }),
    event(17, "tool/result", {
      turn: 2,
      step: 1,
      message: {
        source: { kind: "tool", callId: "call_c" },
        toolCallId: "call_c",
        isError: false,
        content: [{ type: "text", text: "no problems" }],
      },
    }),
    event(18, "turn/end", { turn: 2 }),

    event(19, "turn/start", { turn: 3 }),
    event(
      20,
      "user/message",
      message("You are a read-only investigator. Report findings only."),
    ),
    event(21, "user/message", message("what is the status now ?")),
    event(22, "turn/end", { turn: 3 }),
  ];
}

async function review() {
  const events = fixture();
  const services = {
    sessionQuery: {
      readSession: async () => ({
        session: { id: "session-integration", cwd },
        events,
      }),
    },
  };
  return readSessionReview(services, "session-integration");
}

test("objectives are derived per turn, no raw ack becomes one", async () => {
  const snapshot = await review();
  const titles = snapshot.objectives.map((o) => o.title);
  assert.ok(
    titles.some((t) => t.startsWith("Protect sign in")),
    "the goal turn keeps its request: " + JSON.stringify(titles),
  );
  assert.ok(
    !titles.includes("go for it"),
    "an acknowledgement is not an objective",
  );
  assert.ok(
    !titles.some((t) => t.startsWith("You are a read-only")),
    "an injected prompt is not an objective",
  );
});

test("an acknowledgement takes the assistant action sentence it answers", async () => {
  const snapshot = await review();
  const referent = snapshot.objectives.find(
    (o) => o.selection === "acknowledgement-referent",
  );
  assert.ok(referent, "expected a referent objective for turn 2");
  assert.match(referent.title, /expiry guard/i);
  assert.equal(referent.provenance, "inferred");
});

test("dropped messages are typed events, and status questions stay visible as steps", async () => {
  const snapshot = await review();
  const status = snapshot.events.filter((e) => e.type === "status-question");
  assert.ok(
    status.length >= 1,
    "the status question should be recorded as a step",
  );
  assert.match(status[0].title, /status now/i);
  const unaligned = snapshot.events.filter(
    (e) => e.type === "unaligned-request",
  );
  assert.ok(
    unaligned.some((e) => /read-only investigator/i.test(e.title)),
    "the injected prompt is kept as evidence",
  );
  const promoted = snapshot.events.filter(
    (e) => e.type === "request" && /status now|go for it/i.test(e.title),
  );
  assert.equal(promoted.length, 0, "neither becomes a request event");
});

test("task and milestone relationships point at derived work, never at a turn number", async () => {
  const snapshot = await review();
  const task = snapshot.relationships.filter((r) => r.kind === "task");
  const milestone = snapshot.relationships.filter(
    (r) => r.kind === "milestone",
  );
  assert.ok(task.length >= 1, "changes are attributed to an objective");
  assert.ok(
    task.every((r) => snapshot.objectives.some((o) => o.id === r.target)),
    "every task target is a derived objective id",
  );
  assert.ok(milestone.length >= 1);
  assert.ok(
    milestone.every((r) => !/^Turn \d+$/.test(r.target)),
    "no milestone target is a bare turn number: " +
      JSON.stringify(milestone.map((r) => r.target)),
  );
});

test("a command before its turn's checkpoint is unlinked, and says so", async () => {
  const snapshot = await review();
  const check = snapshot.checks.find((c) => c.command === "npm test");
  assert.ok(check, "the command is recorded");
  assert.equal(check.processOutcome.exit, 2);
  const projected = projectCheck(snapshot, check);
  assert.equal(projected.processOutcome, "exited 2");
  assert.equal(
    projected.testOutcome,
    "unknown",
    "exit status is not a test verdict",
  );
  assert.equal(projected.status, "not verified");
  // The workspace checkpoint is the turn's terminal event, so a command inside
  // that same turn cannot precede it.
  assert.equal(projected.binding, "unlinked");
  assert.match(
    projected.association,
    /No workspace checkpoint recorded before/i,
  );
});

test("a command after an earlier turn's checkpoint binds to it, without claiming coverage", async () => {
  const snapshot = await review();
  const check = snapshot.checks.find((c) => c.command === "npm run lint");
  assert.ok(check, "the later command is recorded");
  const projected = projectCheck(snapshot, check);
  assert.equal(projected.binding, "after-checkpoint");
  assert.equal(projected.boundCheckpointSeq, 10);
  assert.equal(projected.testOutcome, "unknown");
  assert.match(projected.association, /end of turn 1/i);
  assert.match(
    projected.association,
    /does not show that the command exercised/i,
  );
});

test("perspectives are not part of the adapter snapshot", async () => {
  const snapshot = await review();
  assert.equal(
    snapshot.coverage,
    undefined,
    "coverage is added after enrichment",
  );
});
