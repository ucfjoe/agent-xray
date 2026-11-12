import test from "node:test";
import assert from "node:assert/strict";
import { projectCheck, checksForHunk } from "../core/verification.js";
import { traceFigure } from "../ui/figures.js";
import { render } from "../ui/render.js";
import { normalizeSnapshot } from "../core/model.js";
import { initialState } from "../ui/state.js";

test("live/legacy/forged command success never establishes tested code or coverage", () => {
  for (const status of [
    "passed",
    "succeeded",
    "completed",
    "recorded",
    "failed",
  ]) {
    const c = projectCheck(
      { source: "live" },
      {
        status,
        output: "exit code: 0; all tests passed",
        snapshotId: "same",
        testOutcome: "passed",
        binding: "exact-content",
        provenance: "demo",
      },
    );
    assert.equal(c.testOutcome, "unknown");
    assert.equal(c.binding, "unlinked");
    assert.equal(c.status, "not verified");
  }
});
test("shared command/edit context is identical in inspector and diagram without implying coverage", () => {
  const s = normalizeSnapshot({
    hunks: [{ id: "h", eventId: "e", path: "a.js", lines: ["+x"] }],
    events: [{ id: "e", seq: 1 }],
    checks: [
      {
        id: "c",
        eventId: "e",
        status: "passed",
        command: "run",
        output: "passed",
      },
    ],
  });
  const before = structuredClone(s);
  assert.equal(checksForHunk(s, s.hunks[0])[0].binding, "contextual");
  assert.match(traceFigure(s, s.hunks[0]), /Not verified/);
  const html = render(
    s,
    { ...initialState(), selected: "h" },
    { source: "session" },
  );
  assert.match(html, /not verified/);
  assert.doesNotMatch(html, /badge passed/);
  assert.deepEqual(s, before);
});
test("only explicitly isolated example evidence retains illustrative results", () => {
  const check = { status: "passed", provenance: "demo", hunkIds: ["h"] };
  assert.equal(projectCheck({ source: "demo" }, check).status, "passed");
  assert.equal(projectCheck({ source: "live" }, check).status, "not verified");
  assert.equal(
    projectCheck({ source: "demo" }, { status: "passed" }).status,
    "not verified",
  );
});
