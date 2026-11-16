import { createHash } from "node:crypto";

// Ordered rule table for objective derivation. First match wins. These are
// deterministic review heuristics over recorded text, never claims about intent.
// Length thresholds use characters, not whitespace tokens, so languages without
// spaces are not erased by the brief-acknowledgement rule.
const AGREEMENT = [
  "yes",
  "yep",
  "yup",
  "ok",
  "okay",
  "sure",
  "go for it",
  "go ahead",
  "continue",
  "keep going",
  "proceed",
  "do it",
  "do it now",
  "try again",
  "approved",
  "approve",
  "lgtm",
  "sounds good",
  "perfect",
  "thanks",
  "thank you",
];
// Host message-source kinds that are never a user request. `human` and
// `user-input` do not exist in DSH 0.2.0-rc.2 and were removed.
const USER_KINDS = new Set(["user"]);
// Injected harness text arrives with `kind: "user"` in real logs, so shape is
// checked as well as source.
const INJECTED_TEXT = [
  "communication style for this session",
  "time sampled while preparing",
  "current runtime context",
  "the following information describes your current session",
  "browser time zone for this request",
  "<system-reminder>",
  "<skill_content",
  "background subagent",
  "background job",
  "team message from",
  "you are a read-only",
  "you are an",
  "you are a",
  "you audit",
  "you write egm",
  "you verify",
  "you review",
  "read the persona",
  "research task (read-only",
  "read-only review",
];
const DELEGATION = [
  "you are a",
  "you are an",
  "you audit",
  "you write",
  "you verify",
  "you review",
  "follow the",
  "your task",
  "read the persona",
];
const IMPERATIVE = [
  "add",
  "build",
  "change",
  "check",
  "clean",
  "create",
  "delete",
  "document",
  "ensure",
  "explain",
  "fix",
  "implement",
  "improve",
  "investigate",
  "keep",
  "make",
  "merge",
  "move",
  "open",
  "plan",
  "refactor",
  "remove",
  "rename",
  "replace",
  "review",
  "revert",
  "run",
  "show",
  "start",
  "stop",
  "test",
  "update",
  "use",
  "verify",
  "write",
];
// Concrete nouns that make a question a request even without an imperative verb.
const OBJECT_NOUNS = [
  "error",
  "errors",
  "exception",
  "pr",
  "pull",
  "api",
  "endpoint",
  "key",
  "token",
  "secret",
  "credential",
  "route",
  "service",
  "incident",
  "design",
  "test",
  "tests",
  "log",
  "logs",
  "deploy",
  "deployment",
  "branch",
  "merge",
  "file",
  "files",
  "doc",
  "docs",
  "config",
  "rate",
  "team",
  "goal",
  "channel",
  "prompt",
  "canvas",
  "db",
  "database",
  "staging",
  "live",
  "migration",
  "schema",
  "cache",
  "queue",
  "job",
  "pipeline",
  "build",
  "repo",
  "commit",
  "ticket",
  "dashboard",
  "metric",
  "alert",
  "user",
  "users",
  "customer",
  "cart",
  "price",
  "order",
  "email",
  "timeout",
  "retry",
  "flag",
  "dependency",
  "permission",
  "session",
  "pat",
  "credential",
  "certificate",
  "cluster",
  "namespace",
  "deployment",
  "release",
];

