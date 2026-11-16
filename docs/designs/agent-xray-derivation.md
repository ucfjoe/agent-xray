# Agent X-Ray: make the review say what was intended, not what was typed

*   **Author:** Yousef Joe
*   **Status:** Proposed (revision 2, post Goldfish review)
*   **Date:** 2026-11-16
*   **Implementation plan:** `docs/superpowers/plans/2026-11-16-agent-xray-derivation.md`

--------------------------------------------------------------------------------

## Overview

Agent X-Ray answers four questions about a coding session: what changed, why, what
it affects, and what was verified. The recovery contract
(`docs/superpowers/specs/2026-11-12-agent-xray-recovery.md`, R01–R25) states the
product must not "merely rename a Git list".

The evidence layer is real: session identity, per-turn diffs, hunks, dependency
edges, immutable snapshots. The interpretation layer is missing. Objectives are
raw user messages, milestones are turn numbers, commands carry no interpretable
outcome, and two of five perspectives are near-empty.

This design covers the interpretation layer only.

## The Problem

DSH supplies user messages, tool calls and results, and per-turn workspace
differences. The contract asks for intent, objectives, milestones, verification,
relationships and code. Three of the six must be derived.

Measured on cached snapshot `c78088d674` (39 files, 138 changes, 34 objectives,
1183 events, 517 commands, 396 relationships; captured 2026-11-16 11:48):

- **Objectives are message text.** `plugin/dsh-adapter.js:143` stores
  `title.slice(0, 180)` from the raw message. The 34 objectives include a Slack
  permalink, `"go for it"`, `"are you stuck ?"`, and a paragraph of the agent's own
  prose that arrived as a user message. The guard at `:140` treats a message with
  no source kind as a user request, so injected subagent prompts are counted too.
- **Milestones are turn numbers.** `:132` writes `"Turn " + turn`; the
  relationship target at `:100` and the checkpoint event title at `:358` do the
  same. All three are visible surfaces.
- **Command outcomes are unreadable.** The adapter records `status: "recorded"`,
  `testOutcome: "unknown"`, and `core/verification.js:12-29` overwrites every
  projection field before rendering. Exit status, which DSH does record in
  `job/settled`, is discarded. In one measured session 12.7 percent of commands
  exited nonzero and are indistinguishable from the rest.
- **Two perspectives are empty.** Of 396 relationships: 138 milestone, 138
  module, 118 task, 1 capability, 1 risk. The capability rule matches four path
  patterns (`core/evidence.js:6-15`); everything else contributes nothing.
- **Unlinked work is labelled as loading.** `ui/render.js:36` renames the residual
  group "Changes awaiting context".

The failure mode is uniform: absent derivation presented as recorded fact.

## Goals

1. **Derived objectives.** No objective is raw message text. Each is a statement
   of what the turn was asked to achieve, attributed to a turn, with procedural
   messages retained as events rather than promoted.
2. **Recall floor and noise ceiling, measured together.** Across at least three
   cached sessions, at most 10 percent of surviving objectives are procedural, and
   at most 15 percent of work-producing turns end with no objective. Neither
   target may be met by worsening the other.
3. **Milestones describe work.** Milestone relationship targets and checkpoint
   event titles carry a phrase, not a turn index. Zero visible "Turn N" labels
   remain outside the Journey's ordering metadata.
4. **Commands placed in time.** Each command is labelled against the workspace
   state that preceded it, using the previous turn's closing checkpoint where one
   exists, and stating plainly what that does not prove.
5. **Verification tells two separate truths.** Observed process outcome (exited 0,
   exited N, killed, not recorded) is reported as fact. Inferred coverage of a
   specific change stays unknown unless evidence binds it. The two never merge.
6. **All five perspectives carry signal.** Capability, risk, module, task and
   milestone each partition changes from evidence, with an explicit unclassified
   bucket, and every relationship names the rule that fired.
7. **Honest provenance.** Every derived value carries a provenance kind and a
   visible label. Selection and truncation are marked as inferred even when the
   words are the user's.
8. **Stay local and cheap.** No network, no credentials, no new dependency. One
   additional pass over events the adapter already reads, with a stated budget.

## Non-Goals

- **No model calls in the review path.** Derivation is deterministic and offline.
- **No hidden reasoning.** Only messages, tool events, workspace changes and agent
  todos are read.
- **No UI redesign.** Views and evidence cards keep their structure; content and
  labels change.
- **No re-derivation of historical snapshots.** Cached snapshots stay as
  recorded, and a saved review that predates derivation says so in one line.
