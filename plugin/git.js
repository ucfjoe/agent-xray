import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";

const execute = promisify(execFile);

export function parseDiff(diff) {
  const changes = [];
  let path = "";
  let current;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) current = undefined;
    if (!current && line.startsWith("--- a/"))
      path = line.slice(6).split("\t")[0];
    if (!current && line.startsWith("+++ b/"))
      path = line.slice(6).split("\t")[0];
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (hunk) {
      current = {
        path,
        oldLine: Number(hunk[1]),
        newLine: Number(hunk[2]),
        lines: [],
        task: null,
        capability: null,
        module: path.includes("/") ? path.split("/")[0] : "Repository root",
        risk: null,
        milestone: "Working tree",
        story: path,
        action: "Event attribution unavailable",
        evidence:
          "Observed Git diff against HEAD in the configured test repository. Agent attribution unavailable.",
        verification: "Verification evidence unavailable.",
      };
      changes.push(current);
    } else if (current && /^[ +\-]/.test(line)) {
      current.lines.push(line);
    }
  }
  for (const change of changes) {
    change.id = createHash("sha256")
      .update(
        JSON.stringify([
          change.path,
          change.oldLine,
          change.newLine,
          change.lines,
        ]),
      )
      .digest("hex");
  }
  return changes;
}

export async function readChanges(repository) {
  const options = {
    cwd: repository,
    timeout: 10000,
    maxBuffer: 4 * 1024 * 1024,
  };
  const { stdout: diff } = await execute(
    "git",
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--unified=3",
      "HEAD",
      "--",
    ],
    options,
  );
  const { stdout: untracked } = await execute(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    options,
  );
  return {
    changes: parseDiff(diff),
    note:
      "Configured test repository · Tracked text hunks against HEAD. Binary and rename-only changes have no displayed hunks. " +
      untracked.split("\0").filter(Boolean).length +
      " untracked files excluded.",
  };
}
