import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSnapshot, projectReview } from "../core/model.js";
import { render } from "../ui/render.js";
import { initialState } from "../ui/state.js";

test("all activity lists display newest first without changing stored order or code lines", () => {
  const snapshot = normalizeSnapshot({
    events: [
      { id: "old", seq: 1, title: "Older action" },
      { id: "new", seq: 2, title: "Newest action" },
    ],
    objectives: [
      { id: "o1", sourceId: "old", title: "Older objective" },
      { id: "o2", sourceId: "new", title: "Newest objective" },
    ],
    hunks: [
      { id: "h1", eventId: "old", path: "old.ts", lines: [" old", "+new"] },
      {
        id: "h2",
        eventId: "new",
        path: "new.ts",
        lines: [" before", "+after"],
      },
    ],
    relationships: [
      { hunkId: "h1", kind: "task", target: "o1" },
      { hunkId: "h2", kind: "task", target: "o2" },
    ],
    checks: [
      { id: "c1", seq: 1, command: "old-command" },
      { id: "c2", seq: 2, command: "new-command" },
    ],
  });
  const before = structuredClone(snapshot);
  const p = projectReview(snapshot);
  assert.deepEqual(
    p.hunks.map((h) => h.id),
    ["h2", "h1"],
  );
  assert.deepEqual(
    p.groups.map((g) => g.name),
    ["Newest objective", "Older objective"],
  );
  const html = render(
    snapshot,
    { ...initialState(), view: "journey" },
    {
      source: "session",
      history: [
        { id: "s1", time: 1 },
        { id: "s2", time: 2 },
      ],
    },
  );
  for (const [newer, older] of [
    ["Newest action", "Older action"],
    ["Newest objective", "Older objective"],
    ["new-command", "old-command"],
    ['value="s2"', 'value="s1"'],
  ]) {
    assert.ok(
      html.indexOf(newer) < html.indexOf(older),
      `${newer} should appear first`,
    );
  }
  assert.deepEqual(snapshot, before);
});