- **No stronger causal binding in this release.** Proving that a command exercised
  the shown bytes needs a workspace hash recorded at command time. Deferred, with
  the mechanism documented in Future Improvements.
- **No Claude mod support, incident inbox, or hosted triggering.**

## Decisions

- **Objective source (Q1):** one objective per turn, filtered, with deterministic
  fallbacks (author, 2026-11-16).
- **Perspective scope (Q3):** capability and risk are in scope (author,
  2026-11-16).
- **Repair direction:** evidence-first; no request-shape classifier (author,
  2026-11-16, after review).
- **Rejected:** work-named objectives, goal-stating classification, model-assisted
  distillation, transcript typography, cache re-derivation.

## Critical User Journeys

### CUJ 1: A reader returns to a long session

*   **Given**: 138 changes across 39 files.
*   **When**: The reader opens Story.
*   **Then**: Work appears under phrases that state goals, each expandable to the
    changes it produced, with counts of changes that no stated request covers.

### CUJ 2: A reader asks whether a change was tested

*   **Given**: A change whose turn recorded a command.
*   **When**: The reader selects the change.
*   **Then**: The card shows the command, the workspace state it ran after, the
    process outcome as recorded, and one sentence saying coverage is not
    established. When no checkpoint precedes it, the card says that instead.

### CUJ 3: A reader opens a delegated session

*   **Given**: A subagent transcript that begins with an injected prompt.
*   **When**: The reader opens Story.
*   **Then**: The injected prompt is not presented as the objective: either a
    derived objective describes the delegated work, an agent todo supplies it as
    declared, or the session is labelled as carrying no stated objective.

--------------------------------------------------------------------------------

## Technical Plan (Architecture)

Derivation is pure functions in `core/`, applied as a **post-pass over the
assembled model** rather than inline during event scan. This placement matters:
objectives are only knowable once the turn closes, while hunks, calls and checks
are stamped during the turn, and `task` relationships need the objective to exist
first.

```text
event log -> adapter single pass -> model { events, hunks, checks, calls }
                                          |
                     post-pass (pure, ordered):
                     1 core/objectives.js      turn -> objective | none
                     2 core/objectives.js      todo/write -> declared objectives
                     3 rebind task targets + milestone titles
                     4 core/evidence.js        capability / risk / unclassified
                     |
                     v
        model -> core/verification.js (single owner of check projection)
                     |
                     v
                 ui/render.js
```

### Objective derivation

Rules are data, evaluated in order, first match wins. Dropped messages are kept
as events of a distinct type (`unaligned-request`) so the Story never renders them
as objectives, while the evidence stays available. Length rules use character
count, not whitespace tokens, so languages without spaces are not erased.

| Rule | Test | Outcome |
| --- | --- | --- |
| R1 injected | source kind is not user/human/user-input, or text begins with a delegation prefix ("You are a", "You audit", "Follow the", "Your task") | drop, `injected` |
| R2 link only | one or more URLs plus prose under 60 characters | drop, `link` |
| R3 brief ack | under 20 characters and no imperative object | drop, `brief-ack` |
| R4 agreement | normalised text is or begins with an agreement token (yes, ok, go for it, continue, keep going, proceed, do it, approved, lgtm, sounds good) and carries no imperative object | drop, `agreement` |
| R5 quoted back | 40 characters or more and already present in an earlier `assistant/message` in this session | drop, `quoted` |
| R6 absent source kind | no source kind and not shaped like a request | drop, `unattributed` |
| R7 keeper | anything left | candidate |

Selection: the candidate with the most words; ties to the earliest sequence.

**Acknowledgement referent fallback.** When a turn's only candidate was dropped by
R3 or R4, the objective becomes the last sentence of the immediately preceding
`assistant/message` that states an action, recorded with `provenance: declared`
and `selection: inferred`, plus the user sequence that triggered it in
`derivedFrom`. This needs no content classifier: it reuses text the record already
holds. When no such sentence exists, the turn has no objective.

**Agent todo fallback.** `todo/write` events carry `{todos: [{content, status}]}`.
A turn whose todo list changed takes its `in_progress` or most recently completed
item as a declared objective, at a lower precedence than a user request.
Milestones come from status transitions between consecutive writes, not from
concatenation.

**Display normalisation** runs after the adapter's existing `clean()` redaction:
strip the leading greeting or discourse marker, collapse whitespace, keep the
first sentence, drop a trailing "can you…" clause when a sentence already exists,
cap at 120 characters with an ellipsis. Redaction before capping, so a cap can
never split a secret pattern into something that no longer matches.

**Headline.** The sidebar title becomes the objective holding the most changes,
labelled as inferred; the last message is no longer the title.

### Milestones

