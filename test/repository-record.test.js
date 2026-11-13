import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { boundRepositoryRecord } from "../plugin/repository-record.js";
import { createHistoryStore } from "../plugin/history-store.js";
const record = () => ({
  sessionId: "s",
  seq: 1,
  callId: "c",
  rootCallId: "root",
  capturedAt: 123,
  observations: [
    { root: "/repo", repositoryId: "repo", notices: [], hunks: [], files: [] },
  ],
  notices: [],
});
test("record bound includes complete serialized metadata and preserves identity", () => {
  const input = record();
  input.notices = Array.from({ length: 100 }, () => "n".repeat(1000));
  input.observations[0].hunks = [
    { path: "/repo/a", lines: ["+" + "x".repeat(2000)] },
  ];
  const result = boundRepositoryRecord(input, { maxBytes: 1024 });
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 1024);
  for (const key of ["sessionId", "seq", "callId", "rootCallId", "capturedAt"])
    assert.equal(result[key], input[key]);
  assert.ok(result.notices.some((n) => n.includes("limit reached")));
  assert.equal(input.notices.length, 100);
});
test("oversized hunk is omitted intact without hiding a later small hunk", () => {
  const input = record();
  input.observations[0].hunks = [
    { path: "/repo/large", lines: ["+" + "x".repeat(5000)] },
    { path: "/repo/small", lines: ["+small"] },
  ];
  const result = boundRepositoryRecord(input, { maxBytes: 1024 });
  assert.deepEqual(result.observations[0].hunks, [
    input.observations[0].hunks[1],
  ]);
  assert.ok(result.notices.some((n) => n.includes("omitted")));
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 1024);
});
test("ordinary records retain exact data without a false limit notice", () => {
  const input = record();
  input.observations[0].hunks = [{ path: "/repo/a", lines: ["+héllo"] }];
  assert.deepEqual(boundRepositoryRecord(input), input);
});
test("sidecar reader skips oversized newest file and still reads older evidence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "xray-record-bound-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createHistoryStore(root),
    input = record();
  await store.putRepositoryCapture("s", 1, "c", input);
  const hash = (x) => createHash("sha256").update(x).digest("hex");
  const dir = join(root, hash("s"), "repository-captures");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "00000000000000000002-" + hash("too-large") + ".json"),
    "x".repeat(4000001),
  );
  const result = await store.getRepositoryCaptures("s", 2);
  assert.ok(result.some((r) => r.seq === 1 && r.callId === "c"));
  assert.ok(
    result.some((r) => r.notices.some((n) => n.includes("limit reached"))),
  );
});
