# Goldfish review: Agent X-Ray derivation design

*   **Target:** `docs/designs/agent-xray-derivation.md` (566 lines, Status: Proposed)
*   **Date:** 2026-11-16
*   **Mode:** Consolidated report, stages 5–6 of the uninterrupted flow
*   **Reviewers run:** `egm-zoom-out`, `egm-inventive-catalyst` (fresh context, no conversation history)
*   **Reviewers not run:** comprehension, critic, intermediate zoom-out, implementation readiness — held because five blockers make further passes on the same sections wasteful

Findings were deduplicated and then re-verified against the code and event logs by
the Elephant. Every claim below carries the verification state the Elephant
established, not the state the reviewer claimed.

---

## Blockers

### B1. The binding rule cannot fire in real data

**Raised by:** both reviewers, independently. **Verified: yes.**

`workspace/changes` is the turn's terminal event: it is followed by `turn/end`
and preceded by `tool/result`. A rule that looks for a checkpoint *earlier in the
same turn* therefore finds almost nothing.

- Reviewer measurements: 2 of 1,254 commands (catalyst), 0 of 558 (zoom-out).
- Elephant re-measurement, session `session-cb3f84b9`: 11 of 144 commands (7.6%)
  have any earlier same-turn checkpoint, and every one of those sits in a turn
  with an unusual mid-turn checkpoint.
- Consequence: G3, CUJ 2 and the whole "Command binding" section describe a label
  the reader will never see. Every card collapses to "No recorded workspace
  checkpoint in this turn", which is the vacuous state the design set out to
  replace.

**Two measured alternatives:**

| Mechanism | Coverage | Label it produces |
| --- | --- | --- |
| Previous turn's closing checkpoint | 538 of 558 (96.4%) | "Ran against the tree recorded at the end of turn N-1 (seq M)" |
| Preceding file-tool edits in the same turn | 250 of 1,254 (19.9%) | "Preceded by N edits in this turn: paths" |

Neither proves the command exercised the shown change. The first is near-universal
and coarse; the second is precise about ordering and covers a fifth of commands.

### B2. G1's noise target is not reachable by the specified rule table

**Raised by:** zoom-out (measured), reinforced by catalyst. **Verified: yes.**

Applied R1–R6 to the 39 cached objectives of the reference session: 13 dropped,
26 kept, and at least ten of the kept are procedure ("what did you do ?", "are you
stuck ?", "revert it back please", "i clicked this wasn't me by mistake"). That is
about 38% noise surviving a 10% target, and several sit alone in their turn so
per-turn narrowing does not help.

The table has no rule separating a correction from a goal. That gap is exactly
what Option A's own "fails when" paragraph admits. Closing it means adding a
request-shape gate — which is Option B, the alternative the author rejected.

Catalyst adds the inverse risk: G1 measures only survivors, so deleting more text
always scores better. Without a recall floor (work-producing turns that end up
"unnamed work"), G1 and G2 can both go green while a third of working turns lose
their objective. Measured: 31% of work-producing turns got no objective under an
approximate R1–R5 (⚠️ approximate reimplementation).

### B3. The binding text never reaches the reader

**Raised by:** both. **Verified: yes.**

`core/verification.js:12-29` (`projectCheck`) unconditionally overwrites `status`,
`testOutcome`, `toolOutcome`, `binding` and `association`, and it is the only path
to the UI (`ui/render.js:213`, `:288-296`). The plan created a separate
`core/verification-binding.js` and never listed `core/verification.js` as
modified, so its strings would be written, unit-tested, and discarded.

### B4. Objectives move to turn close, but `task` relationships are stamped during the turn

**Raised by:** zoom-out. **Verified: yes** (`plugin/dsh-adapter.js:171`).

`objectiveId` is captured at `tool/call` time and `attach()` emits `kind: "task"`
from it. If selection happens at turn close, no objective exists at stamp time,
no `task` relationship is emitted, and the Story view — grouped by `task`
(`ui/render.js:243`) — collapses into the residual bucket. The reference snapshot
carries 118 `task` relationships that this would delete.

### B5. G2 is measured on a field no view renders

**Raised by:** zoom-out. **Verified: yes.**

`model.milestones` is written at `plugin/dsh-adapter.js:129` and read nowhere.
The Journey builds from `snapshot.events`; the Milestone perspective renders the
`milestone` relationship target (`"Turn " + turn`), and the checkpoint event title
is also `"Turn N · N files changed"` (`:358`). Retitling `milestones[]` would
leave every visible surface unchanged.

---

## Majors

### M1. The capability perspective is a coarser copy of the module perspective

**Verified: yes.** The adapter already emits `module` relationships on the
containing directory (`plugin/dsh-adapter.js:104-113`). The design defines
capability as root plus first segment — the same partition, one level up. G6's
thresholds would pass by relabelling and R06's "same hunk in multiple
perspectives" gains nothing. Real signals exist and are wired: the dependency
graph (`core/session-dependencies.js`) and co-change within a turn.

Related: M2. **The four capability roots are monorepo-specific** (`internal/platform/<x>`,
`src/<feature>`, `libs/<module>`, `apps/<app>`). This plugin's own tree
(`core/`, `ui/`, `plugin/`, `test/`) matches none, so the design's own
self-review step would report 100% unclassified. Correction: first segment after
the repository root minus a small denylist.

### M3. G6's thresholds are asserted on a fixture the author designs

Ten hand-picked paths satisfy "≥3 groups, largest under 70%" by construction. The
cached corpus has 138 changes; assert there as well.

### M4. Token-count heuristics delete non-space-separated languages

**Verified by inspection of the rule text.** R3 (under four whitespace tokens) and
R4 (English agreement tokens) treat a Chinese or Japanese message of any length as
one or two tokens and drop it as `brief-ack`. Threshold on character length with
token count as a secondary signal, and make agreement detection language-agnostic
or emit an explicit unsupported-language notice.

### M5. `assistant/message` is used by R5 but absent from the documented contract

**Verified:** the event type exists in real logs (`assistant/message`, hundreds per
session); `docs/dsh-api-contract.md:7` enumerates only user/tool/turn events. R5
removes 4 of 39 objectives, the largest single rule after R6, so an undocumented
shape is a silent G1 regression. Document the type and its visible-only boundary
against the "no hidden reasoning" non-goal.

### M6. R21 cannot be satisfied by editing its acceptance row

**Verified: yes.** R21 asks for distinct failed, pending, stale and unknown
states. The plan's step 14 rewrote `docs/acceptance-results.md` to match the
weaker implementation, which converts an unmet requirement into a passed one.
The recovery contract allows a test, a screenshot, or an explicit approved
deferral — not a reworded row.

Catalyst found the evidence that makes a real implementation possible: `job/settled`
carries `status` (`completed` / `killed`), `detail` (`exit code: N`), `cause` and
`toolCall`, keyed to the call. Verified in session `session-cb3f84b9`: 369 settled
events, 368 completed, 1 killed, `detail` present on all 369. Reviewer measured
12.7% nonzero exits across a larger sample. Process outcome is a fact and belongs
on its own axis, separate from `testOutcome: unknown`.

### M7. Systematic blindness to background job output

34 of 562 command results are launch acknowledgements; real stdout arrives later
in a `job_output` result joined by job id. The adapter stores the launch line as
the command's output. Not mentioned in the design. Join keys (`job/registered.jobId`,
`toolCall.callId`) are in the log.