A milestone title is its objective's title, or `Turn N · unnamed work`. The three
surfaces are retitled: the `milestone` relationship target
(`plugin/dsh-adapter.js:100`), the checkpoint event title (`:358`), and
`model.milestones` — which today nothing renders and is either wired to the Journey
or deleted.

### Command binding

`workspace/changes` is a turn's **terminal** event: it follows the turn's last
`tool/result` and precedes `turn/end`. A same-turn "preceding checkpoint" rule
therefore almost never fires — measured 11 of 144 commands in
`session-cb3f84b9`, and near zero in two independent reviewer samples.

Binding uses the **previous turn's closing checkpoint** instead. Measured coverage:
538 of 558 commands (96.4 percent).

- **Bound**: `boundCheckpointSeq` set, and the association reads "Ran after the
  workspace state recorded at the end of turn N-1. This does not show that the
  command exercised this change."
- **Unbound**: "No workspace checkpoint recorded before this command."
- **Never claimed**: that a command tested the selected change.

`checkpointSeqs` stays `number[]` for `plugin/checkpoints.js:55-59`. A separate
turn-bearing list feeds binding.

### Verification: two axes, one owner

`core/verification.js` is the single owner of check projection; the adapter does
not write a parallel vocabulary that the projection later overwrites.

- **Process outcome** (observed fact): `exited 0`, `exited N`, `killed`, or
  `not recorded`, taken from `job/settled.status` and `job/settled.detail`
  (`exit code: N`), joined by `toolCall` to the call. Rendered as process fact,
  never as a verdict, because commands such as `grep` legitimately exit 1.
- **Coverage** (inference): `unknown` unless an evidence binding exists.

**Background jobs.** A command result that is a launch acknowledgement is joined
to the later `job_output` result by job id, so the card shows real output. A killed
job reads "output not recorded", not an empty result.

### Perspectives

- **Capability**: the first path segment after the repository root, minus a
  denylist (`test`, `docs`, `examples`, `node_modules`, `vendor`, `dist`). This
  works on arbitrary repository layouts, unlike a fixed list of monorepo roots.
- **Risk**: tagged signals, zero or more per change — security-sensitive path,
  financial path, schema or migration, retry or timeout configuration,
  feature-flag default, public interface change, deletion-heavy change, test-only
  change — with an explicit "no signal" bucket.
- **Corroboration**: changes that share a turn, and changed files with a recorded
  import edge between them, add a co-change signal so capability is not merely a
  coarser module partition.
- **Coverage**: unclassified changes are counted and shown.

Every relationship keeps `provenance: "inferred"` and names its rule id.

### Provenance and versioning

User-request objectives keep `provenance: "declared"` with
`selection: "inferred"` and `derivedFrom: [seq…]`, because the words are the
user's and the selection is not. Derived milestones and bindings are `inferred`.

`derivationVersion` is a **hash of the rule set plus the normaliser version**, not
a constant, so two snapshots built by different tables cannot claim the same
version. A saved review without the field renders one notice line: "This saved
review predates derived objectives."

### Failure behaviour

Unclassifiable input is dropped, never promoted. A turn with nothing classifiable
has no objective and is labelled. A missing checkpoint yields the unbound label,
not a guess.

### Cost

One post-pass over the in-memory model plus a normalised-text set for R5. Budget:
the 1183-event fixture completes the post-pass under 200 ms, asserted in the test
suite with slack; no network, no new dependency.

--------------------------------------------------------------------------------

## Alternatives Considered

### A. One objective per goal-stating request (rejected by author)

Request-shape classification recovers the 31 percent of unnamed work turns but
misfires on messages that are both question and goal. Rejected in favour of
deterministic fallbacks that use text already in the record.

### B. One objective per change group, named from the work (rejected by author)

Drops intent, which R05 requires, and yields nothing for sessions with no changes.

### C. Model-assisted distillation (rejected by author)

Requires credentials, makes output non-reproducible, and sends session text to a
provider.

### D. Accept the transcript and improve its typography (rejected as design)

Cheapest, but abandons R04, R05 and R13.

### E. Re-derive the cache on load (rejected as design)

Contradicts immutable history (R17) for a temporary display benefit.

--------------------------------------------------------------------------------

## Non-Functional Requirements

- **Security and privacy**: derivation consumes the adapter's already-redacted
  text; the cap runs after redaction. No session text leaves the machine.
- **Performance**: post-pass budget above; no change to capture cost.
- **Rollout**: no flag. New captures carry derivation; saved reviews are labelled
  rather than migrated.

### Future Improvements

