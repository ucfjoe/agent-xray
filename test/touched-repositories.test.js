import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  discoverRepositories,
  repositoryCandidates,
  literalShellWords,
} from "../plugin/touched-repositories.js";
const run = promisify(execFile);
const execFor = (cwd, args, name = "bash") => ({
  name,
  arguments: args,
  agent: { session: { id: "s", header: { cwd } } },
});
test("literal command discovery handles quoted directories and git -C without interpreting script strings or expressions", () => {
  const r = repositoryCandidates(
    execFor("/workspace", {
      command:
        "cd \"/other repo\" && git -C sub status; python -c \"open('/third/repo/file.py').write('x')\"; echo $(touch /must-not-run)",
    }),
  );
  assert.ok(r.candidates.includes("/other repo"));
  assert.ok(r.candidates.includes("/other repo/sub"));
  assert.ok(!r.candidates.includes("/third/repo/file.py"));
  assert.ok(r.notices.some((n) => n.includes("dynamic")));
  assert.deepEqual(literalShellWords('cd "$HOME/repo"'), ["cd", null]);
  assert.deepEqual(literalShellWords("echo 'literal $HOME'"), [
    "echo",
    "literal $HOME",
  ]);
});
test("discovers separate repositories and linked worktrees by canonical top-level, not common gitdir", async () => {
  const temp = await mkdtemp(join(tmpdir(), "xray-roots-"));
  try {
    const main = join(temp, "main"),
      other = join(temp, "other repo "),
      worktree = join(temp, "linked");
    for (const root of [main, other]) {
      await mkdir(root);
      await run("git", ["init", "-q", root]);
    }
    await writeFile(join(main, "a.txt"), "base");
    await run("git", ["-C", main, "add", "a.txt"]);
    await run("git", [
      "-C",
      main,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "base",
    ]);
    await run("git", ["-C", main, "worktree", "add", "--detach", worktree]);
    const result = await discoverRepositories({
      exec: execFor(main, {
        workdir: other,
        command: `git -C "${worktree}" status`,
      }),
    });
    assert.deepEqual(
      new Set(result.roots),
      new Set(
        await Promise.all([main, other, worktree].map((p) => realpath(p))),
      ),
    );
    assert.deepEqual(result.notices, []);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
test("new file paths resolve through an existing repository ancestor; non-repositories stay out", async () => {
  const temp = await mkdtemp(join(tmpdir(), "xray-path-"));
  try {
    const root = join(temp, "repo");
    await mkdir(root);
    await run("git", ["init", "-q", root]);
    const result = await discoverRepositories({
      exec: execFor(temp, { file_path: join(root, "new", "deep", "a.py") }),
    });
    assert.deepEqual(result.roots, [await realpath(root)]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
test("discovery respects cancellation, input limits and unknown persistent-shell cwd", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await discoverRepositories({
    exec: { ...execFor("/missing", {}), signal: controller.signal },
  });
  assert.deepEqual(result.roots, []);
  assert.ok(result.notices.length);
  const bounded = repositoryCandidates(
    execFor("/root", {
      command: Array.from({ length: 50 }, (_, i) => "/repo" + i).join(" "),
    }),
  );
  assert.equal(bounded.candidates.length, 32);
  assert.ok(bounded.notices.some((n) => n.includes("limit")));
  assert.ok(
    repositoryCandidates(
      execFor("/root", { command: "pwd" }, "bash_persistent"),
    ).notices.some((n) => n.includes("persistent")),
  );
});

test("worktree creation destinations are rediscoverable after the command", () => {
  const r = repositoryCandidates(
    execFor("/workspace", {
      command: 'git -C "/repos/project" worktree add -b feature "../new tree"',
    }),
  );
  assert.ok(r.candidates.includes("/repos/new tree"));
});