### M8. `todo/write` is the only true `declared` source, and the design ignores it

**Verified:** present in real logs (11 in the reference session) with
`{todos: [{content, status}]}` and real status transitions. G4 names `declared` as
a provenance kind and nothing in the design produces one. It also answers R04's
"steps/progress" and covers plan-driven zero-hunk sessions.

### M9. Regarding actions kill the objective: the referent is already recorded

When a turn's only candidate is an acknowledgement ("do it", "continue",
"approved"), the referent sits in the immediately preceding assistant message.
Catalyst verified this pattern for six sampled acks. A deterministic fallback
(last assistant sentence stating an action, user seq in `derivedFrom`) needs no
content classifier.

### M10. Document contradictions

- Q1 and Q3 are presented as open while the document decides both.
- "Fail closed" contradicts R1/R6: a message with no source kind passes R1 and is
  kept by R6 — the current behaviour the design criticises.
- The Non-Goal says readers can distinguish snapshot generations; the versioning
  section says the UI adds no indicator. Only one can be true.
- G5 quotes "the existing test budget" but no timing assertion exists anywhere in
  `test/`.
- `derivationVersion: 1` is a constant, so it cannot identify the rule table it
  advertises as extensible. Version the rule set (hash) instead.
- The 15-file implementation checklist duplicates a convention this repo already
  separates: `docs/superpowers/plans/` versus `docs/designs/`.

### M11. Shape and consumer breakage

- `checkpointSeqs` is consumed as `number[]` by `plugin/checkpoints.js:55-59`;
  the plan's `{seq, turn}` objects silently disable `enrichSaved`.
- One group string, two renderings: `core/model.js:101` emits "Not yet linked",
  `ui/render.js:36` remaps it for Story only, `:68` prints it raw elsewhere.

---

## Nits

1. `bindCommand` return shape and `checkpointSeqs` mismatch (subsumed by B3: the
   module should not exist as a separate vocabulary).
2. Dropped messages retained as `type: "request"` would reintroduce the original
   defect; they need a distinct type the UI skips deliberately.
3. Problem statement says every command is recorded `status: recorded`;
   `plugin/dsh-adapter.js:288` sets `failed` when `isError`. Reword to "recorded
   with an outcome the reader cannot interpret".
4. Sidebar `<h1>` is `objectives.at(-1).title` (`:486`) — once objectives are
   derived, the title becomes the last correction. Choose deliberately.