- **Stronger binding**: record a workspace tree hash when a command event is
  observed (`git rev-parse` plus `status --porcelain`), then compare against the
  checkpoint's tree. This would let the UI say a command ran against the bytes
  shown, for Git workspaces, at one git invocation per command on the observe
  path. **Deferred by author 2026-11-16**: decide after the deterministic
  derivation lands and its cost is measured.
- **Language-aware agreement detection** for markets whose messages are not
  space-separated.

--------------------------------------------------------------------------------

## Amendment: what the implementation settled (2026-11-16)

The review found contradictions in the sections above. Where the code now
decides differently, this section is authoritative.

### Placement

Objectives are derived in the adapter, after the event scan and before
`normalizeSnapshot`, because a turn's objective is only knowable once the turn
closes. Perspectives are applied in `readReview`, after `enrichSaved`,
`enrichRepositoryEvidence` and `analyzeSessionDependencies`, because those three
add hunks and dependency edges that a post-pass inside the adapter cannot see.

### Rules as implemented

- `requestsWork(text)` is true when the text contains `?` or a verb from the
  fixed `IMPERATIVE` list. R3 and R4 test `requestsWork` and nothing else.
- R1 fires only when a source kind is present and is not `user`, or when the text
  starts with a delegation or injected-context prefix. Absent kind is legacy and
  is decided by R6.
- R3 also requires two words or fewer, so a short imperative such as
  "Protect sign in" survives.
- R5 requires the redacted user text to appear inside an earlier
  `assistant/message` in the same session.
- The rule lists are closed: agreement tokens, delegation prefixes and imperative
  verbs are data, and `rulesVersion()` hashes the rule ids.

### Decisions the implementation made

- **Carry-forward.** A turn with no objective attributes its changes to the most
  recent objective, labelled as a continuation (`provenance: inferred`, rationale
  naming the originating turn). Without it, 44 percent of work-producing turns in
  `session-ddca4444` carried no objective; with it, zero.
- **Acknowledgement referent** takes the last action-shaped sentence of the
  turn's assistant messages and records it `provenance: inferred`,
  `selection: acknowledgement-referent`.
- **Agent todo** takes the first `in_progress` item of the last `todo/write`,
  else the last completed item, recorded `provenance: declared`.
- **Unnamed turns** render as `Unnamed work`. A turn number never appears as a
  title.
- **Command binding** is the previous turn's closing checkpoint. Process outcome
  comes from `job/settled` (`status`, `detail`), joined by
  `toolCall.callId ?? toolCall.toolCallId`, with the output's exit marker as a
  fallback. `testOutcome` stays `unknown`.
- **Perspectives** use a business-vocabulary first pass, then the first product
  directory minus a denylist, then an explicit `Unclassified paths` bucket. Risk
  is tagged by rule id with a `No risk signal` bucket.

### Measured on this machine, 2026-11-16

Two earlier ❌ rows were measurement-design errors and one was a real defect. All
three are settled below.

| Target | Measured | State |
| --- | --- | --- |
| Status questions never become objectives | Rule R8 drops 54 such messages in `session-ddca4444`; unit test pins the behaviour; a manual sample of 20 kept objectives found 19 requests and 1 borderline | ✅ |
| Work-producing turns with no objective ≤15% | 0% of 279 with carry-forward (44.1% without) | ✅ |
| Commands bound to a preceding checkpoint ≥90% | 97.7% of 7,272 command records | ✅ |
| Capability ≥3 groups, largest <70% | 9 groups, largest 58.3%, 2 of 139 unclassified (`c78088d674`) | ✅ |
| Risk ≥2 signals plus bucket | 4 groups on a 193-hunk code snapshot: Security-sensitive 1, Deletion-heavy 7, Test-only 45, No risk signal 143 | ✅ on code; the earlier ❌ came from measuring a documentation-only session |

Defect found while measuring: the status-question rule first tested `?` on
normalised text, and normalisation strips punctuation, so most status questions
survived. Fixed, tested, and re-measured; the drop count rose from 31 to 54.

The measurement tool's independent "report-only" proxy is narrower than the rule
it checks and still flags request-shaped questions. It is reported as a signal,
not as a pass or fail; the unit tests are the authority on rule behaviour.

### Known gaps carried forward

- A saved snapshot without `derivationVersion` does not yet render the
  pre-derivation notice.
- `recoverSession` can merge objectives written before this change beside derived
  ones for the same turn; no reconciliation keyed by turn exists yet.
- Checkpoint records written before this change still carry `Turn N` milestone
  targets.
- Background job output is not yet joined from the later `job_output` result.
- The Journey hides `unaligned-request` events; they are retained but not
  browsable.
