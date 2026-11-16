import test from "node:test";
import assert from "node:assert/strict";
import { readSessionReview } from "../plugin/dsh-adapter.js";
import { readReview } from "../plugin/review-service.js";

const cwd = process.cwd();
const event = (seq, type, data) => ({
  seq,
  time: 1_700_000_000_000 + seq,
  type,
  data,
});
const user = (seq, turn, text) =>
  event(seq, "user/message", {
    content: [{ type: "text", text }],
    source: { kind: "user" },
    role: "user",
    turn,
  });
const call = (seq, turn, callId, name, args) =>
  event(seq, "tool/call", {
    turn,
    step: 1,
    callId,
    name,
    arguments: JSON.stringify(args),
  });
const result = (seq, turn, callId, text) =>
  event(seq, "tool/result", {
    turn,
    step: 1,
    message: {
      source: { kind: "tool", callId },
      toolCallId: callId,
      isError: false,
      content: [{ type: "text", text }],
    },
  });

function services(events, id = "recovery") {
  return {
    sessionQuery: {
      readSession: async () => ({ session: { id, cwd }, events }),
    },
  };
}

test("a background command shows its job's output, not its launch line", async () => {
  const events = [
    event(1, "turn/start", { turn: 1 }),
    user(2, 1, "Run the full suite and report the failures"),
    call(3, 1, "c1", "bash", { command: "npm test", run_in_background: true }),
    result(4, 1, "c1", "started background job bash-aaa111"),
    call(5, 1, "c2", "job_output", { job_id: "bash-aaa111" }),
    result(6, 1, "c2", "running\n[status: running]"),
    call(7, 1, "c3", "job_output", { job_id: "bash-aaa111", wait: true }),
    result(8, 1, "c3", "2 failed\n[status: completed, exit code: 1]"),
    call(9, 1, "c4", "job_output", { job_id: "bash-aaa111" }),
    result(10, 1, "c4", "(no new output)\n[status: running]"),
    event(11, "turn/end", { turn: 1 }),
  ];
  const snapshot = await readSessionReview(services(events), "recovery");
  const check = snapshot.checks.find((c) => c.command === "npm test");
  assert.equal(check.jobId, "bash-aaa111");
  // The completed read wins over a later stale "running" read.
  assert.match(check.output, /2 failed/);
  assert.equal(check.outputSource, "job-output");
  assert.equal(check.launchOutput, "started background job bash-aaa111");
  assert.equal(check.processOutcome.exit, 1);
});

test("a command that timed out into the background joins its job too", async () => {
  const events = [
    event(1, "turn/start", { turn: 1 }),
    user(2, 1, "Build the release bundle for staging"),
    call(3, 1, "c1", "bash", { command: "npm run build" }),
    result(
      4,
      1,
      "c1",
      "[still running after 300000ms; moved to background job bash-bbb222]\nThe command keeps running.",
    ),
    event(5, "turn/end", { turn: 1 }),
  ];
  const snapshot = await readSessionReview(services(events), "recovery");
  const check = snapshot.checks.find((c) => c.command === "npm run build");
  assert.equal(check.jobId, "bash-bbb222");
  // Never read: say so instead of presenting the launch notice as output.
  assert.equal(check.outputSource, "not-recorded");
});

test("ordinary commands are untouched by the job join", async () => {
  const events = [
    event(1, "turn/start", { turn: 1 }),
    user(2, 1, "Check which branch we are on now"),
    call(3, 1, "c1", "bash", { command: "git status" }),
    result(4, 1, "c1", "On branch main\nmentions a background job in passing"),
    event(5, "turn/end", { turn: 1 }),
  ];
  const snapshot = await readSessionReview(services(events), "recovery");
  const check = snapshot.checks.find((c) => c.command === "git status");
  assert.equal(check.jobId, undefined);
  assert.equal(check.outputSource, undefined);
  assert.match(check.output, /On branch main/);
});

test("restored checkpoint hunks are relabelled by turn, not left as Turn N", async () => {
  // A checkpoint saved by the pre-derivation adapter for turn 2.
  const saved = {
    sessionId: "restored",
    seq: 8,
    pathScopeVersion: 2,
    event: {
      id: "restored:8",
      seq: 8,
      type: "checkpoint",
      title: "Turn 2 · 1 files changed",
      hunkIds: ["restored:8:0:0"],
    },
    hunks: [
      {
        id: "restored:8:0:0",
        path: "src/cart/total.ts",
        lines: ["-a", "+b"],
        oldStart: 1,
        newStart: 1,
        rangeKind: "file",
        sourceId: "restored:8",
        seq: 8,
      },
    ],
    files: [{ id: "src/cart/total.ts", path: "src/cart/total.ts" }],
    relationships: [
      {
        hunkId: "restored:8:0:0",
        kind: "milestone",
        target: "Turn 2",
        provenance: "observed",
        sourceId: "restored:8",
      },
    ],
    notices: [],
  };
  const events = [
    event(1, "turn/start", { turn: 1 }),
    user(2, 1, "Fix the cart total rounding for every market"),
    event(3, "turn/end", { turn: 1 }),
    event(4, "turn/start", { turn: 2 }),
    user(5, 2, "go for it"),
    event(8, "workspace/changes", { turn: 2 }),
    event(9, "turn/end", { turn: 2 }),
  ];
  const store = {
    get: async () => null,
    put: async () => {},
    list: async () => [],
    getCheckpoint: async (_id, seq) => (seq === 8 ? saved : null),
    putCheckpoint: async () => {},
  };
  const snapshot = await readReview({
    services: {
      ...services(events, "restored"),
      readCheckpoint: async (_id, seq) => (seq === 8 ? saved : null),
    },
    store,
    sessionId: "restored",
  });
  const milestones = snapshot.relationships.filter(
    (r) => r.kind === "milestone",
  );
  assert.ok(milestones.length >= 1);
  assert.ok(
    milestones.every((r) => !/^Turn \d+$/.test(r.target)),
    JSON.stringify(milestones.map((r) => r.target)),
  );
  const task = snapshot.relationships.find(
    (r) => r.kind === "task" && r.hunkId === "restored:8:0:0",
  );
  assert.ok(task, "the restored change is attributed to an objective");
  const objective = snapshot.objectives.find((o) => o.id === task.target);
  assert.match(objective.title, /cart total rounding/i);
  const checkpoint = snapshot.events.find((e) => e.type === "checkpoint");
  assert.doesNotMatch(checkpoint.title, /^Turn \d+ ·/);
});
