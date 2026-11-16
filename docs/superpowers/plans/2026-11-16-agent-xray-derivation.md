# Implementation plan: Agent X-Ray derivation layer

*   **Author:** Yousef Joe
*   **Status:** Implemented 2026-11-16; see the design amendment for what landed
*   **Date:** 2026-11-16
*   **Design:** `docs/designs/agent-xray-derivation.md` (revision 2)

--------------------------------------------------------------------------------

## Target files

### Create

#### 1. `core/objectives.js`

*   **Scope:** Pure derivation. No host imports.
*   **Changes:** `RULES` as data (R1–R7 from the design, character-length
    thresholds), `classifyMessage({ text, sourceKind, priorAssistantText })`,
    `selectCandidate(candidates)`, `ackReferent({ messages, assistantText })`,
    `todoObjective({ writes })`, `cleanObjective(text)`. `cleanObjective` receives
    already-redacted text and caps at 120 characters.

#### 2. `test/objectives.test.js`

*   **Scope:** Unit coverage of the rule table.
*   **Changes:** One passing and one near-miss case per rule, including a CJK
    message of 40 characters (must survive R3), a link plus 100 characters of prose
    (must survive R2), an acknowledgement with a preceding action sentence (must
    resolve through the referent), and an acknowledgement with none (must not
    become an objective).

#### 3. `test/derivation-integration.test.js`

*   **Scope:** Post-pass behaviour over an assembled model.
*   **Changes:** Asserts that objectives are derived after turn close, that `task`
    relationship targets point at the derived objective rather than a raw message,
    that `milestone` targets and checkpoint event titles carry phrases, and that
    dropped messages appear as `unaligned-request` events that no view promotes.

#### 4. `test/verification-projection.test.js`

*   **Scope:** Single-owner projection.
*   **Changes:** Process outcome mapping from `job/settled` (`exited 0`,
    `exited N`, `killed`, `not recorded`), coverage that stays `unknown`, the exact
    association strings, and a background job whose output arrives later.

#### 5. `test/fixtures/noisy-session.js`

*   **Scope:** Event-log fixture.
*   **Changes:** Contains the measured noise classes (link, ack, quoted agent
    prose, injected prompt, absent source kind), a `todo/write` sequence, one
    nonzero-exit job, one background job, and hunks across three path shapes.

#### 6. `scripts/measure-derivation.js`

*   **Scope:** Developer measurement tool, committed so the goals stay falsifiable.
*   **Changes:** Reads a session log, prints objective count, drop rate per rule,
    unnamed work-producing turns as a share, binding coverage, process outcome
    distribution and perspective group counts. `--json` for CI assertions.

### Modify

#### 7. `plugin/dsh-adapter.js`

*   **Scope:** Host adapter.
*   **Changes:** Remove the inline objective block (`:137-155`) and the milestone
    turn title (`:132`); emit dropped messages as `unaligned-request`; collect a
    turn-bearing checkpoint list alongside `checkpointSeqs`; call the derivation
    post-pass before `normalizeSnapshot`; delete `model.milestones` or wire it to
    the Journey; set the headline from the objective with the most changes.

#### 8. `core/verification.js`

*   **Scope:** The single owner of check projection.
*   **Changes:** Accept binding fields carried on the check record, compose the
    association text, add the process-outcome axis, and stop the adapter from
    writing a parallel vocabulary.

#### 9. `core/evidence.js`

*   **Scope:** Perspective heuristics.
*   **Changes:** Capability from the first path segment minus denylist; risk as
    tagged signals with a no-signal bucket; co-change and recorded import edges as
    corroboration; unclassified count on the snapshot; rule id in every rationale.

#### 10. `core/model.js`

*   **Scope:** Model normalisation and grouping.
*   **Changes:** One group string for the residual bucket; expose capability
    coverage and the risk no-signal bucket through the existing group builder.

#### 11. `ui/render.js`

*   **Scope:** Presentation strings.
*   **Changes:** Delete the `:36` remap so Story and Changes agree; render the
    association string and the missing-stage line; render the pre-derivation notice
    from `snapshot.notices`; show the provenance badge with `selection: inferred`
    where it applies.

#### 12. `test/browser/review.spec.js`

*   **Scope:** Browser regression (22 existing tests).
*   **Changes:** Assert the united group label, perspective group counts on the
    demo, and a live fixture with no derived objective showing the single-line
    missing-evidence text.

#### 13. `docs/dsh-api-contract.md`

*   **Scope:** Verified host contract.
*   **Changes:** Document `assistant/message` (visibility boundary against hidden
    reasoning), `job/settled` (`status`, `detail`, `cause`, `toolCall`), and
    `todo/write`. R5, the process-outcome axis and the todo source all depend on
    these; an undocumented shape is a silent regression.

#### 14. `docs/architecture.md`

*   **Scope:** Architecture record.
*   **Changes:** Describe the post-pass boundary, that all derived values are
    labelled, and that absence fails to a label rather than a guess.

#### 15. `docs/acceptance-results.md`

*   **Scope:** Requirement coverage record.
*   **Changes:** Update the rows that exist (R04–R05, R06–R08, R21) to cite the
    tests that prove each. R21 states which of failed, pending, stale and unknown
    the implementation now produces, and what remains deferred, with the reason.
    No row is reworded to match a weaker implementation.

#### 16. `README.md`

*   **Scope:** User-facing limits.
*   **Changes:** One paragraph: objectives, milestones and bindings are
    deterministic inferences; process outcome is a fact while coverage is not;
    saved reviews are labelled rather than migrated.

## Verification

| Check | Command | Target |
| --- | --- | --- |
| Unit suite | `npm test` | all existing and new tests green |
| Browser suite | `npx playwright test` | 22 existing tests plus new assertions |
| Post-pass budget | included in unit suite | 1183-event fixture under 200 ms with slack |
| Noise ceiling | `node scripts/measure-derivation.js <session>` | procedural survivors ≤10% on ≥3 sessions |
| Recall floor | same run | ≤15% of work-producing turns unnamed |
| Binding coverage | same run | ≥90% of commands bound to a preceding checkpoint |
| Perspectives | same run on the cached 138-change session | ≥3 capability groups, largest <70%, ≥2 risk groups plus no-signal, zero unclassified silent gaps |
| Honesty | manual + unit | no view renders "Turn N" as a title, no dropped message appears as an objective |

Numbers in the design are targets to measure after implementation, not results
claimed now. Any target that the implementation misses is reported with its
measured value rather than restated.
