import test from "node:test";
import assert from "node:assert/strict";
import { dependencySession } from "./fixtures/dependency-session.js";
import { readReview } from "../plugin/review-service.js";
import { mapDependencies } from "../ui/map-data.js";
test("host checkpoint review produces file imports and visible grouped map edges for all five languages", async () => {
  const snapshot = await dependencySession();
  assert.equal(snapshot.dependencies.length, 5);
  for (const suffix of ["app.js", "page.ts", "main.py", "main.go", "Main.kt"])
    assert.ok(
      snapshot.dependencies.some((d) => d.from.endsWith(suffix)),
      suffix,
    );
  const edges = mapDependencies(snapshot, snapshot.hunks);
  assert.ok(edges.some((d) => d.from === "web" && d.to === "shared"));
  assert.equal(snapshot.dependencyAnalysis.unresolved.length, 0);
});
test("historical analysis uses saved evidence only and never rewrites saved records", async () => {
  const saved = await dependencySession();
  saved.pathScopeVersion = 2;
  const original = JSON.stringify(saved);
  const services = {
    sessionQuery: {
      readSession: async () => ({ session: { id: saved.sessionId } }),
    },
  };
  const store = {
    get: async () => saved,
    list: async () => [],
    getCheckpoint: async () => null,
    put: () => {
      throw Error("must not rewrite history");
    },
  };
  const result = await readReview({
    services,
    store,
    sessionId: saved.sessionId,
    snapshotId: saved.snapshotId,
  });
  assert.equal(result.dependencies.length, 5);
  assert.equal(JSON.stringify(saved), original);
});
