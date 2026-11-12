import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSnapshot, projectReview } from "../core/model.js";
test("unknown attribution is zero objectives, not a fabricated task", () => {
  const s = normalizeSnapshot({
    sessionId: "a",
    hunks: [{ id: "h", path: "a.js", lines: ["-a", "+b"] }],
  });
  assert.equal(projectReview(s).counts.objectives, 0);
  assert.equal(projectReview(s).counts.added, 1);
  assert.equal(projectReview(s).counts.files, 1);
});
test("relationships reuse one hunk across perspectives and respect objective scope", () => {
  const s = normalizeSnapshot({
    hunks: [{ id: "h", path: "a.js", lines: [] }],
    objectives: [{ id: "o", title: "Secure sign in" }],
    relationships: [
      {
        hunkId: "h",
        kind: "task",
        target: "o",
        provenance: "declared",
        sourceId: "e1",
      },
      {
        hunkId: "h",
        kind: "capability",
        target: "Security",
        provenance: "inferred",
        sourceId: "e1",
        rationale: "Authentication code",
      },
    ],
  });
  assert.equal(
    projectReview(s, { groupBy: "capability" }).groups[0].name,
    "Security",
  );
  assert.equal(projectReview(s, { objectiveId: "o" }).hunks.length, 1);
  assert.equal(projectReview(s, { objectiveId: "other" }).hunks.length, 0);
  assert.equal(s.hunks.length, 1);
});
test("demo provenance cannot enter a live snapshot", () =>
  assert.throws(
    () =>
      normalizeSnapshot({
        source: "live",
        relationships: [{ provenance: "demo" }],
      }),
    /demo/,
  ));
import { classifyPaths } from "../core/evidence.js";
test("business and risk groupings explain their heuristic provenance", () => {
  const s = classifyPaths(
    normalizeSnapshot({ hunks: [{ id: "h", path: "src/auth.ts" }] }),
  );
  assert.equal(
    projectReview(s, { groupBy: "capability" }).groups[0].name,
    "Account security",
  );
  assert.equal(s.relationships[0].provenance, "inferred");
  assert.match(s.relationships[0].rationale, /not a declared objective/);
  assert.equal(s.objectives.length, 0);
});
