import test from "node:test";
import assert from "node:assert/strict";
import {
  ackReferent,
  classifyMessage,
  cleanObjective,
  rulesVersion,
  selectCandidate,
  todoObjective,
} from "../core/objectives.js";

test("injected delegation prompts never become objectives", () => {
  assert.equal(
    classifyMessage({
      text: "You are a read-only investigator.",
      sourceKind: "tool",
    }).rule,
    "R1-injected",
  );
  assert.equal(
    classifyMessage({
      text: "You audit design documents against a standard.",
      sourceKind: undefined,
    }).rule,
    "R1-injected",
  );
  assert.equal(
    classifyMessage({
      text: "Follow the Elephant-Goldfish Model skill in that file",
      sourceKind: "user",
    }).rule,
    "R1-injected",
  );
});

test("a bare link drops, a link with real prose survives", () => {
  assert.equal(
    classifyMessage({
      text: "https://example.slack.com/archives/C1/p123",
      sourceKind: "user",
    }).rule,
    "R2-link",
  );
  const keeper = classifyMessage({
    text: "https://example.slack.com/archives/C1/p123 the pipeline fails on the second stage for every market and nobody knows why yet",
    sourceKind: "user",
  });
  assert.equal(keeper.dropped, false);
});

test("short acknowledgements drop, long non-spaced messages survive", () => {
  assert.equal(
    classifyMessage({ text: "hmm", sourceKind: "user" }).rule,
    "R3-brief-ack",
  );
  assert.equal(
    classifyMessage({ text: "ok", sourceKind: "user" }).rule,
    "R4-agreement",
  );
  assert.equal(
    classifyMessage({ text: "go for it", sourceKind: "user" }).rule,
    "R4-agreement",
  );
  const chinese = "请检查购物车服务在德国市场的保存失败问题并说明具体原因";
  assert.ok(chinese.length > 20);
  assert.equal(
    classifyMessage({ text: chinese, sourceKind: "user" }).dropped,
    false,
  );
});

test("agent prose quoted back as a user message drops", () => {
  const quoted =
    "Do not silently swap MSS from meal-side to addon-side. That contradicts the documented contract.";
  assert.equal(
    classifyMessage({
      text: quoted,
      sourceKind: "user",
      priorAssistantText: "Earlier I wrote: " + quoted,
    }).rule,
    "R5-quoted",
  );
});

test("absent source kind with no request shape is unattributed, not a goal", () => {
  assert.equal(
    classifyMessage({
      text: "the thing about the deployment",
      sourceKind: undefined,
    }).rule,
    "R6-unattributed",
  );
  assert.equal(
    classifyMessage({
      text: "add retry logic to the cart resolver",
      sourceKind: undefined,
    }).rule,
    "R7-keeper",
  );
});

test("selection prefers the longest candidate and breaks ties by earliest seq", () => {
  const picked = selectCandidate([
    { id: "a", seq: 9, text: "short ask", time: 1 },
    { id: "b", seq: 7, text: "a much longer request about the cart", time: 2 },
    { id: "c", seq: 8, text: "another longer request about the cart", time: 3 },
  ]);
  assert.equal(picked.id, "b");
});

test("an acknowledgement resolves to the assistant sentence it answers", () => {
  const referent = ackReferent({
    assistantMessages: [
      { id: "m1", text: "I checked the logs and found nothing." },
      {
        id: "m2",
        text: "Next I will update the resolver timeout and rerun the invariant suite.",
      },
    ],
  });
  assert.ok(referent);
  assert.match(referent.text, /update the resolver timeout/);
  assert.equal(referent.sourceId, "m2");
});

test("no assistant action sentence means no referent", () => {
  assert.equal(
    ackReferent({ assistantMessages: [{ id: "m", text: "Done?" }] }),
    undefined,
  );
});

test("agent todos supply a declared objective, in-progress first", () => {
  const objective = todoObjective([
    {
      todos: [
        { id: "t1", content: "Read the adapters", status: "completed" },
        { id: "t2", content: "Map the review model", status: "in_progress" },
      ],
    },
  ]);
  assert.equal(objective.text, "Map the review model");
  assert.equal(objective.status, "in_progress");
});

test("objective cleaning strips discourse, keeps one sentence, caps length", () => {
  assert.equal(
    cleanObjective(
      "ok so add retry logic to the resolver. can you also check logs?",
    ),
    "add retry logic to the resolver.",
  );
  const long = cleanObjective("a".repeat(200));
  assert.ok(long.length <= 121);
  assert.ok(long.endsWith("…"));
});

test("rule version identifies the table, not a constant", () => {
  assert.match(rulesVersion(), /^[0-9a-f]{12}$/);
});

test("status questions become steps, requests that mention an object do not", () => {
  assert.equal(
    classifyMessage({ text: "what now ?", sourceKind: "user" }).rule,
    "R8-status-question",
  );
  assert.equal(
    classifyMessage({
      text: "what did we do so far today ?",
      sourceKind: "user",
    }).rule,
    "R8-status-question",
  );
  assert.equal(
    classifyMessage({ text: "why not put the secrets ?", sourceKind: "user" })
      .dropped,
    false,
  );
  assert.equal(
    classifyMessage({
      text: "why do i need to rotate my pat ?",
      sourceKind: "user",
    }).dropped,
    false,
  );
});

test("a trailing question mark alone marks a status question", () => {
  assert.equal(
    classifyMessage({
      text: "maybe needs no login for now because i logined today ?",
      sourceKind: "user",
    }).rule,
    "R8-status-question",
  );
  assert.equal(
    classifyMessage({ text: "/caveman what now ?", sourceKind: "user" }).rule,
    "R8-status-question",
  );
});
