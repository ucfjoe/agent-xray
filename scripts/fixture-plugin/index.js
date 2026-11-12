import { join } from "node:path";
import { mkdirSync } from "node:fs";
export const name = "xray-contract-fixtures";
export const inject = ["sessions"];
export function apply(ctx) {
  if (process.env.XRAY_FIXTURES !== "1") return;
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
          ],
        },
      },
      { surfaceOp: "append" },
    );
    session.append("step/end", { turn: 0, step: 0 });
    session.append("turn/end", { turn: 0, reason: "completed" });
  }
}
