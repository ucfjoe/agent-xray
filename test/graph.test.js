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
