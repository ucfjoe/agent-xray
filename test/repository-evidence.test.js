import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHistoryStore } from "../plugin/history-store.js";
import { enrichRepositoryEvidence } from "../plugin/repository-evidence.js";
import { normalizeSnapshot } from "../core/model.js";
test("repository sidecars survive restart, are immutable/session-isolated, and respect old snapshot boundaries", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "xray-sidecars-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createHistoryStore(dir);
  const record = {
    sessionId: "s",
    seq: 4,
    callId: "c",
    capturedAt: 123,
    notices: [],
    observations: [
      {
        root: "/other",
        hunks: [
          {
            path: "/other/a.ts",
            newStart: 1,
            oldStart: 1,
            rangeKind: "file",
            lines: ["+new"],
          },
        ],
        files: [],
      },
    ],
  };
  await store.putRepositoryCapture("s", 4, "c", record);
  await store.putRepositoryCapture("s", 4, "c", {
    ...record,
    observations: [],
  });
  const restarted = createHistoryStore(dir);
  assert.equal(
    (await restarted.getRepositoryCaptures("s", 4))[0].observations.length,
    1,
  );
  assert.equal((await restarted.getRepositoryCaptures("other", 99)).length, 0);
  const snapshot = normalizeSnapshot({
    root: "/workspace",
    sessionId: "s",
    snapshotId: "old",
    identity: { throughSeq: 3 },
  });
  assert.equal(
    (await enrichRepositoryEvidence(snapshot, restarted)).hunks.length,
    0,
  );
  const current = { ...snapshot, identity: { throughSeq: 4 } };
  const enriched = await enrichRepositoryEvidence(current, restarted);
  assert.equal(enriched.hunks.length, 1);
  assert.equal(enriched.events[0].type, "observation");
  assert.equal(enriched.hunks[0].path, "/other/a.ts");
  assert.equal(enriched.hunks[0].attribution, "interval-only");
  assert.equal(
    enriched.relationships.some((r) => r.kind === "task"),
    false,
  );
  assert.equal(current.hunks.length, 0);
  assert.equal(
    (await enrichRepositoryEvidence(enriched, restarted)).hunks.length,
    1,
  );
});
