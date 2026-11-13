import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  captureRepository,
  compareRepository,
} from "../plugin/repository-capture.js";
const git = (root, ...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" });
async function repo(t) {
  const parent = await mkdtemp(join(tmpdir(), "xray-repository-")),
    root = join(parent, "repo");
  await mkdir(root);
  t.after(() => rm(parent, { recursive: true, force: true }));
  git(root, "init", "-q");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.test");
  git(root, "config", "commit.gpgsign", "false");
  await writeFile(join(root, "a.txt"), "base\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  return { root, parent };
}
test("unchanged pre-existing dirty, staged and untracked changes are excluded", async (t) => {
  const { root } = await repo(t);
  await writeFile(join(root, "a.txt"), "old dirty\n");
  git(root, "add", "a.txt");
  await writeFile(join(root, "a.txt"), "old unstaged\n");
  await writeFile(join(root, "old.txt"), "old untracked\n");
  const before = await captureRepository(root);
  const after = await compareRepository(before);
  assert.equal(after.hunks.length, 0);
  assert.equal(after.files.length, 0);
  await writeFile(join(root, "a.txt"), "old unstaged\nnew session edit\n");
  const changed = await compareRepository(before);
  assert.equal(changed.hunks.length, 1);
  assert.ok(changed.hunks[0].lines.includes("+new session edit"));
  assert.ok(!changed.hunks[0].lines.includes("+old unstaged"));
});
test("changes committed during a tool are captured against the original working tree", async (t) => {
  const { root } = await repo(t);
  const before = await captureRepository(root);
  await writeFile(join(root, "a.txt"), "committed edit\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "during tool");
  const after = await compareRepository(before);
  assert.equal(after.hunks.length, 1);
  assert.ok(after.hunks[0].lines.includes("+committed edit"));
});
test("new untracked files and tracked deletions have exact ranges", async (t) => {
  const { root } = await repo(t);
  const before = await captureRepository(root);
  await rm(join(root, "a.txt"));
  await writeFile(join(root, "new.txt"), "new\n");
  const after = await compareRepository(before);
  assert.equal(after.files.length, 2);
  assert.ok(after.files.some((f) => f.kind === "deleted"));
  assert.ok(after.files.some((f) => f.kind === "added"));
  assert.ok(
    after.hunks.every(
      (h) => h.rangeKind === "file" && h.path.startsWith(before.root),
    ),
  );
});
test("linked worktrees have distinct canonical identity and independent captures", async (t) => {
  const { root, parent } = await repo(t);
  const worktree = join(parent, "worktree");
  git(root, "worktree", "add", "-qb", "other", worktree);
  const first = await captureRepository(root),
    second = await captureRepository(worktree);
  assert.notEqual(first.repositoryId, second.repositoryId);
  assert.notEqual(first.gitDir, second.gitDir);
  await writeFile(join(worktree, "a.txt"), "worktree only\n");
  assert.equal((await compareRepository(first)).hunks.length, 0);
  assert.equal((await compareRepository(second)).hunks.length, 1);
});
test("symlink escapes and oversized content remain unavailable and are never copied", async (t) => {
  const { root, parent } = await repo(t);
  const secret = join(parent, "private.txt");
  await writeFile(secret, "do-not-capture-secret");
  const before = await captureRepository(root);
  await symlink(secret, join(root, "escape"));
  await writeFile(join(root, "large"), Buffer.alloc(512001, 65));
  const after = await compareRepository(before);
  assert.equal(after.hunks.length, 0);
  assert.equal(after.files.length, 2);
  assert.ok(!JSON.stringify(after).includes("do-not-capture-secret"));
  assert.ok(after.files.every((f) => f.kind === "unavailable"));
});
test("aborted capture and comparison propagate cancellation", async (t) => {
  const { root } = await repo(t);
  const before = await captureRepository(root);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    captureRepository(root, { signal: controller.signal }),
    /abort/i,
  );
  await assert.rejects(
    compareRepository(before, { signal: controller.signal }),
    /abort/i,
  );
});
test("missing pre-dirty baseline cannot fall back to HEAD and misattribute old dirt", async (t) => {
  const { root } = await repo(t);
  await writeFile(join(root, "a.txt"), "pre-existing\n");
  const before = await captureRepository(root);
  before.entries = [];
  const after = await compareRepository(before);
  assert.equal(after.hunks.length, 0);
  assert.equal(after.files[0].kind, "unavailable");
  assert.ok(after.notices.some((n) => n.includes("Pre-existing")));
});
test("unborn repository preserves pre-existing staged/untracked baseline across first commit", async (t) => {
  const { root, parent } = await repo(t);
  const unborn = join(parent, "unborn");
  await mkdir(unborn);
  git(unborn, "init", "-q");
  git(unborn, "config", "user.name", "Test");
  git(unborn, "config", "user.email", "test@example.test");
  git(unborn, "config", "commit.gpgsign", "false");
  await writeFile(join(unborn, "old.txt"), "old\n");
  git(unborn, "add", ".");
  const before = await captureRepository(unborn);
  await writeFile(join(unborn, "new.txt"), "new\n");
  git(unborn, "add", ".");
  git(unborn, "commit", "-qm", "first");
  const after = await compareRepository(before);
  assert.equal(after.hunks.length, 1);
  assert.ok(after.hunks[0].path.endsWith("/new.txt"));
});
test("binary changes are metadata only and raw unchanged bytes do not become false changes", async (t) => {
  const { root } = await repo(t);
  await writeFile(join(root, "binary"), Buffer.from([0, 255, 254, 1]));
  git(root, "add", ".");
  git(root, "commit", "-qm", "binary");
  const before = await captureRepository(root);
  await writeFile(join(root, "binary"), Buffer.from([0, 255, 253, 1]));
  const changed = await compareRepository(before);
  assert.equal(changed.hunks.length, 0);
  assert.equal(changed.files[0].kind, "binary");
  await writeFile(join(root, "binary"), Buffer.from([0, 255, 254, 1]));
  assert.equal((await compareRepository(before)).files.length, 0);
});
for (const flag of ["assume-unchanged", "skip-worktree"]) {
  test(`${flag} hidden pre-existing edits are baselined and excluded`, async (t) => {
    const { root } = await repo(t);
    git(root, "update-index", "--" + flag, "a.txt");
    await writeFile(join(root, "a.txt"), "pre-existing hidden edit\n");
    const before = await captureRepository(root);
    assert.ok(before.dirtyPaths.includes("a.txt"));
    assert.equal((await compareRepository(before)).hunks.length, 0);
    // Both still-hidden writes and writes after the flag is cleared are covered.
    await writeFile(
      join(root, "a.txt"),
      "pre-existing hidden edit\nnew tool edit\n",
    );
    const hidden = await compareRepository(before);
    assert.ok(hidden.hunks[0].lines.includes("+new tool edit"));
    assert.ok(!hidden.hunks[0].lines.includes("+pre-existing hidden edit"));
    git(root, "update-index", "--no-" + flag, "a.txt");
    const cleared = await compareRepository(before);
    assert.deepEqual(cleared.hunks, hidden.hunks);
  });
}
test("repository names ending in spaces remain distinct from adjacent repositories", async (t) => {
  const { root, parent } = await repo(t);
  const spaced = join(parent, "repo ");
  await mkdir(spaced);
  git(spaced, "init", "-q");
  git(spaced, "config", "user.name", "Test");
  git(spaced, "config", "user.email", "test@example.test");
  git(spaced, "config", "commit.gpgsign", "false");
  await writeFile(join(spaced, "a.txt"), "space base\n");
  git(spaced, "add", ".");
  git(spaced, "commit", "-qm", "base");
  const before = await captureRepository(spaced);
  assert.ok(before.root.endsWith("repo "));
  assert.notEqual(before.root, (await captureRepository(root)).root);
  await writeFile(join(spaced, "a.txt"), "space edit\n");
  assert.ok(
    (await compareRepository(before)).hunks[0].lines.includes("+space edit"),
  );
});
