import test from "node:test";
import assert from "node:assert/strict";
import { capabilityOf, classifyPaths, risksOf } from "../core/evidence.js";

function snapshotWith(paths) {
  return {
    snapshotId: "s1",
    relationships: [],
    hunks: paths.map((path, i) => ({
      id: "h" + i,
      path,
      turn: 1,
      lines: ["-old", "+new"],
    })),
  };
}

test("a structured repository yields several capability groups, none dominant", () => {
  const snapshot = classifyPaths(
    snapshotWith([
      "internal/platform/cart/provider.go",
      "internal/platform/cart/service.go",
      "internal/platform/pricing/price.go",
      "internal/platform/wallet/wallet.go",
      "src/checkout/session.ts",
      "src/auth/token.ts",
    ]),
  );
  const groups = new Set(
    snapshot.relationships
      .filter((r) => r.kind === "capability")
      .map((r) => r.target),
  );
  assert.ok(groups.size >= 3, `expected at least 3 groups, got ${groups.size}`);
  const counts = {};
  for (const r of snapshot.relationships.filter((r) => r.kind === "capability"))
    counts[r.target] = (counts[r.target] ?? 0) + 1;
  const largest = Math.max(...Object.values(counts));
  assert.ok(
    largest / 6 < 0.7,
    "largest capability group must stay under 70 percent",
  );
});

test("risk groups include a no-signal bucket and at least two signals", () => {
  const snapshot = classifyPaths(
    snapshotWith([
      "internal/platform/cart/auth/token.go",
      "db/migrations/0001_init.sql",
      "src/ui/button.tsx",
      "src/ui/card.tsx",
    ]),
  );
  const groups = new Set(
    snapshot.relationships
      .filter((r) => r.kind === "risk")
      .map((r) => r.target),
  );
  assert.ok(
    groups.has("No risk signal"),
    "unmatched changes need an explicit bucket",
  );
  assert.ok(
    groups.size >= 3,
    `expected at least two signals plus the bucket, got ${groups.size}`,
  );
});

test("capability is not a rename of the module partition", () => {
  const snapshot = classifyPaths(
    snapshotWith([
      "internal/platform/cart/provider.go",
      "internal/platform/pricing/price.go",
    ]),
  );
  const capabilities = snapshot.relationships
    .filter((r) => r.kind === "capability")
    .map((r) => r.target);
  const directories = [
    "internal/platform/cart/provider.go",
    "internal/platform/pricing/price.go",
  ].map((path) => path.slice(0, path.lastIndexOf("/")));
  assert.deepEqual(capabilities, ["Cart", "Pricing"]);
  assert.notDeepEqual(capabilities, directories);
});

test("unclassified changes are counted, not silently dropped", () => {
  const snapshot = classifyPaths({
    snapshotId: "s",
    relationships: [],
    hunks: [{ id: "h", path: "docs/readme.md", turn: 1, lines: ["+x"] }],
  });
  assert.equal(snapshot.coverage.unclassified, 1);
  const targets = snapshot.relationships
    .filter((r) => r.kind === "capability")
    .map((r) => r.target);
  assert.deepEqual(targets, ["Unclassified paths"]);
});

test("every derived relationship names the rule that fired", () => {
  const snapshot = classifyPaths(snapshotWith(["src/payment/charge.ts"]));
  for (const relationship of snapshot.relationships)
    assert.match(relationship.rationale, /Rule |No risk rule/);
});

test("deletion-heavy changes carry their own signal", () => {
  const lines = Array.from({ length: 40 }, (_, i) => "-line " + i).concat([
    "+one",
  ]);
  const risks = risksOf("src/legacy/thing.ts", lines).map((r) => r.target);
  assert.ok(risks.includes("Deletion-heavy change"));
});

test("capability vocabulary wins over the first directory segment", () => {
  assert.equal(
    capabilityOf("internal/platform/cart/provider.go").target,
    "Cart",
  );
  assert.equal(capabilityOf("services/wallet/balance.ts").target, "Wallet");
});