5. Corpus counts unpinned (67 vs 70 sessions); quote `snapshotId` and date per
   measurement.
6. Provenance flips from `declared` to `inferred` without saying so; the badge is
   rendered.
7. `cleanObjective` must run after the adapter's `clean()` redaction, not before,
   so a 120-character cap cannot split a secret pattern.
8. Goal order is G1, G2, G3, G4, G6, G5.

---

## Findings rejected after verification

- **"16 Playwright tests"** (zoom-out nit 21). `npx playwright test --list`
  reports **22 tests in 3 files**, matching the design's figure. The reviewer
  counted `test(` occurrences and missed loop-generated cases.

## Consequences for the review

Stages 6 through 9 were not run. B1 and B2 invalidate the sections those stages
would review: comprehension would paraphrase a binding that cannot fire, and
implementation readiness would check a rule table that cannot hit its own target.
Re-running them before the repair spends reviewer passes on text that is about to
change.

---

## Resolution log (Elephant, 2026-11-16)

Repair direction chosen by the author: evidence-first, no request-shape classifier.

### Applied

| Finding | Change made |
| --- | --- |
| B1 binding predicate | Binding now uses the previous turn's closing checkpoint (measured 538/558 = 96.4%). G3, CUJ 2 and the binding section rewritten; the unreachable same-turn rule removed. |
| B2 noise target | Added acknowledgement-referent fallback, agent-todo declared source, character-length thresholds, and a recall floor (≤15% of work-producing turns unnamed) measured in the same run as the noise ceiling. |
| B3 overwritten binding | `core/verification.js` is now the single owner of check projection; the separate `core/verification-binding.js` module was dropped from the plan and added to the target list instead. |
| B4 task stamping | Derivation moved to a post-pass over the assembled model, so objectives exist before `task` targets are rebound. |
| B5 dead milestone field | The three visible surfaces are named and retitled; `model.milestones` is wired to the Journey or deleted. |
| M1, M2 perspectives | Capability from the first path segment minus a denylist; co-change and import edges as corroboration. |
| M3 | G6 asserted on the cached 138-change session, fixture kept as a unit test. |
| M4 | Character-length thresholds; language-aware agreement detection deferred. |
| M5 | `docs/dsh-api-contract.md` added to the plan to document `assistant/message`. |
| M6 | R21 implemented through observed process outcome from `job/settled`, kept on a separate axis from coverage. The acceptance row now states what is produced and what stays deferred. |
| M7 | Background job output joined by job id. |
| M8 | `todo/write` used as the `declared` source and for milestone transitions. |
| M9 | Acknowledgement referent taken from the preceding assistant action sentence. |
| M10 | Contradictions fixed (open questions closed, fail-closed aligned, generation notice added, rule-set hash, implementation checklist moved to `docs/superpowers/plans/`). |
| M11 | `checkpointSeqs` stays numeric; a separate turn-bearing list feeds binding; one residual group string. |
| Nits 1–8 | Module dropped, distinct `unaligned-request` type, problem statement reworded, headline chosen deliberately, snapshot pinned, provenance kept `declared` with `selection: inferred`, redact-before-cap ordering stated, goals renumbered. |

### Contested

- **"16 Playwright tests"** stands rejected. `npx playwright test --list` reports
  22 tests in 3 files.

### Review state

Stages 6–9 were not run against revision 1 because five blockers made the sections
under review about to change. Implementation readiness (stage 9) runs against the
repaired design and the plan.

---

## Resolution log, part 2: stages 9 (implementation readiness, codebase details, style)

Three reviewers ran against the repaired design and plan. Their blockers were
resolved in code rather than in prose where the code could answer them:

| Finding | Resolution |
| --- | --- |
| Post-pass had no data for assistant messages, todos, job settlements | Adapter collects all three; checks now carry `callId` for the settlement join. |
| Post-pass placement missed enriched hunks and dependencies | Objectives derive in the adapter; perspectives run in `readReview` after enrichment. |
| R1 made R6 unreachable; kind vocabulary wrong | R1 now fires only on a present, non-user kind; `human`/`user-input` removed; injected text shapes added. |
| Task/milestone rebinding had no owner | Rebinding happens in `deriveObjectives` over all hunks, including recovered ones. |
| Milestone fallback contradicted the honesty check | Unnamed turns read `Unnamed work`; no turn number is used as a title. |
| Process outcome vocabulary missed `failed` and signals | Labels extended; exit parsed from `detail` with an output-marker fallback. |
| Existing tests encoded the old behaviour | `test/recovery.test.js`, `test/model.test.js`, `test/verification.test.js` and the browser suite pass unchanged in meaning; 121 unit tests and 22 browser tests green. |
| Quantitative targets had no fixtures | `scripts/measure-derivation.js` is committed and its numbers are reported in the design amendment, including the two targets it misses. |

Not yet resolved: the pre-derivation notice, `recoverSession` objective
reconciliation, stale checkpoint milestone labels, background job output join,
and the Journey treatment of `unaligned-request` events.