export const RULES = [
  {
    // A present, non-user source kind is never a request. An absent kind is a
    // legacy shape and is decided by R6, not here.
    id: "R1-injected",
    test: ({ text, sourceKind }) =>
      (sourceKind !== undefined && !USER_KINDS.has(sourceKind)) ||
      startsWithAny(normalize(text), DELEGATION) ||
      startsWithAny(normalize(text), INJECTED_TEXT),
  },
  {
    id: "R2-link",
    test: ({ text }) => {
      const withoutLinks = text.replace(/https?:\/\/\S+/g, " ").trim();
      return /https?:\/\/\S+/.test(text) && withoutLinks.length < 60;
    },
  },
  {
    id: "R3-brief-ack",
    test: ({ text }) =>
      text.trim().length < 20 &&
      normalize(text).split(" ").filter(Boolean).length <= 2 &&
      !requestsWork(text) &&
      !startsWithAny(normalize(text), AGREEMENT),
  },
  {
    id: "R4-agreement",
    test: ({ text }) =>
      startsWithAny(normalize(text), AGREEMENT) && !requestsWork(text),
  },
  {
    id: "R5-quoted",
    test: ({ text, priorAssistantText }) =>
      text.trim().length >= 40 &&
      Boolean(priorAssistantText) &&
      normalize(priorAssistantText).includes(normalize(text).slice(0, 120)),
  },
  {
    id: "R6-unattributed",
    test: ({ text, sourceKind }) =>
      sourceKind === undefined &&
      text.trim().length < 120 &&
      !requestsWork(text) &&
      !/\b(what|why|how|when|where|which|who|should|could|would|is|are|do|does|did|can)\b/i.test(
        text,
      ),
  },
  {
    // A question about where things stand asks for a report, not for work. It is
    // kept as a step, so the session still reads as the conversation it was.
    id: "R8-status-question",
    test: ({ text }) => {
      const value = normalize(text);
      // The question mark is read from the raw text: normalise() strips
      // punctuation, so testing the normalised value would never see it.
      const asks =
        /\?/.test(text) ||
        /^(what|where|why|how|who|when|did|is|are|do|does|can)\b/.test(value);
      if (!asks) return false;
      const words = value.split(" ").filter(Boolean);
      const work = words.some((w) => IMPERATIVE.includes(w));
      const object = words.some(
        (w) =>
          OBJECT_NOUNS.includes(w) ||
          (/s$/.test(w) && OBJECT_NOUNS.includes(w.replace(/s$/, ""))),
      );
      return !work && !object;
    },
  },
  {
    id: "R7-keeper",
    test: () => true,
  },
];

export function rulesVersion() {
  return createHash("sha256")
    .update(JSON.stringify(RULES.map((r) => r.id)))
    .digest("hex")
    .slice(0, 12);
}

