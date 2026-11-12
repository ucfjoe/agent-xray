import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseDiff, readChanges } from "../plugin/git.js";

test("separate hunks retain ranges and literal diff markers", () => {
  const hunks = parseDiff(
    "diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-old\n+new\n@@ -20,0 +21 @@\n+++literal\n",
  );
  assert.equal(hunks.length, 2);
  assert.equal(hunks[1].newLine, 21);
  assert.deepEqual(hunks[1].lines, ["+++literal"]);
  assert.notEqual(hunks[0].id, hunks[1].id);
});

test("real Git reader sees staged and unstaged edits and reports untracked files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xray-test-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args]);
  try {
    git("init", "-b", "main");
    await writeFile(join(dir, "file with spaces.js"), "old\n");
    git("add", ".");
    git(
      "-c",
      "user.name=Lab",
      "-c",
      "user.email=lab@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "fixture",
    );
    assert.equal((await readChanges(dir)).changes.length, 0);
    await writeFile(join(dir, "file with spaces.js"), "staged\n");
    git("add", ".");
    await writeFile(join(dir, "file with spaces.js"), "final\n");
    await writeFile(join(dir, "untracked.js"), "new\n");
    const result = await readChanges(dir);
    assert.equal(result.changes[0].path, "file with spaces.js");
    assert.deepEqual(result.changes[0].lines, ["-old", "+final"]);
    assert.match(result.note, /1 untracked/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
