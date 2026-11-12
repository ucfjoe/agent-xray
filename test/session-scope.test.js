import test from "node:test";
import assert from "node:assert/strict";
import { readSessionReview } from "../plugin/dsh-adapter.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const logFor = (cwd, diffs) => ({
  session: { id: "s", cwd },
  events: [
    {
      seq: 1,
      type: "tool/call",
      data: { name: "edit", callId: "c", arguments: "{}" },
    },
    {
      seq: 2,
      type: "tool/result",
      data: { message: { toolCallId: "c" }, meta: { diffs } },
    },
  ],
});
test("session includes recorded edits in other repositories and nonexistent worktrees without reading their files", async () => {
  const root = await mkdtemp(join(tmpdir(), "xray-scope-"));
  try {
    const paths = ["a.ts", "../repo-b/a.ts", "/nonexistent-xray-worktree/a.ts"];
    const log = logFor(
      root,
      paths.map((path) => ({ path, oldText: "old", newText: "new" })),
    );
    const result = await readSessionReview(
      { sessionQuery: { readSession: async () => log } },
      "s",
    );
    assert.equal(result.hunks.length, 3);
    assert.deepEqual(
      result.hunks.map((h) => h.path),
      ["a.ts", join(root, "../repo-b/a.ts"), "/nonexistent-xray-worktree/a.ts"],
    );
    assert.equal(result.hunks[1].rawPath, "../repo-b/a.ts");
    assert.equal(result.files[1].locationScope, "outside-workspace");
    assert.equal(result.hunks[2].rangeKind, "excerpt");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("host absolute checkpoints and file-only outside changes are retained", async () => {
  const root = await mkdtemp(join(tmpdir(), "xray-exact-"));
  try {
    const log = {
      session: { id: "s", cwd: root },
      events: [{ seq: 1, type: "workspace/changes", data: { turn: 1 } }],
    };
    const result = await readSessionReview(
      {
        sessionQuery: { readSession: async () => log },
        workspaceChanges: {
          summary: () => ({ total: 2, files: [{}, {}] }),
          diff: async (id, seq, i) =>
            i === 0
              ? {
                  path: "/other/repo/a.ts",
                  kind: "text",
                  hunks: [{ oldStart: 10, newStart: 10, lines: ["+new"] }],
                }
              : { path: "/other/worktree/icon.png", kind: "binary" },
        },
      },
      "s",
    );
    assert.equal(result.hunks[0].newStart, 10);
    assert.equal(result.hunks[0].path, "/other/repo/a.ts");
    assert.equal(result.files.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { createHistoryStore } from "../plugin/history-store.js";
import { readReview } from "../plugin/review-service.js";
import { captureReview } from "../plugin/checkpoints.js";
test("same-ID caches recover outside edits and old empty checkpoints without rewriting saved records", async () => {
  const root = await mkdtemp(join(tmpdir(), "xray-old-scope-"));
  try {
    const store = createHistoryStore(join(root, "cache"));
    const log = logFor(root, [
      { path: "/other/a.ts", oldText: "old", newText: "new" },
    ]);
    log.events.push({ seq: 3, type: "workspace/changes", data: { turn: 1 } });
    const services = {
      sessionQuery: { readSession: async () => log },
      workspaceChanges: {
        summary: () => ({ total: 1, files: [{}] }),
        diff: async () => ({
          path: "/other/a.ts",
          kind: "text",
          hunks: [{ oldStart: 20, newStart: 20, lines: ["+new"] }],
        }),
      },
      readCheckpoint: (id, seq) => store.getCheckpoint(id, seq),
    };
    const fresh = await readSessionReview(services, "s");
    const old = {
      ...fresh,
      pathScopeVersion: undefined,
      hunks: [],
      files: [],
      relationships: [],
      events: fresh.events.map((e) => ({ ...e, hunkIds: [] })),
    };
    await store.put(old);
    await store.putCheckpoint("s", 3, {
      sessionId: "s",
      seq: 3,
      hunks: [],
      files: [],
      event: old.events.at(-1),
      notices: [],
    });
    const result = await readReview({ services, store, sessionId: "s" });
    assert.equal(result.hunks.length, 2);
    assert.equal(result.snapshotId, old.snapshotId);
    assert.deepEqual(
      await store.get("s", old.snapshotId),
      JSON.parse(JSON.stringify(old)),
    );
    assert.ok(result.events.some((e) => e.hunkIds.includes(fresh.hunks[0].id)));
    await captureReview({
      services,
      store,
      sessionId: "s",
      seq: 3,
      type: "workspace/changes",
    });
    services.workspaceChanges.summary = () => undefined;
    assert.equal(
      (await readSessionReview(services, "s")).hunks.find(
        (h) => h.rangeKind === "file",
      ).newStart,
      20,
    );
    log.events.push(
      {
        seq: 4,
        type: "tool/call",
        data: { callId: "later", name: "edit", arguments: "{}" },
      },
      {
        seq: 5,
        type: "tool/result",
        data: {
          message: { toolCallId: "later" },
          meta: {
            diffs: [{ path: "/later/a.ts", oldText: "a", newText: "b" }],
          },
        },
      },
    );
    const historical = await readReview({
      services,
      store,
      sessionId: "s",
      snapshotId: old.snapshotId,
    });
    assert.equal(historical.hunks.length, 2);
    assert.ok(!historical.files.some((f) => f.path === "/later/a.ts"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { sessionPath } from "../plugin/session-path.js";
test("path identities separate repositories, normalize aliases and reject malformed locations", () => {
  assert.equal(
    sessionPath("/alias/project/a.ts", "/alias/project", "/real/project").path,
    "a.ts",
  );
  assert.equal(
    sessionPath("/real/project/a.ts", "/alias/project", "/real/project").path,
    "a.ts",
  );
  assert.equal(
    sessionPath("../repo/a.ts", "/home/project").path,
    "/home/repo/a.ts",
  );
  assert.equal(
    sessionPath("/home/project-extra/a.ts", "/home/project").locationScope,
    "outside-workspace",
  );
  assert.equal(sessionPath("..hidden", "/home/project").path, "..hidden");
  assert.equal(sessionPath("", "/home/project"), undefined);
  assert.equal(sessionPath("x\0y", "/home/project"), undefined);
  assert.notEqual(
    sessionPath("/repo-a/a.ts", "/home/project").path,
    sessionPath("/repo-b/a.ts", "/home/project").path,
  );
});
test("verified successful write creations appear without inventing failed or shell edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "xray-write-"));
  try {
    for (const [name, isError, operation, expected] of [
      ["write", false, "create", 1],
      ["write", true, "create", 0],
      ["bash", false, "create", 0],
      ["write", false, "update", 0],
    ]) {
      const log = {
        session: { id: "s", cwd: root },
        events: [
          {
            seq: 1,
            type: "tool/call",
            data: {
              name,
              callId: "c",
              arguments: JSON.stringify({
                file_path: "/outside/new.ts",
                content: "export const x=1;\n",
              }),
            },
          },
          {
            seq: 2,
            type: "tool/result",
            data: {
              message: { toolCallId: "c", isError },
              meta: { operation, diffs: [] },
            },
          },
        ],
      };
      const s = await readSessionReview(
        { sessionQuery: { readSession: async () => log } },
        "s",
      );
      assert.equal(s.hunks.length, expected, `${name} ${isError} ${operation}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { recoverSession } from "../plugin/recover-session.js";
import { normalizeSnapshot } from "../core/model.js";
test("additive cache recovery keeps preview bounds and does not link omitted hunks", () => {
  const old = normalizeSnapshot({
    sessionId: "s",
    snapshotId: "same",
    hunks: Array.from({ length: 1000 }, (_, i) => ({
      id: "old" + i,
      path: "old.ts",
      lines: ["+x"],
    })),
  });
  const replay = normalizeSnapshot({
    sessionId: "s",
    snapshotId: "same",
    hunks: [{ id: "new", path: "/other/new.ts", lines: ["+x"] }],
    events: [{ id: "event", hunkIds: ["new"] }],
    relationships: [{ hunkId: "new", kind: "task", target: "task" }],
  });
  const merged = recoverSession(old, replay);
  assert.equal(merged.hunks.length, 1000);
  assert.ok(!merged.relationships.some((r) => r.hunkId === "new"));
  assert.ok(merged.events.every((e) => !e.hunkIds?.includes("new")));
  assert.ok(merged.notices.some((n) => /limit/i.test(n)));
});
