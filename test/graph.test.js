import test from "node:test";
import assert from "node:assert/strict";
import { layoutGraph } from "../ui/graph.js";
const nodes = [
  "Auth tests",
  "Session service",
  "Route middleware",
  "Login API",
];
const edges = [
  { from: "Auth tests", to: "Login API" },
  { from: "Auth tests", to: "Route middleware" },
  { from: "Login API", to: "Session service" },
  { from: "Route middleware", to: "Session service" },
];
function assertClear(g) {
  for (const edge of g.edges) {
    assert.ok(edge.points.length >= 2);
    for (const p of edge.points)
      assert.ok(p.x >= 0 && p.y >= 0 && p.x <= g.width && p.y <= g.height);
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1],
        b = edge.points[i];
      assert.ok(a.x === b.x || a.y === b.y);
      for (const [name, r] of g.positions) {
        const crosses =
          a.x === b.x
            ? a.x > r.x &&
              a.x < r.x + 230 &&
              Math.max(a.y, b.y) > r.y &&
              Math.min(a.y, b.y) < r.y + r.height
            : a.y > r.y &&
              a.y < r.y + r.height &&
              Math.max(a.x, b.x) > r.x &&
              Math.min(a.x, b.x) < r.x + 230;
        assert.equal(
          crosses,
          false,
          `${edge.from} -> ${edge.to} crosses ${name}`,
        );
      }
    }
    const end = edge.points.at(-1),
      target = g.positions.get(edge.to);
    assert.ok(
      end.x === target.x ||
        end.x === target.x + 230 ||
        end.y === target.y ||
        end.y === target.y + target.height,
    );
  }
}
for (const compact of [true, false])
  test(`orthogonal diamond routes have clear separate endpoints (${compact})`, () => {
    const g = layoutGraph(nodes, edges, compact);
    assertClear(g);
    assert.equal(
      new Set(g.edges.map((e) => JSON.stringify(e.points.at(-1)))).size,
      4,
    );
  });
test("cycles, reversed edges, self loops and high-degree nodes stay outside cards", () => {
  for (const compact of [true, false]) {
    const es = [
      ...edges,
      { from: "Session service", to: "Auth tests" },
      { from: "Login API", to: "Login API" },
    ];
    assertClear(layoutGraph(nodes, es, compact));
  }
});

test("diamond relationships have no crossings in either layout", () => {
  for (const compact of [true, false]) {
    const g = layoutGraph(nodes, edges, compact);
    const segments = g.edges.flatMap((edge, id) =>
      edge.points.slice(1).map((b, i) => ({ id, a: edge.points[i], b })),
    );
    for (const s of segments)
      for (const t of segments) {
        if (s.id === t.id) continue;
        if (s.a.x === s.b.x && t.a.y === t.b.y) {
          assert.ok(
            !(
              s.a.x > Math.min(t.a.x, t.b.x) &&
              s.a.x < Math.max(t.a.x, t.b.x) &&
              t.a.y > Math.min(s.a.y, s.b.y) &&
              t.a.y < Math.max(s.a.y, s.b.y)
            ),
          );
        }
      }
  }
});

function assertNoSharedSegments(g) {
  const segments = g.edges.flatMap((edge, id) =>
    edge.points.slice(1).map((b, i) => ({ id, a: edge.points[i], b })),
  );
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const s = segments[i],
        t = segments[j];
      if (s.id === t.id) continue;
      const overlap = (a, b, c, d) =>
        Math.min(Math.max(a, b), Math.max(c, d)) -
          Math.max(Math.min(a, b), Math.min(c, d)) >
        1e-6;
      const vertical =
        s.a.x === s.b.x &&
        t.a.x === t.b.x &&
        s.a.x === t.a.x &&
        overlap(s.a.y, s.b.y, t.a.y, t.b.y);
      const horizontal =
        s.a.y === s.b.y &&
        t.a.y === t.b.y &&
        s.a.y === t.a.y &&
        overlap(s.a.x, s.b.x, t.a.x, t.b.x);
      assert.ok(
        !vertical && !horizontal,
        `Edges ${s.id} and ${t.id} share a segment`,
      );
    }
}

test("real five-language session map never merges unrelated routes", async () => {
  const { dependencySession } = await import(
    "./fixtures/dependency-session.js"
  );
  const { mapDependencies } = await import("../ui/map-data.js");
  const snapshot = await dependencySession();
  const names = [
    ...new Set(
      snapshot.relationships
        .filter((r) => r.kind === "module")
        .map((r) => r.target),
    ),
  ];
  const es = mapDependencies(snapshot, snapshot.hunks);
  for (const compact of [true, false]) {
    const g = layoutGraph(names, es, compact);
    assertClear(g);
    assertNoSharedSegments(g);
    if (!compact)
      assert.ok(
        g.height < 1000,
        "Wide layout must keep parallel column rows, not a sparse staircase",
      );
  }
});

test("distinct edges retain separate rails across deterministic varied graphs", () => {
  let seed = 42;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let sample = 0; sample < 120; sample++) {
    const ns = Array.from(
      { length: 2 + Math.floor(random() * 9) },
      (_, i) => "node" + i,
    );
    const es = Array.from({ length: Math.floor(random() * 20) }, () => ({
      from: ns[Math.floor(random() * ns.length)],
      to: ns[Math.floor(random() * ns.length)],
    }));
    for (const compact of [true, false]) {
      const g = layoutGraph(ns, es, compact);
      assertClear(g);
      assertNoSharedSegments(g);
    }
  }
});

test("disconnected components occupy separate bands with isolates last", () => {
  const ns = ["00 isolated", "a", "b", "c", "d", "z"];
  const es = [
    { from: "a", to: "b" },
    { from: "b", to: "a" },
    { from: "c", to: "d" },
    { from: "z", to: "z" },
  ];
  for (const compact of [true, false]) {
    const g = layoutGraph(ns, es, compact);
    assertClear(g);
    assertNoSharedSegments(g);
    const bands = [["a", "b"], ["c", "d"], ["z"]].map((members) => {
      const relevant = g.edges.filter((e) => members.includes(e.from));
      return {
        min: Math.min(
          ...members.map((n) => g.positions.get(n).y),
          ...relevant.flatMap((e) => e.points.map((p) => p.y)),
        ),
        max: Math.max(
          ...members.map(
            (n) => g.positions.get(n).y + g.positions.get(n).height,
          ),
          ...relevant.flatMap((e) => e.points.map((p) => p.y)),
        ),
      };
    });
    for (let i = 1; i < bands.length; i++)
      assert.ok(
        bands[i].min > bands[i - 1].max,
        "Independent components must never cross or overlap",
      );
    assert.ok(
      g.positions.get("00 isolated").y > bands.at(-1).max,
      "Isolates follow connected groups",
    );
  }
});
