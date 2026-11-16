#!/usr/bin/env node
// Measures the derivation layer against recorded session logs. This is a
// developer tool: it never runs inside the plugin, and it exists so the design's
// targets can be checked rather than asserted.
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
  ackReferent,
  classifyMessage,
  cleanObjective,
  selectCandidate,
  todoObjective,
} from "../core/objectives.js";

const args = process.argv.slice(2);
const json = args.includes("--json");
const files = args.filter((a) => !a.startsWith("--"));

function parse(text) {
  const events = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const e = JSON.parse(trimmed);
      if (e && typeof e === "object") events.push(e);
    } catch {}
  }
  return events;
}

function blockText(content) {
  if (Array.isArray(content))
    return content
      .filter((b) => b && b.type === "text")
      .map((b) => b.text)
      .join("\n");
  return typeof content === "string" ? content : "";
}

export function measure(events, { file = "" } = {}) {
  const turns = new Map();
  const checkpoints = [];
  const commands = [];
  let offturn = 0;

  let currentTurn;
  for (const e of events) {
    const d = e.data ?? {};
    if (e.type === "turn/start" && Number.isInteger(d.turn))
      currentTurn = d.turn;
    const turn = Number.isInteger(d.turn) ? d.turn : currentTurn;
    if (turn === undefined) {
      offturn++;
      continue;
    }
    let bucket = turns.get(turn);
    if (!bucket)
      turns.set(
        turn,
        (bucket = {
          turn,
          user: [],
          assistant: [],
          todos: [],
          edits: 0,
          checkpoint: false,
        }),
      );
    if (e.type === "user/message") {
      const kind = d.source?.kind ?? d.source?.type;
      const text = blockText(d.content);
      if (text)
        bucket.user.push({ seq: e.seq, time: e.time, text, sourceKind: kind });
    }
    if (e.type === "assistant/message") {
      const text = blockText(d.message?.content ?? d.content);
      if (text) bucket.assistant.push({ id: e.seq, text });
    }
    if (e.type === "todo/write" && Array.isArray(d.todos))
      bucket.todos.push({ todos: d.todos.map((t, i) => ({ id: i, ...t })) });
    if (e.type === "workspace/changes") {
      bucket.checkpoint = true;
      checkpoints.push({ seq: e.seq, turn });
      bucket.edits += (d.files ?? []).length || 1;
    }
    if (e.type === "tool/result") {
      const message = d.message ?? {};
      const name = String(message.source?.toolName ?? message.toolName ?? "");
      if (/write|edit|patch/.test(name)) bucket.edits++;
      if (Array.isArray(message.content) && message.source?.callId)
        commands.push({ seq: e.seq, turn, callId: message.source.callId });
    }
  }

  const carry = process.argv.includes("--carry");
  const ruleCounts = {};
  const objectives = [];
  const details = [];
  let workTurns = 0;
  let unnamedWork = 0;
  let lastObjective;

  for (const bucket of turns.values()) {
    const prior = bucket.assistant.map((a) => a.text).join("\n");
    const candidates = [];
    let ackOnly = false;
    for (const message of bucket.user) {
      const { dropped, rule } = classifyMessage({
        text: message.text,
        sourceKind: message.sourceKind,
        priorAssistantText: prior,
      });
      ruleCounts[rule] = (ruleCounts[rule] ?? 0) + 1;
      if (rule === "R3-brief-ack" || rule === "R4-agreement") ackOnly = true;
      if (!dropped) candidates.push(message);
    }
    let chosen = selectCandidate(candidates);
    let source = chosen ? "request" : undefined;
    // The acknowledgement referent only applies when the turn's messages were
    // acknowledgements, not when they were injections, links or quoted prose.
    if (!chosen && ackOnly) {
      const referent = ackReferent({ assistantMessages: bucket.assistant });
      if (referent) {
        chosen = {
          id: "ack:" + bucket.turn,
          seq: bucket.user.at(-1).seq,
          time: bucket.user.at(-1).time,
          text: referent.text,
        };
        source = "ack-referent";
      }
    }
    if (!chosen) {
      const todo = todoObjective(bucket.todos);
      if (todo) {
        chosen = {
          id: "todo:" + bucket.turn,
          seq: bucket.user.at(-1)?.seq ?? 0,
          time: bucket.user.at(-1)?.time,
          text: todo.text,
        };
        source = "todo";
      }
    }
    const works = bucket.edits > 0 || bucket.checkpoint;
    if (works) workTurns++;
    if (works && !chosen && !(carry && lastObjective)) unnamedWork++;
    if (chosen) lastObjective = chosen;
    if (chosen)
      objectives.push({
        turn: bucket.turn,
        title: cleanObjective(chosen.text),
        source,
      });
    details.push({
      turn: bucket.turn,
      works,
      objective: chosen ? cleanObjective(chosen.text) : null,
      source: source ?? null,
      dropped: bucket.user.length - candidates.length,
    });
  }

  const bound = commands.filter((c) =>
    checkpoints.some((k) => k.seq < c.seq),
  ).length;

  // Two different questions, kept apart on purpose: how many kept objectives are
  // question-shaped at all (informational), and how many are questions that ask
  // for a report rather than work (a defect if non-zero).
  const questionForm =
    /\?\s*$|^(what|where|why|how|who|when|did|is|are|do|does|can)\b/i;
  const questionShaped = objectives.filter((o) => questionForm.test(o.title));
  const reportOnly = questionShaped.filter(
    (o) =>
      !/\b(check|add|fix|run|open|change|update|revert|investigate|ensure|set|create|build|remove|move|plan|implement|verify|confirm|explain|look|find|test|merge|deploy|read|write|rotate|put|connect|unblock)\b/i.test(
        o.title,
      ) &&
      !/\b(error|pr|api|key|token|secret|route|service|incident|design|test|log|deploy|branch|merge|file|doc|config|rate|team|goal|channel|prompt|canvas|db|staging|live|pat|permission|session|cart|price|order)\b/i.test(
        o.title,
      ),
  );

  return {
    file,
    events: events.length,
    offturnEvents: offturn,
    turns: turns.size,
    workTurns,
    unnamedWork,
    unnamedShare: workTurns ? unnamedWork / workTurns : 0,
    objectives: objectives.length,
    questionShapedShare: objectives.length
      ? questionShaped.length / objectives.length
      : 0,
    proceduralSurvivors: reportOnly.length,
    proceduralShare: objectives.length
      ? reportOnly.length / objectives.length
      : 0,
    ruleCounts,
    commands: commands.length,
    boundCommands: bound,
    bindingShare: commands.length ? bound / commands.length : 0,
    details,
  };
}

