import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { readWorkspaceReview } from "../plugin/workspace.js";
test("workspace handles untracked, deleted, binary, Unicode paths and symlinks without reading outside", async () => {
  const root = await mkdtemp(join(tmpdir(), "xray-files-"));
  const git = (...args) => execFileSync("git", ["-C", root, ...args]);
  try {
    git("init", "-b", "main");
    await writeFile(join(root, "delete.js"), "old\n");
    git("add", ".");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "fixture",
    );
    await rm(join(root, "delete.js"));
    await writeFile(join(root, "日本語\tfile.js"), "new\n");
    await writeFile(join(root, "binary.dat"), Buffer.from([0, 1, 2]));
    await symlink("/etc/passwd", join(root, "outside"));
    const s = await readWorkspaceReview({
      root,
      sessionId: "a",
      workspaceId: "w",
    });
    assert.ok(s.hunks.some((h) => h.path === "日本語\tfile.js"));
    assert.ok(
      s.files.some((f) => f.path === "delete.js" && f.kind === "deleted"),
    );
    assert.ok(
      s.files.some((f) => f.path === "binary.dat" && f.kind === "binary"),
    );
    assert.ok(!s.hunks.some((h) => h.path === "outside"));
    assert.equal(s.objectives.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("100-file cap is explicit in an unborn repository", async () => {
  const root = await mkdtemp(join(tmpdir(), "xray-limit-"));
  try {
    execFileSync("git", ["-C", root, "init", "-b", "main"]);
    await Promise.all(
      Array.from({ length: 102 }, (_, i) =>
        writeFile(join(root, `${i}.txt`), "new\n"),
      ),
    );
    const s = await readWorkspaceReview({
      root,
      sessionId: "a",
      workspaceId: "w",
    });
    assert.equal(s.files.length, 100);
    assert.ok(s.notices.some((n) => n.includes("100 of 102")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
