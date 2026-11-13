import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
import { mkdirSync } from "node:fs";
export const name = "xray-contract-fixtures";
export const inject = ["sessions", "webServer", "agents", "tools"];
export function apply(ctx) {
  if (process.env.XRAY_FIXTURES !== "1") return;
  let shellFixture;
  ctx.effect(() =>
    ctx.get("webServer").register({
      kind: "prefix",
      path: "/xray-contract/repositories",
      handler: async (req, res) => {
        const connection = ctx.get("connection");
        if (!connection?.admit) {
          res.writeHead(503);
          res.end();
          return;
        }
        const admission = connection.admit(req);
        if ("rejection" in admission) {
          res.writeHead(admission.rejection);
          res.end();
          return;
        }
        if (req.method !== "POST") {
          res.writeHead(405, { Allow: "POST" });
          res.end();
          return;
        }
        try {
          shellFixture ??= runRepositoryFixture(ctx);
          const value = await shellFixture;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(value));
        } catch (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(error) }));
        }
      },
    }),
  );
  for (const suffix of ["a", "b"]) {
    const cwd = join(process.env.XRAY_TEST_REPOSITORY, "contract-" + suffix);
    mkdirSync(cwd, { recursive: true });
    const session = ctx
      .get("sessions")
      .create("xray-contract-" + suffix, { meta: { cwd } });
    session.append("turn/start", { turn: 0 });
    session.append("step/start", { turn: 0, step: 0 });
    session.append(
      "user/message",
      {
        role: "user",
        id: "request-" + suffix,
        source: { kind: "user" },
        content: [
          {
            type: "text",
            text: "Contract fixture " + suffix + ": validate greeting",
          },
        ],
      },
      { surfaceOp: "append" },
    );
    session.append("tool/call", {
      turn: 0,
      step: 0,
      callId: "edit-" + suffix,
      name: "edit",
      arguments: JSON.stringify({ file_path: "greet.js" }),
    });
    session.append(
      "tool/result",
      {
        turn: 0,
        step: 0,
        message: {
          role: "tool",
          id: "result-" + suffix,
          source: { kind: "tool", callId: "edit-" + suffix },
          toolCallId: "edit-" + suffix,
          content: [
            {
              type: "text",
              text: "Deterministic test fixture, not a model execution.",
            },
          ],
        },
        meta: {
          diffs: [
            {
              path: "greet.js",
              oldText: "return name;\n",
              newText: "return name.trim();\n",
            },
            {
              path: join(cwd, "..", "other-repo-" + suffix, "greet.js"),
              oldText: "old\n",
              newText: "external\n",
            },
            {
              path: "../worktree-" + suffix + "/greet.js",
              oldText: "old\n",
              newText: "worktree\n",
            },
          ],
        },
      },
      { surfaceOp: "append" },
    );
    session.append("step/end", { turn: 0, step: 0 });
    session.append("turn/end", { turn: 0, reason: "completed" });
  }
}

// Exercise the real tool registry and native bash implementation without an LLM.
// Deliberately no supplied diff metadata: Agent X-Ray must observe filesystem deltas.
async function runRepositoryFixture(ctx) {
  // The native workspace-write policy permits host temp areas. Keep the
  // controlled sibling repositories there; do not relax any production policy.
  const parent = await mkdtemp(join(tmpdir(), "xray-shell-contract-"));
  let handle;
  ctx.effect(() => async () => {
    try {
      await handle?.dispose();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
  const workspace = join(parent, "opened"),
    external = join(parent, "external"),
    worktree = join(parent, "linked-worktree");
  const git = (cwd, args) =>
    run("git", ["-C", cwd, ...args], { timeout: 10000 });
  for (const root of [workspace, external]) {
    await mkdir(root);
    await git(root, ["init", "-q"]);
    await writeFile(join(root, "changed.txt"), "committed baseline\n");
    await writeFile(join(root, "existing.txt"), "committed baseline\n");
    await git(root, ["add", "."]);
    await git(root, [
      "-c",
      "user.name=X-Ray Lab",
      "-c",
      "user.email=lab@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "baseline",
    ]);
  }
  await git(external, ["worktree", "add", "--detach", worktree]);
  for (const root of [external, worktree]) {
    await writeFile(join(root, "changed.txt"), "pre-existing dirty baseline\n");
    await writeFile(
      join(root, "existing.txt"),
      "unrelated pre-existing dirt\n",
    );
  }
  const sessionId = "xray-shell-capture-" + parent.split("/").at(-1);
  // Web DSH moves Bash behind agent presets; a bare Agent has no shell tool.
  // Mirror the native session controller's pre-publication composition.
  const presets = ctx.get("agentPresets");
  const preset = presets ? await presets.resolve(undefined) : undefined;
  let tools;
  handle = await ctx.get("agents").create({
    sessionId,
    meta: { cwd: workspace, ...(preset ? { agentPreset: preset.id } : {}) },
    setup: async (agentCtx) => {
      if (preset) await presets.mount(agentCtx, preset.id);
      tools = agentCtx.get("tools");
      tools.presentAs("native");
    },
  });
  const agent = handle.agent,
    session = agent.session;
  session.append("turn/start", { turn: 0 });
  session.append("step/start", { turn: 0, step: 0 });
  for (const [index, root] of [external, worktree].entries()) {
    const callId = "shell-observation-" + index;
    const args = {
      command: `printf '%s\\n' 'observed shell write ${index}' >> changed.txt`,
      workdir: root,
      description: "Append controlled shell fixture evidence",
    };
    session.append("tool/call", {
      turn: 0,
      step: 0,
      callId,
      name: "bash",
      arguments: JSON.stringify(args),
    });
    const result = await tools.execute({
      callId,
      name: "bash",
      arguments: args,
      agent,
      signal: AbortSignal.timeout(20000),
    });
    if (
      result.isError ||
      result.value?.kind !== "foreground" ||
      result.value.exitCode !== 0
    )
      throw Error("Native fixture bash failed: " + JSON.stringify(result));
    session.append(
      "tool/result",
      {
        turn: 0,
        step: 0,
        message: {
          role: "tool",
          id: "result-" + callId,
          source: { kind: "tool", callId },
          toolCallId: callId,
          content: result.content,
          isError: result.isError,
        },
      },
      { surfaceOp: "append" },
    );
  }
  session.append("step/end", { turn: 0, step: 0 });
  session.append("turn/end", { turn: 0, reason: "completed" });
  return { sessionId, external, worktree };
}
