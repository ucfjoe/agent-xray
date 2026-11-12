import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("example sessions cover every review perspective with consistent links", async () => {
  const context = {};
  vm.runInNewContext(
    (await readFile(new URL("../examples.js", import.meta.url), "utf8")) +
      "\nthis.scenarios = exampleScenarios;",
    context,
  );
  assert.equal(context.scenarios.length, 3);
  const ids = new Set();
  const statuses = new Set();
  for (const scenario of context.scenarios) {
    assert.ok(scenario.changes.length >= 6);
    const modules = new Set(scenario.modules.map((module) => module.name));
    for (const module of scenario.modules) {
      for (const dependency of module.dependsOn)
        assert.ok(modules.has(dependency));
    }
    for (const change of scenario.changes) {
      assert.ok(!ids.has(change.id));
      ids.add(change.id);
      for (const field of [
        "task",
        "capability",
        "module",
        "risk",
        "milestone",
        "path",
        "story",
        "action",
        "evidence",
      ])
        assert.ok(change[field]);
      assert.ok(modules.has(change.module));
      assert.ok(change.lines.some((line) => /^[+-]/.test(line)));
      assert.ok(change.lines.every((line) => /^[ +\-]/.test(line)));
      statuses.add(change.check.status);
      if (change.check.status !== "Pending")
        assert.ok(change.check.output && change.check.command);
    }
  }
  assert.deepEqual([...statuses].sort(), ["Failed", "Passed", "Pending"]);
});