async function main() {
  if (!files.length) {
    console.error(
      "usage: measure-derivation.js <session.jsonl[.zstd]> [--json]",
    );
    process.exit(2);
  }
  const out = [];
  for (const file of files) {
    // Session logs are multi-frame zstd; a single-frame decoder returns only the
    // first record, so the CLI is used when the log is compressed.
    const text = file.endsWith(".zstd")
      ? execFileSync("zstd", ["-dc", file], {
          maxBuffer: 512 * 1024 * 1024,
        }).toString("utf8")
      : (await readFile(file)).toString("utf8");
    out.push(measure(parse(text), { file }));
  }
  if (json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  for (const m of out) {
    console.log(`\n== ${m.file.split("/").slice(-2).join("/")}`);
    console.log(
      `events ${m.events} · turns ${m.turns} · work turns ${m.workTurns} · unnamed work ${m.unnamedWork} (${(m.unnamedShare * 100).toFixed(1)}%)`,
    );
    console.log(
      `objectives ${m.objectives} · report-only questions ${m.proceduralSurvivors} (${(m.proceduralShare * 100).toFixed(1)}%) · question-shaped ${(m.questionShapedShare * 100).toFixed(1)}%`,
    );
    console.log(
      `commands ${m.commands} · bound to a preceding checkpoint ${m.boundCommands} (${(m.bindingShare * 100).toFixed(1)}%)`,
    );
    console.log(
      "rules: " +
        Object.entries(m.ruleCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k}=${v}`)
          .join(" "),
    );
  }
}

if (process.argv[1] && process.argv[1].endsWith("measure-derivation.js"))
  await main();
