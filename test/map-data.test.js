import test from "node:test";
import assert from "node:assert/strict";
import { mapDependencies } from "../ui/map-data.js";
test("file imports survive directory grouping and filtering without mutating evidence", () => {
  const snapshot = {
    relationships: [
      { hunkId: "a", kind: "module", target: "app" },
      { hunkId: "b", kind: "module", target: "lib" },
    ],
    dependencies: [
      { from: "app/a.ts", to: "lib/b.ts" },
      { from: "elsewhere/a.ts", to: "elsewhere/b.ts" },
      { from: "app/a.ts", to: "missing", resolution: "unresolved" },
    ],
  };
  const hunks = [
    { id: "a", path: "app/a.ts" },
    { id: "b", path: "lib/b.ts" },
  ];
  assert.deepEqual(mapDependencies(snapshot, hunks), [
    {
      from: "app",
      to: "lib",
      evidenceFrom: "app/a.ts",
      evidenceTo: "lib/b.ts",
    },
  ]);
  assert.equal(snapshot.dependencies[0].from, "app/a.ts");
  assert.deepEqual(mapDependencies(snapshot, [hunks[0]]), [
    {
      from: "app",
      to: "lib/b.ts",
      evidenceFrom: "app/a.ts",
      evidenceTo: "lib/b.ts",
    },
  ]);
});
test("same-group imports remain explicit internal relationships", () => {
  assert.deepEqual(
    mapDependencies(
      {
        relationships: [
          { hunkId: "a", kind: "module", target: "src" },
          { hunkId: "b", kind: "module", target: "src" },
        ],
        dependencies: [{ from: "src/a.ts", to: "src/b.ts" }],
      },
      [
        { id: "a", path: "src/a.ts" },
        { id: "b", path: "src/b.ts" },
      ],
    ),
    [
      {
        from: "src",
        to: "src",
        evidenceFrom: "src/a.ts",
        evidenceTo: "src/b.ts",
      },
    ],
  );
});