function normalize(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function startsWithAny(normalized, phrases) {
  return phrases.some(
    (p) => normalized === p || normalized.startsWith(p + " "),
  );
}

// A message asks for work when it carries an imperative verb or a question mark.
function requestsWork(text) {
  if (text.includes("?")) return true;
  const words = normalize(text).split(" ").filter(Boolean);
  return words.some((w) => IMPERATIVE.includes(w));
}

export function classifyMessage({ text = "", sourceKind, priorAssistantText }) {
  for (const rule of RULES)
    if (rule.test({ text, sourceKind, priorAssistantText }))
      return { dropped: rule.id !== "R7-keeper", rule: rule.id };
  return { dropped: false, rule: "R7-keeper" };
}

export function selectCandidate(candidates) {
  let best;
  for (const candidate of candidates) {
    const words = normalize(candidate.text).split(" ").filter(Boolean).length;
    if (
      !best ||
      words > best.words ||
      (words === best.words && candidate.seq < best.seq)
    )
      best = { ...candidate, words };
  }
  return best
    ? { id: best.id, seq: best.seq, time: best.time, text: best.text }
    : undefined;
}

// When every candidate in a turn was an acknowledgement, the referent of that
// acknowledgement is already recorded: the assistant sentence it answers.
// When every candidate in a turn was an acknowledgement, the referent of that
// acknowledgement is already recorded: the assistant sentence it answers. Only a
// first-person statement of what the agent will do counts; advice, summaries and
// conditionals ("When you commit, ...") describe nothing the user approved.
const COMMITMENT =
  /^(i'll|i will|i'm going to|let me|next,? i|now i|i can now|i'll now|i am going to)\b/;
export function ackReferent({ assistantMessages = [] }) {
  for (let i = assistantMessages.length - 1; i >= 0; i--) {
    const sentences = String(assistantMessages[i].text ?? "")
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.replace(/^[-*>#\d.)\s]+/, "").trim())
      .filter(Boolean);
    for (let j = sentences.length - 1; j >= 0; j--) {
      const sentence = sentences[j];
      const value = normalize(sentence);
      if (
        COMMITMENT.test(value) &&
        value.split(" ").length >= 4 &&
        !sentence.endsWith("?")
      )
        return { text: sentence, sourceId: assistantMessages[i].id };
    }
  }
  return undefined;
}

// Agent-authored todos are the only recorded objective text the agent declares.
export function todoObjective(writes = []) {
  let inProgress, completed;
  for (const write of writes)
    for (const todo of write.todos ?? []) {
      if (todo.status === "in_progress") inProgress = todo;
      if (todo.status === "completed") completed = todo;
    }
  const chosen = inProgress ?? completed;
  return chosen
    ? { text: chosen.content, status: chosen.status, sourceId: chosen.id }
    : undefined;
}

const DISCOURSE =
  /^(hi|hello|hey|so|ok|okay|right|alright|well|now|then|and|but|also|cool|great|thanks|thank you)\b[,:.!-]?\s*/i;

export function cleanObjective(text, limit = 120) {
  let value = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  while (DISCOURSE.test(value)) value = value.replace(DISCOURSE, "").trim();
  const sentence = value.split(/(?<=[.!?])\s+/)[0] ?? value;
  value = sentence.replace(/[,;]?\s*(can|could) you\b[\s\S]*$/i, "").trim();
  if (!value) value = sentence;
  if (value.length > limit) {
    const cut = value.slice(0, limit);
    value = cut.slice(0, Math.max(cut.lastIndexOf(" "), limit - 12)) + "…";
  }
  return value;
}

// Evidence restored from saved checkpoints arrives after derivation, carrying the
// turn-number labels it was saved with. Recover each hunk's turn and attribute it
// with the same rule live hunks use: the objective of that turn, or the latest
// earlier one it continues.
const TURN_LABEL = /^Turn (\d+)$/;
const CHECKPOINT_TITLE = /^Turn (\d+) · (\d+) files changed$/;

export function attributeByTurn(snapshot) {
  const objectives = (snapshot.objectives ?? [])
    .filter((o) => Number.isInteger(o.turn))
    .sort((a, b) => a.turn - b.turn);
  const objectiveFor = (turn) => {
    let found;
    for (const objective of objectives) {
      if (objective.turn > turn) break;
      found = objective;
    }
    return found;
  };
  const relationships = snapshot.relationships ?? [];
  for (const hunk of snapshot.hunks ?? []) {
    if (Number.isInteger(hunk.turn)) continue;
    const label = relationships.find(
      (r) => r.hunkId === hunk.id && r.kind === "milestone",
    );
    const turn = Number(TURN_LABEL.exec(label?.target ?? "")?.[1]);
    if (Number.isInteger(turn) && turn > 0) hunk.turn = turn;
  }
  const kept = relationships.filter(
    (r) =>
      !(
        (r.kind === "milestone" && TURN_LABEL.test(String(r.target))) ||
        (r.kind === "task" &&
          !objectives.some((o) => o.id === r.target) &&
          snapshot.hunks.some(
            (h) => h.id === r.hunkId && Number.isInteger(h.turn),
          ))
      ),
  );
  const labelled = new Set(
    kept.filter((r) => r.kind === "milestone").map((r) => r.hunkId),
  );
  for (const hunk of snapshot.hunks ?? []) {
    if (labelled.has(hunk.id) || !Number.isInteger(hunk.turn)) continue;
    const objective = objectiveFor(hunk.turn);
    if (
      objective &&
      !kept.some((r) => r.hunkId === hunk.id && r.kind === "task")
    )
      kept.push({
        hunkId: hunk.id,
        kind: "task",
        target: objective.id,
        provenance: objective.turn === hunk.turn ? "observed" : "inferred",
        sourceId: hunk.sourceId,
        rationale:
          objective.turn === hunk.turn
            ? "Saved checkpoint change recorded in the same turn as this request."
            : "Saved checkpoint change continuing the objective first stated in turn " +
              objective.turn +
              ".",
      });
    kept.push({
      hunkId: hunk.id,
      kind: "milestone",
      target: objective ? objective.title : "Unnamed work",
      provenance: "inferred",
      sourceId: hunk.sourceId,
    });
  }
  for (const event of snapshot.events ?? []) {
    if (event.type !== "checkpoint") continue;
    const match = CHECKPOINT_TITLE.exec(event.title ?? "");
    if (!match) continue;
    const turn = Number(match[1]);
    if (!Number.isInteger(event.turn)) event.turn = turn;
    event.title =
      (objectiveFor(turn)?.title ?? "Unnamed work") +
      " · " +
      match[2] +
      " files changed";
  }
  snapshot.relationships = kept;
  return snapshot;
}
