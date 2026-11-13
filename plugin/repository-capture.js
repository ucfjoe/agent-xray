import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath, lstat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { structuredPatch } from "diff";

const run = promisify(execFile);
const MAX_FILE = 512000,
  MAX_TOTAL = 4000000,
  MAX_FILES = 100;
const hash = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);
const env = () => {
  const result = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
  ])
    delete result[key];
  return result;
};
async function git(
  root,
  args,
  signal,
  maxBuffer = MAX_TOTAL,
  encoding = "utf8",
) {
  signal?.throwIfAborted();
  return (
    await run(
      "git",
      [
        "--literal-pathspecs",
        "-c",
        "core.quotePath=false",
        "-c",
        "core.fsmonitor=false",
        ...args,
      ],
      { cwd: root, env: env(), signal, timeout: 10000, maxBuffer, encoding },
    )
  ).stdout;
}
async function head(root, signal) {
  try {
    return (await git(root, ["rev-parse", "--verify", "HEAD"], signal)).trim();
  } catch (error) {
    signal?.throwIfAborted();
    if (error.code !== 128) throw error;
    return null;
  }
}
async function dirty(root, revision, signal) {
  const tracked = revision
    ? await git(
        root,
        [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          "--name-only",
          "-z",
          revision,
          "--",
        ],
        signal,
      )
    : await git(root, ["ls-files", "--cached", "-z"], signal);
  const untracked = await git(
    root,
    ["ls-files", "--others", "--exclude-standard", "-z"],
    signal,
  );
  // These index flags suppress ordinary worktree dirty detection. Capture their
  // actual bytes even when Git reports them clean; never use HEAD as pre-state.
  const flagged = (await git(root, ["ls-files", "-v", "-z"], signal))
    .split("\0")
    .filter((entry) => /^[a-zS] /.test(entry))
    .map((entry) => entry.slice(2));
  return [
    ...new Set([
      ...(tracked + untracked).split("\0").filter(Boolean),
      ...flagged,
    ]),
  ];
}
function fullPath(root, path) {
  const full = resolve(root, path),
    rel = relative(root, full);
  if (!rel || rel === ".." || rel.startsWith("../") || isAbsolute(rel))
    throw Error("Unsafe repository path");
  return full;
}
async function working(root, path, signal) {
  signal?.throwIfAborted();
  const full = fullPath(root, path);
  let handle;
  try {
    const stat = await lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink())
      return {
        kind: "unavailable",
        reason: "Non-regular files and symlinks are not read.",
      };
    const canonical = await realpath(full),
      rel = relative(root, canonical);
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel))
      return {
        kind: "unavailable",
        reason: "Path resolves outside the repository.",
      };
    if (stat.size > MAX_FILE)
      return {
        kind: "unavailable",
        reason: "File exceeds 512 KB capture limit.",
      };
    handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.size > MAX_FILE ||
      opened.ino !== stat.ino ||
      opened.dev !== stat.dev
    )
      return {
        kind: "unavailable",
        reason: "File changed while capture was opening it.",
      };
    // A bounded read remains bounded even if the file grows after stat.
    const buffer = Buffer.alloc(MAX_FILE + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    signal?.throwIfAborted();
    if (bytesRead > MAX_FILE)
      return {
        kind: "unavailable",
        reason: "File exceeds 512 KB capture limit.",
      };
    const bytes = buffer.subarray(0, bytesRead);
    const mode = opened.mode & 0o111 ? "100755" : "100644";
    return bytes.includes(0)
      ? { kind: "binary", digest: hash(bytes), mode }
      : { kind: "text", content: bytes.toString("utf8"), mode };
  } catch (error) {
    signal?.throwIfAborted();
    if (error.code === "ENOENT") return { kind: "deleted" };
    if (["ELOOP", "EACCES", "EPERM"].includes(error.code))
      return { kind: "unavailable", reason: "File could not be safely read." };
    throw error;
  } finally {
    await handle?.close();
  }
}
async function original(before, path, signal) {
  if (before.dirtyPaths.includes(path))
    return (
      before.entries.find((e) => e.path === path)?.state ?? {
        kind: "unavailable",
        reason: "Pre-existing changes exceeded the baseline capture limit.",
      }
    );
  if (!before.head) return { kind: "deleted" };
  try {
    // mode 120000 is a link: never treat its target string as source contents.
    const listing = await git(
      before.root,
      ["ls-tree", "-z", before.head, "--", path],
      signal,
    );
    if (!listing) return { kind: "deleted" };
    if (!listing.startsWith("100644 ") && !listing.startsWith("100755 "))
      return { kind: "unavailable", reason: "Baseline is not a regular file." };
    const object = before.head + ":" + path;
    const size = Number(
      (await git(before.root, ["cat-file", "-s", object], signal)).trim(),
    );
    if (size > MAX_FILE)
      return {
        kind: "unavailable",
        reason: "Baseline file exceeds 512 KB capture limit.",
      };
    const content = await git(
      before.root,
      ["cat-file", "blob", object],
      signal,
      MAX_FILE + 1,
      "buffer",
    );
    const mode = listing.slice(0, 6);
    return content.includes(0)
      ? { kind: "binary", digest: hash(content), mode }
      : { kind: "text", content: content.toString("utf8"), mode };
  } catch (error) {
    signal?.throwIfAborted();
    return {
      kind: "unavailable",
      reason: "Captured baseline Git object is unavailable.",
    };
  }
}
export async function captureRepository(directory, { signal } = {}) {
  const cwd = await realpath(directory);
  const root = await realpath(
    (await git(cwd, ["rev-parse", "--show-toplevel"], signal)).replace(
      /\r?\n$/,
      "",
    ),
  );
  const gitDir = await realpath(
    (await git(root, ["rev-parse", "--absolute-git-dir"], signal)).replace(
      /\r?\n$/,
      "",
    ),
  );
  const revision = await head(root, signal),
    dirtyPaths = await dirty(root, revision, signal);
  const entries = [],
    notices = [];
  let bytes = 0;
  for (const path of dirtyPaths.slice(0, MAX_FILES)) {
    const state = await working(root, path, signal);
    bytes += Buffer.byteLength(state.content ?? "");
    if (bytes > MAX_TOTAL) {
      notices.push("Repository baseline reached the 4 MB capture limit.");
      break;
    }
    entries.push({ path, state });
    if (state.kind === "unavailable")
      notices.push(`${fullPath(root, path)}: ${state.reason}`);
  }
  if (dirtyPaths.length > entries.length)
    notices.push(
      "Some pre-existing changes could not be baselined; they will not be attributed as new edits.",
    );
  return {
    root,
    gitDir,
    repositoryId: hash(root + "\0" + gitDir),
    head: revision,
    dirtyPaths,
    entries,
    notices,
    capturedAt: Date.now(),
  };
}
export async function compareRepository(before, { signal } = {}) {
  signal?.throwIfAborted();
  const currentGitDir = await realpath(
    (
      await git(before.root, ["rev-parse", "--absolute-git-dir"], signal)
    ).replace(/\r?\n$/, ""),
  );
  if (currentGitDir !== before.gitDir)
    throw Error("Repository identity changed during capture.");
  const currentHead = await head(before.root, signal),
    postDirty = await dirty(before.root, currentHead, signal);
  let committed = [];
  if (before.head !== currentHead) {
    if (before.head && currentHead)
      committed = (
        await git(
          before.root,
          [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "--name-only",
            "-z",
            before.head,
            currentHead,
            "--",
          ],
          signal,
        )
      )
        .split("\0")
        .filter(Boolean);
    else if (currentHead)
      committed = (
        await git(
          before.root,
          ["ls-tree", "-r", "--name-only", "-z", currentHead],
          signal,
        )
      )
        .split("\0")
        .filter(Boolean);
    else throw Error("Repository HEAD disappeared during capture.");
  }
  const candidates = [
    ...new Set([...before.dirtyPaths, ...postDirty, ...committed]),
  ];
  const files = [],
    hunks = [],
    notices = [...before.notices];
  let bytes = 0,
    outputBytes = 0;
  for (const path of candidates.slice(0, MAX_FILES)) {
    const old = await original(before, path, signal),
      next = await working(before.root, path, signal);
    if (JSON.stringify(old) === JSON.stringify(next)) continue;
    const absolute = fullPath(before.root, path);
    if (old.kind === "unavailable" || next.kind === "unavailable") {
      files.push({ path: absolute, kind: "unavailable" });
      notices.push(`${absolute}: ${old.reason ?? next.reason}`);
      continue;
    }
    if (old.kind === "binary" || next.kind === "binary") {
      files.push({ path: absolute, kind: "binary" });
      continue;
    }
    const oldText = old.content ?? "",
      newText = next.content ?? "";
    bytes += Buffer.byteLength(oldText) + Buffer.byteLength(newText);
    if (bytes > MAX_TOTAL) {
      notices.push("Repository comparison reached the 4 MB capture limit.");
      break;
    }
    const patch = structuredPatch(
      absolute,
      absolute,
      oldText,
      newText,
      "",
      "",
      { context: 3, timeout: 100 },
    );
    if (!patch) {
      files.push({ path: absolute, kind: "unavailable" });
      notices.push("A repository comparison exceeded its time limit.");
      continue;
    }
    files.push({
      path: absolute,
      kind:
        next.kind === "deleted"
          ? "deleted"
          : old.kind === "deleted"
            ? "added"
            : "modified",
    });
    const fileId = hash(absolute + "\0" + oldText + "\0" + newText);
    for (const [i, h] of patch.hunks.entries()) {
      const hunk = {
        id: fileId + ":" + i,
        path: absolute,
        title: path.split("/").at(-1),
        oldStart: h.oldStart,
        newStart: h.newStart,
        rangeKind: "file",
        lines: h.lines,
        provenance: "observed",
      };
      const size = Buffer.byteLength(JSON.stringify(hunk));
      if (hunks.length >= 1000 || outputBytes + size > MAX_TOTAL) {
        notices.push(
          "Repository comparison reached the 1,000 hunk / 4 MB output limit.",
        );
        break;
      }
      outputBytes += size;
      hunks.push(hunk);
    }
  }
  if (candidates.length > MAX_FILES)
    notices.push(
      `Repository comparison shows at most ${MAX_FILES} of ${candidates.length} candidate files.`,
    );
  return {
    root: before.root,
    repositoryId: before.repositoryId,
    hunks,
    files,
    notices: [...new Set(notices)],
    capturedAt: Date.now(),
  };
}
