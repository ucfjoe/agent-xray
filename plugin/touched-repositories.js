import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
const run = promisify(execFile);
const MAX_CANDIDATES = 32,
  MAX_ROOTS = 8;

// Tokenize literal shell words only. This is discovery, never shell evaluation.
// Dynamic words are discarded: expanding them here could run code or invent paths.
export function literalShellWords(command) {
  const words = [];
  let word = "",
    quote = "",
    dynamic = false,
    started = false;
  const finish = () => {
    if (started) words.push(dynamic ? null : word);
    word = "";
    dynamic = false;
    started = false;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) {
        quote = "";
        continue;
      }
      if (quote === '"' && (c === "$" || c === "`")) dynamic = true;
      if (quote === '"' && c === "\\" && i + 1 < command.length) {
        word += command[++i];
        continue;
      }
      word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      started = true;
      continue;
    }
    if (c === "\\" && i + 1 < command.length) {
      word += command[++i];
      started = true;
      continue;
    }
    if (/\s/.test(c) || /[;&|()<>]/.test(c)) {
      finish();
      if (!/\s/.test(c)) words.push(c);
      continue;
    }
    if (c === "#" && !started) {
      while (i < command.length && command[i] !== "\n") i++;
      finish();
      continue;
    }
    if (/[\$`*?\[\]{}~]/.test(c)) dynamic = true;
    word += c;
    started = true;
  }
  if (quote) dynamic = true;
  finish();
  return words;
}

export function repositoryCandidates(exec) {
  const args =
    exec.arguments && typeof exec.arguments === "object" ? exec.arguments : {};
  const cwd = exec.agent?.session?.header?.cwd;
  const candidates = [],
    notices = [];
  const add = (value, base = cwd) => {
    if (typeof value !== "string" || !value || value.includes("\0")) return;
    if (!isAbsolute(value) && (typeof base !== "string" || !isAbsolute(base)))
      return;
    const path = resolve(base ?? "/", value);
    if (!candidates.includes(path)) candidates.push(path);
  };
  add(cwd);
  for (const field of ["workdir", "cwd", "file_path", "path"]) add(args[field]);
  const workdir =
    typeof args.workdir === "string"
      ? args.workdir
      : typeof args.cwd === "string"
        ? args.cwd
        : cwd;
  const base =
    typeof cwd === "string" && isAbsolute(cwd)
      ? resolve(cwd, workdir ?? ".")
      : isAbsolute(workdir ?? "")
        ? workdir
        : undefined;
  if (typeof args.command === "string") {
    const words = literalShellWords(args.command.slice(0, 64000));
    let current = base,
      gitBase;
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (!word) continue;
      if ([";", "&", "|"].includes(word)) gitBase = undefined;
      if (word === "git" || word.endsWith("/git")) gitBase = current;
      if (word === "cd" && words[i + 1] && !words[i + 1].startsWith("-")) {
        add(words[i + 1], current);
        if (current || isAbsolute(words[i + 1]))
          current = resolve(current ?? "/", words[i + 1]);
      }
      if (word === "-C" && words[i + 1]) {
        add(words[i + 1], gitBase ?? current);
        if (gitBase || isAbsolute(words[i + 1]))
          gitBase = resolve(gitBase ?? current ?? "/", words[i + 1]);
      }
      if (word.startsWith("-C") && word.length > 2) {
        add(word.slice(2), gitBase ?? current);
        if (gitBase || isAbsolute(word.slice(2)))
          gitBase = resolve(gitBase ?? current ?? "/", word.slice(2));
      }
      if (isAbsolute(word)) add(word);
      if (word === "worktree" && words[i + 1] === "add") {
        let j = i + 2;
        while (j < words.length && words[j]?.startsWith("-")) {
          if (["-b", "-B", "--orphan"].includes(words[j])) j += 2;
          else if (words[j] === "--") {
            j++;
            break;
          } else j++;
        }
        if (words[j] && !/[;&|()<>]/.test(words[j]))
          add(words[j], gitBase ?? current);
      }
    }
    if (words.includes(null) || args.command.length > 64000)
      notices.push(
        "Some shell paths use dynamic expressions or exceed the discovery limit; their repositories may not be discovered.",
      );
    // Persistent shells do not expose their current directory in the tool contract.
    if (
      /bash|pwsh|persistent|terminal|shell/.test(exec.name ?? "") &&
      !args.workdir &&
      !args.cwd
    )
      notices.push(
        "Shell working-directory changes in a persistent process may not be visible; only explicit recorded paths can be discovered.",
      );
  }
  if (candidates.length > MAX_CANDIDATES)
    notices.push("Repository discovery candidate limit reached.");
  return { candidates: candidates.slice(0, MAX_CANDIDATES), notices };
}

function gitEnvironment() {
  const env = {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
  };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_NAMESPACE",
  ])
    delete env[key];
  return env;
}
async function repositoryRoot(candidate, signal) {
  let dir = candidate;
  for (let depth = 0; depth < 24; depth++) {
    if (signal?.aborted) return undefined;
    try {
      const info = await stat(dir);
      if (!info.isDirectory()) dir = dirname(dir);
      const { stdout } = await run(
        "git",
        ["--no-optional-locks", "-C", dir, "rev-parse", "--show-toplevel"],
        {
          timeout: 1500,
          maxBuffer: 16000,
          signal,
          env: gitEnvironment(),
        },
      );
      return await realpath(stdout.replace(/\r?\n$/, ""));
    } catch (error) {
      // Once an existing directory is checked, Git itself traverses its parents.
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") return undefined;
      const parent = dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
    }
  }
  return undefined;
}

export async function discoverRepositories({
  exec,
  knownRoots = [],
  signal: phaseSignal,
}) {
  const { candidates, notices } = repositoryCandidates(exec);
  const roots = [];
  const deadline = AbortSignal.timeout(3000);
  const signal = AbortSignal.any(
    [exec.signal, phaseSignal, deadline].filter(Boolean),
  );
  // Retained identities are revalidated rather than trusting a deleted/replaced path.
  for (const candidate of [
    ...new Set([...knownRoots.slice(0, MAX_ROOTS), ...candidates]),
  ]) {
    if (signal.aborted) {
      notices.push("Repository discovery interrupted or timed out.");
      break;
    }
    const root = await repositoryRoot(candidate, signal);
    if (!root || roots.includes(root)) continue;
    if (roots.length >= MAX_ROOTS) {
      notices.push(
        "Session repository limit reached; additional roots are not monitored.",
      );
      break;
    }
    roots.push(root);
  }
  if (signal.aborted)
    notices.push("Repository discovery interrupted or timed out.");
  return { roots, notices: [...new Set(notices)], complete: !signal.aborted };
}
