// Explicit review heuristics: every relationship names the rule that fired.
// These are never statements of agent intent, and an unmatched change is counted
// rather than dropped silently.
// Container and non-product directories carry no capability of their own.
const SKIP = new Set([
  "test",
  "tests",
  "docs",
  "doc",
  "examples",
  "example",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  "src",
  "lib",
  "libs",
  "internal",
  "pkg",
  "packages",
  "apps",
  "app",
  "services",
  "service",
  "api",
  "cmd",
  "platform",
  "tmp",
  "private",
  "users",
  "var",
  "continuity",
]);

// Business capabilities come from vocabulary in the path before structure is used,
// so this perspective is not merely a coarser copy of the module partition.
const CAPABILITY = [
  { id: "capability-cart", pattern: /cart|basket/, target: "Cart" },
  {
    id: "capability-pricing",
    pattern: /pricing|price|discount|coupon/,
    target: "Pricing",
  },
  {
    id: "capability-delivery",
    pattern: /delivery|deliveries|shipping|slot/,
    target: "Delivery",
  },
  {
    id: "capability-wallet",
    pattern: /wallet|credit|balance|refund/,
    target: "Wallet",
  },
  { id: "capability-menu", pattern: /menu|recipe|meal/, target: "Menu" },
  {
    id: "capability-addons",
    pattern: /addon|upsell|extras/,
    target: "Add-ons",
  },
  {
    id: "capability-orders",
    pattern: /order|subscription|plan/,
    target: "Orders",
  },
  {
    id: "capability-auth",
    pattern: /auth|session|token|permission|login/,
    target: "Account security",
  },
];

const RISK = [
  {
    id: "risk-security",
    pattern: /auth|session|token|permission|credential|secret|login/,
    target: "Security-sensitive path",
  },
  {
    id: "risk-financial",
    pattern: /payment|checkout|billing|price|wallet|refund/,
    target: "Financial path",
  },
  {
    id: "risk-schema",
    pattern: /migrat|schema|\.sql$|ddl/,
    target: "Schema change",
  },
  {
    id: "risk-resilience",
    pattern: /timeout|retry|backoff|circuit|ratelimit/,
    target: "Resilience setting",
  },
  {
    id: "risk-flag",
    pattern: /flag|toggle|experiment|statsig/,
    target: "Feature flag",
  },
  {
    id: "risk-interface",
    pattern: /route|handler|controller|resolver|graphql|api\b/,
    target: "Public interface",
  },
  {
    id: "risk-test-only",
    pattern: /(^|\/)(test|tests|spec)\/|\.(test|spec)\.[a-z]+$/,
    target: "Test-only change",
  },
];

export function capabilityOf(path) {
  const segments = String(path ?? "")
    .toLowerCase()
    .split("/")
    .filter(Boolean);
  const name = segments.join(" ");
  for (const rule of CAPABILITY)
    if (rule.pattern.test(name)) return { target: rule.target, rule: rule.id };
  // The last segment is the file; capability names a product directory.
  const directories = segments.slice(0, -1);
  const name_ = directories.find((s) => !SKIP.has(s) && !s.startsWith("."));
  if (!name_) return { target: "Unclassified paths", rule: "capability-none" };
  return { target: name_, rule: "capability-structure" };
}

export function risksOf(path, lines = []) {
  const name = String(path ?? "").toLowerCase();
  const found = RISK.filter((rule) => rule.pattern.test(name)).map((rule) => ({
    target: rule.target,
    rule: rule.id,
  }));
  const added = lines.filter(
    (l) => l.startsWith("+") && !l.startsWith("+++"),
  ).length;
  const removed = lines.filter(
    (l) => l.startsWith("-") && !l.startsWith("---"),
  ).length;
  if (removed >= 20 && removed >= added * 3)
    found.push({ target: "Deletion-heavy change", rule: "risk-deletion" });
  return found;
}

export function classifyPaths(snapshot) {
  const hunks = snapshot.hunks ?? [];
  const coChange = new Map();
  for (const hunk of hunks) {
    const turn = hunk.turn ?? hunk.sourceId ?? "unknown";
    if (!coChange.has(turn)) coChange.set(turn, new Set());
    coChange.get(turn).add(hunk.path);
  }
  let unclassified = 0;
  for (const h of hunks) {
    const sourceId = h.sourceId ?? snapshot.snapshotId;
    const capability = capabilityOf(h.path);
    if (capability.target === "Unclassified paths") unclassified++;
    const shared = [
      ...(coChange.get(h.turn ?? h.sourceId ?? "unknown") ?? []),
    ].filter((path) => path !== h.path);
    const has = (kind, target) =>
      (snapshot.relationships ?? []).some(
        (r) => r.hunkId === h.id && r.kind === kind && r.target === target,
      );
    if (!has("capability", capability.target))
      snapshot.relationships.push({
        hunkId: h.id,
        kind: "capability",
        target: capability.target,
        sourceId,
        provenance: "inferred",
        rationale:
          `Rule ${capability.rule} on ${h.path}. This is not a declared objective or measured risk.` +
          (shared.length
            ? ` Changed alongside ${shared.slice(0, 3).join(", ")} in the same turn.`
            : ""),
      });
    for (const risk of risksOf(h.path, h.lines ?? []))
      if (!has("risk", risk.target))
        snapshot.relationships.push({
          hunkId: h.id,
          kind: "risk",
          target: risk.target,
          sourceId,
          provenance: "inferred",
          rationale: `Rule ${risk.rule} on ${h.path}. Path and change-shape heuristic; not a declared objective or measured risk.`,
        });
    if (
      !risksOf(h.path, h.lines ?? []).length &&
      !has("risk", "No risk signal")
    )
      snapshot.relationships.push({
        hunkId: h.id,
        kind: "risk",
        target: "No risk signal",
        sourceId,
        provenance: "inferred",
        rationale:
          "No risk rule matched this path or change shape; not a declared objective or measured risk.",
      });
  }
  snapshot.coverage = {
    hunks: hunks.length,
    unclassified,
    capabilities: new Set(
      (snapshot.relationships ?? [])
        .filter((r) => r.kind === "capability")
        .map((r) => r.target),
    ).size,
    risks: new Set(
      (snapshot.relationships ?? [])
        .filter((r) => r.kind === "risk")
        .map((r) => r.target),
    ).size,
  };
  return snapshot;
}
