import test from "node:test";
import assert from "node:assert/strict";
import { readSessionReview } from "../plugin/dsh-adapter.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const event = (seq, type, data) => ({ seq, type, data, time: 1000 + seq });
const history = (id, cwd) => ({
  session: { id, cwd },
  events: [
    event(0, "turn/start", { turn: 1 }),
    event(1, "user/message", {
      content: [{ type: "text", text: "Protect sign in" }],
      source: { kind: "user" },
    }),
    event(2, "tool/call", {
      turn: 1,
      callId: "c",
      name: "edit",
      arguments: '{"file_path":"a.ts"}',
    }),
    event(3, "tool/result", {
      turn: 1,
      message: { toolCallId: "c", content: [] },
      meta: { diffs: [{ path: "a.ts", oldText: "old\n", newText: "new\n" }] },
    }),
  ],
});
test("session adapter isolates roots, restores recorded edits, and never invents line offsets", async () => {
  const root = await mkdtemp(join(tmpdir(), "xray-"));
  try {
    const services = {
      sessionQuery: {
        readSession: async (id) => {
          if (id === "missing") throw Error("not found");
          return history(id, root);
        },
      },
    };
    const a = await readSessionReview(services, "a");
    const b = await readSessionReview(services, "b");
    assert.equal(a.sessionId, "a");
    assert.equal(b.sessionId, "b");
    assert.equal(a.hunks.length, 1);
    assert.equal(a.hunks[0].rangeKind, "excerpt");
    assert.equal(a.objectives.length, 1);
    assert.notEqual(a.snapshotId, b.snapshotId);
    await assert.rejects(() => readSessionReview(services, "missing"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("missing session context cannot fall back to a configured repository", async () => {
  await assert.rejects(() => readSessionReview({}, ""), /session/i);
});
import { createHistoryStore } from "../plugin/history-store.js";
test("history is immutable and isolated across sessions after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "xray-history-"));
  try {
    const store = createHistoryStore(root);
    await store.put({
      sessionId: "a",
      snapshotId: "s",
      capturedAt: 1,
      title: "before",
    });
    await store.put({
      sessionId: "a",
      snapshotId: "s",
      capturedAt: 2,
      title: "after",
    });
    const again = createHistoryStore(root);
    assert.equal((await again.get("a", "s")).title, "before");
    assert.equal(await again.get("b", "s"), undefined);
    assert.equal((await again.list("a")).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
