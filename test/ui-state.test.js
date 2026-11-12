import test from "node:test";
import assert from "node:assert/strict";
import { initialState, reduceReview, restoreState } from "../ui/state.js";
test("new updates do not move selection unless follow is enabled", () => {
  const state = { ...initialState(), selected: "old" };
  assert.equal(
    reduceReview(state, {
      type: "incoming",
      snapshot: { hunks: [{ id: "new" }] },
    }).selected,
    "old",
  );
  assert.equal(
    reduceReview(
      { ...state, follow: true },
      { type: "incoming", snapshot: { hunks: [{ id: "new" }] } },
    ).selected,
    "new",
  );
});
test("saved review state is separated by source and session, follow resets", () => {
  const storage = {
    getItem: (k) =>
      k === "a:live" ? JSON.stringify({ selected: "a", follow: true }) : null,
  };
  assert.equal(restoreState(storage, "b:live").selected, null);
  assert.equal(restoreState(storage, "a:demo").selected, null);
  assert.equal(restoreState(storage, "a:live").follow, false);
});
