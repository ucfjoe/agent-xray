import test from "node:test";
import assert from "node:assert/strict";
import { readReview } from "../plugin/review-service.js";
import { createHistoryStore } from "../plugin/history-store.js";
import { normalizeSnapshot } from "../core/model.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("authorized saved history works after workspace removal without replay or identity changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "xray-saved-"));
  const store = createHistoryStore(root);
  try {
    const old = normalizeSnapshot({
      sessionId: "a",
      snapshotId: "old",
      title: "Saved",
      checkpointSeqs: [4],
    });
    await store.put(old);
    await store.putCheckpoint("a", 4, {
      sessionId: "a",
      seq: 4,
      hunks: [
        {
          id: "h",
          path: "a.js",
          rangeKind: "file",
          newStart: 20,
          lines: ["+x"],
        },
      ],
      files: [{ path: "a.js" }],
      event: { id: "e", seq: 4, type: "checkpoint" },
      relationships: [],
      notices: [],
    });
    const services = {
      sessionQuery: {
        readSession: async (id) => ({
          session: { id, cwd: join(root, "deleted") },
          get events() {
            throw Error("Must not replay");
          },
        }),
      },
    };
    const result = await readReview({
      services,
      store,
      sessionId: "a",
      snapshotId: "old",
    });
    assert.equal(result.snapshotId, "old");
    assert.equal(result.hunks[0].newStart, 20);
    assert.deepEqual(await store.get("a", "old"), old);
    await assert.rejects(
      () => readReview({ services, store, sessionId: "b", snapshotId: "old" }),
      (e) => e.statusCode === 404,
    );
    await assert.rejects(
      () =>
        readReview({
          services: {
            sessionQuery: {
              readSession: async () => ({ session: { id: "other" } }),
            },
          },
          store,
          sessionId: "a",
          snapshotId: "old",
        }),
      /identity/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
