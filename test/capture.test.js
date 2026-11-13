import test from "node:test";
import assert from "node:assert/strict";
import { createCaptureQueue } from "../plugin/capture-queue.js";
import { createHistoryStore } from "../plugin/history-store.js";
import { readSessionReview } from "../plugin/dsh-adapter.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("capture queue preserves rapid event boundaries, reports failures and keeps running", async () => {
  const seen = [],
    errors = [];
  const q = createCaptureQueue({
    capture: async (id, seq) => {
      seen.push([id, seq]);
      if (seq === 2) throw Error("disk");
    },
    onError: (id, seq) => errors.push([id, seq]),
  });
  q.enqueue("a", 1, "workspace/changes");
  q.enqueue("a", 2, "workspace/changes");
  q.enqueue("b", 3, "turn/end");
  await q.idle();
  assert.deepEqual(seen, [
    ["a", 1],
    ["a", 2],
    ["b", 3],
  ]);
  assert.deepEqual(errors, [["a", 2]]);
  q.dispose();
});
test("capture queue bounds pending work and cancels work on disposal", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const seen = [],
    errors = [];
  const q = createCaptureQueue({
    maxPending: 1,
    capture: async (id, seq, type, signal) => {
      seen.push(seq);
      await gate;
      assert.equal(signal.aborted, true);
    },
    onError: () => errors.push(1),
  });
  q.enqueue("a", 1, "turn/end");
  q.enqueue("a", 1, "turn/end");
  q.enqueue("a", 2, "turn/end");
  q.enqueue("a", 3, "turn/end");
  assert.equal(errors.length, 1);
  q.dispose();
  release();
  await q.idle();
  assert.deepEqual(seen, [1]);
});
test("saved exact checkpoint supplements survive restart without modifying old aggregate snapshots", async () => {
  const root = await mkdtemp(join(tmpdir(), "xray-checkpoint-"));
  try {
    const store = createHistoryStore(root);
    const base = {
      sessionId: "a",
      snapshotId: "old",
      title: "old",
      hunks: [],
      capturedAt: 1,
    };
    await store.put(base);
    const checkpoint = {
      sessionId: "a",
      seq: 4,
      hunks: [
        {
          id: "a:4:0:0",
          sourceId: "a:4",
          eventId: "a:4",
          path: "a.js",
          oldStart: 20,
          newStart: 20,
          rangeKind: "file",
          lines: ["-old", "+new"],
        },
      ],
      files: [{ id: "a.js", path: "a.js" }],
      event: { id: "a:4", seq: 4, type: "checkpoint", hunkIds: ["a:4:0:0"] },
      notices: [],
    };
    await store.putCheckpoint("a", 4, checkpoint);
    await store.putCheckpoint("a", 4, { ...checkpoint, hunks: [] });
    const again = createHistoryStore(root);
    assert.deepEqual(await again.get("a", "old"), base);
    assert.equal((await again.getCheckpoint("a", 4)).hunks[0].newStart, 20);
    assert.equal(await again.getCheckpoint("b", 4), undefined);
    const s = await readSessionReview(
      {
        sessionQuery: {
          readSession: async () => ({
            session: { id: "a", cwd: root },
            events: [{ seq: 4, type: "workspace/changes", data: { turn: 1 } }],
          }),
        },
        readCheckpoint: (id, seq) => again.getCheckpoint(id, seq),
      },
      "a",
    );
    assert.equal(s.hunks[0].newStart, 20);
    assert.equal(s.hunks[0].rangeKind, "file");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { captureReview } from "../plugin/checkpoints.js";
test("real capture preserves both rapid checkpoint sequences and exact ranges after host expiry", async () => {
  const root = await mkdtemp(join(tmpdir(), "xray-rapid-"));
  try {
    const store = createHistoryStore(root);
    const events = [
      { seq: 1, time: 1, type: "workspace/changes", data: { turn: 1 } },
      { seq: 2, time: 2, type: "workspace/changes", data: { turn: 2 } },
    ];
    const services = {
      sessionQuery: {
        readSession: async () => ({ session: { id: "a", cwd: root }, events }),
      },
      workspaceChanges: {
        summary: () => ({ total: 1, files: [{}] }),
        diff: async (id, seq) => ({
          path: "a.js",
          kind: "text",
          hunks: [
            { oldStart: seq * 10, newStart: seq * 10, lines: ["-old", "+new"] },
          ],
        }),
      },
      readCheckpoint: (id, seq) => store.getCheckpoint(id, seq),
    };
    const errors = [];
    const q = createCaptureQueue({
      capture: (sessionId, seq, type, signal) =>
        captureReview({ services, store, sessionId, seq, type, signal }),
      onError: (id, seq, error) => errors.push(error),
    });
    q.enqueue("a", 1, "workspace/changes");
    q.enqueue("a", 2, "workspace/changes");
    await q.idle();
    assert.deepEqual(errors, []);
    assert.equal((await store.getCheckpoint("a", 1)).hunks[0].newStart, 10);
    assert.equal((await store.getCheckpoint("a", 2)).hunks[0].newStart, 20);
    services.workspaceChanges.summary = () => undefined;
    const restored = await readSessionReview(services, "a");
    assert.deepEqual(
      restored.hunks.map((h) => h.newStart),
      [10, 20],
    );
    assert.equal((await store.list("a")).length, 2);
    q.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("checkpoint capture has its own budget and retains binary-only files", async () => {
  const root = await mkdtemp(join(tmpdir(), "xray-budget-"));
  try {
    const store = createHistoryStore(root);
    const events = [1, 2, 3].map((seq) => ({
      seq,
      type: "workspace/changes",
      data: { turn: seq },
    }));
    const services = {
      sessionQuery: {
        readSession: async () => ({ session: { id: "a", cwd: root }, events }),
      },
      workspaceChanges: {
        summary: () => ({ total: 1, files: [{}] }),
        diff: async (id, seq) =>
          seq === 3
            ? { path: "image.png", kind: "binary" }
            : {
                path: "a.js",
                kind: "text",
                hunks: Array.from({ length: seq === 1 ? 1000 : 1 }, (_, i) => ({
                  oldStart: i + 1,
                  newStart: i + 1,
                  lines: ["+x"],
                })),
              },
      },
    };
    await captureReview({
      services,
      store,
      sessionId: "a",
      seq: 2,
      type: "workspace/changes",
    });
    assert.equal((await store.getCheckpoint("a", 2)).hunks.length, 1);
    await captureReview({
      services,
      store,
      sessionId: "a",
      seq: 3,
      type: "workspace/changes",
    });
    assert.deepEqual((await store.getCheckpoint("a", 3)).files, [
      {
        id: "image.png",
        path: "image.png",
        rawPath: "image.png",
        locationScope: "workspace",
        kind: "binary",
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stalled host reads time out without blocking another session or publishing late data", async () => {
  const root = await mkdtemp(join(tmpdir(), "xray-timeout-"));
  try {
    const store = createHistoryStore(root);
    let release;
    const gate = new Promise((r) => (release = r));
    const failures = [];
    const services = {
      sessionQuery: {
        readSession: async (id) => {
          if (id === "slow") await gate;
          return {
            session: { id, cwd: root },
            events: [{ seq: 1, time: 1, type: "turn/end", data: {} }],
          };
        },
      },
    };
    const q = createCaptureQueue({
      // Allow real filesystem publication under the parallel Git integration suite.
      timeoutMs: 500,
      capture: (sessionId, seq, type, signal) =>
        captureReview({ services, store, sessionId, seq, type, signal }),
      onError: (id) => failures.push(id),
    });
    q.enqueue("slow", 1, "turn/end");
    q.enqueue("fast", 1, "turn/end");
    await q.idle();
    assert.deepEqual(failures, ["slow"]);
    assert.equal((await store.list("fast")).length, 1);
    release();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal((await store.list("slow")).length, 0);
    q.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("partial host comparisons are not published as immutable successes and oversized hunks are bounded", async () => {
  const root = await mkdtemp(join(tmpdir(), "xray-partial-"));
  try {
    const store = createHistoryStore(root);
    const services = {
      sessionQuery: {
        readSession: async () => ({
          session: { id: "a", cwd: root },
          events: [{ seq: 1, type: "workspace/changes", data: { turn: 1 } }],
        }),
      },
      workspaceChanges: {
        summary: () => ({ total: 1, files: [{}] }),
        diff: async () => undefined,
      },
    };
    await assert.rejects(
      () =>
        captureReview({
          services,
          store,
          sessionId: "a",
          seq: 1,
          type: "workspace/changes",
        }),
      /incomplete/,
    );
    assert.equal(await store.getCheckpoint("a", 1), undefined);
    services.workspaceChanges.diff = async () => ({
      path: "a.js",
      kind: "text",
      hunks: Array.from({ length: 1001 }, () => ({
        oldStart: 1,
        newStart: 1,
        lines: ["+x"],
      })),
    });
    const s = await readSessionReview(services, "a", { checkpointSeq: 1 });
    assert.equal(s.hunks.length, 1000);
    assert.equal(s.capture.complete, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
