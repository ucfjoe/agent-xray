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
