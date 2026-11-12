# Agent X-Ray Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the discussed session-aware visual review experience, with a clean native sidebar and evidence-backed synchronized views.

**Architecture:** Separate the DSH adapter, immutable review model, evidence projection, and UI. Keep the working native sidebar entry point and theme integration. Introduce real session data before presenting semantic views as live functionality; keep demo fixtures on a separate source.

**Tech Stack:** JavaScript ES modules on Node, DSH native sidebar/React host entry, semantic HTML/CSS/SVG review UI, Node tests and Playwright cloud browser checks. Add a maintained JavaScript/TypeScript parser for structural analysis only after checking its package/API/license; do not use regular expressions as a general source parser.

**Spec:** `docs/superpowers/specs/2026-11-12-agent-xray-recovery.md`

## Global Constraints

- DSH first; Claude mod support remains explicitly deferred.
- Native right sidebar with host-owned resize/split/maximize and host theme tokens.
- Normal sessions show live data; examples are explicit opt-in and remain fictional.
- Never infer authorship from a repository diff alone; unknown is not a task or a passed check.
- Never accept arbitrary repository paths from the browser.
- No browser automation on the user's laptop; browser validation runs in the cloud.
- Reviewing must not interrupt the running agent or steal the reviewer's selection.
- Baseline runtime floor remains Node >=22.19.0; validate on Node 24 as existing CI does.
- DSH lab currently pins 0.2.0-rc.2. Task 1 must record actual target runtime versions and resolve API compatibility before implementation.
- Preserve user changes and existing remote work; start from verified current main in a clean branch.

## Review Focus

1. Concurrent sessions sharing a repository: preserve workspace versus session attribution, never claim causality from timing alone. Tasks 2, 4, 5.
2. Missing/truncated/replayed events and checks: no invented rationale, duplicate events, or false passed status. Tasks 2, 4, 5.
3. Refresh while reading an old hunk: preserve snapshot, selection and scroll; surface available updates. Tasks 6, 9.
4. Long/Unicode/quoted paths, binary/renamed/deleted/new files and large repositories: correct metadata, bounded work and explicit truncation. Tasks 3, 7, 10.
5. Narrow sidebar, dark theme, keyboard use and absent semantic data: usable compact layout and honest fallback views. Tasks 6–10.

## Execution order and boundaries

One task at a time. Each task closes with its own tests and commit. Tasks 1 and 6 produce reviewable visual/API evidence before expensive downstream work. A failed feasibility check changes the plan openly; it is not permission to substitute fictional data. This is a product rebuild, not a CSS patch.

### Task 1: Verify DSH integration and freeze the visual direction

**Files:** Create `docs/dsh-api-contract.md`, `docs/design-review.md`, `test/host-contract.test.js`; visual captures under `docs/previews/`.

**Interfaces:** Establish verified mappings for active session ID, authorized workspace root, history reading, event subscription, persisted plugin storage, and sidebar lifecycle. Do not invent host method names. Produce a concrete adapter contract used by Task 4: `resolveContext(sessionId)`, `readHistory(context, cursor)`, `subscribe(context, onEvent)`.

- [ ] Inspect the installed DSH runtime/package source and pinned cloud runtime; record exact service names, signatures, event shapes, supported versions, teardown behavior and source locations. Do not read private session contents merely to discover schemas.
- [ ] Write contract tests for resolving two fixture sessions to different workspaces and subscribing/unsubscribing without affecting execution; run against the supported host, not only mocks.
- [ ] Verify the active sidebar can receive session changes. If no supported context/event API exists, document the concrete limitation and obtain a scope decision before claiming session support.
- [ ] Produce narrow and expanded visual mockups from the recovered design: compact story summary, grouped tree, contextual inspector, actual graph and timeline surfaces. Show light/dark and missing-context variants.
- [ ] Review the mockups against R01–R25 and the user's screenshot; record approval or corrections before replacing the live UI.
- [ ] Commit the verified contract and reviewed visual direction. Gate: reproducible API probes and approved visual examples, not an assertion of feasibility.

### Task 2: Define the shared review model and projections

**Files:** Create `core/model.js`, `core/project.js`, `test/model.test.js`; adapt `examples.js` behind a demo source.

**Interfaces:** `normalizeSnapshot(input) -> ReviewSnapshot`; `projectReview(snapshot, {objectiveId, groupBy, query}) -> {groups, counts, story, graph, timeline}`. Snapshot fields are specified in the spec. Hunk identity is `(snapshotId, hunkId)`; relationships reference IDs, never copied hunks.

- [ ] Add failing tests: `unknown attribution counts zero objectives`; `two objectives reference separate hunks in one file`; `one hunk appears in multiple perspectives once per group`; `demo cannot enter live snapshot`; `missing evidence cannot become verified`.
- [ ] Implement validation, immutable normalized entities and deterministic projections. Distinguish observed/declared/inferred/demo evidence. Separate declared objectives from inferred classifications.
- [ ] Run `node --test test/model.test.js`; require all named assertions to pass.
- [ ] Convert the three existing scenarios to the same model; preserve opt-in behavior and explicit demo provenance. Commit.

### Task 3: Make Git snapshots complete and safe to inspect

**Files:** Modify `plugin/git.js`; create `core/diff.js`, `test/diff.test.js`; extend `test/git.test.js`.

**Interfaces:** `readSnapshot(root, {sessionId, workspaceId, baseRevision}) -> ReviewSnapshot` with file status, ranges, +/− counts, truncation and baseline metadata. Keep raw patch available for copy. Diff parser returns data without fabricated task/story fields.

- [ ] Add failing fixtures for additions/deletions, separate hunks, quoted/Unicode/tab paths, no-final-newline, rename-only and binary files, staged plus unstaged edits, untracked additions and empty repository.
- [ ] Use NUL-delimited Git metadata for file names; represent unsupported/binary content explicitly. Bound untracked reads and repository output; never traverse symlinks outside the authorized root.
- [ ] Remove raw hunk-heading prose from story titles. Render zero attributed tasks when evidence is absent. Preserve real old/new ranges and snapshot identifiers.
- [ ] Run `node --test test/git.test.js test/diff.test.js` with real temporary repositories. Verify output limits and error cases. Commit.

### Task 4: Implement session context, collection and retained history

**Files:** Create `plugin/dsh-adapter.js`, `plugin/history-store.js`, `test/dsh-adapter.test.js`, `test/history-store.test.js`; modify `plugin/index.js`, `plugin/client.js`.

**Interfaces:** Adapter from Task 1 implements `resolveContext(sessionId) -> Promise<{sessionId, workspaceId, root, capabilities}>`, `readHistory(context, cursor) -> Promise<{events, cursor}>`, `subscribe(context, onEvent) -> dispose`. Store exposes `append(context, events, snapshots)`, `read(context, snapshotId)`, `list(context)`.

- [ ] Add failing tests for two workspaces, two sessions in one workspace, unknown/unauthorized session, session switch during fetch, replay deduplication, out-of-order events, restart and immutable historical snapshots.
- [ ] Pass verified host session identity from the native panel. Resolve roots server-side. Remove implicit lab-root fallback in ordinary sessions; retain explicit lab mode for test scripts only.
- [ ] Capture supported history/live events and checkpoints; serialize writes and atomically persist plugin-owned data. Mark missing baselines/history and simultaneous edits as uncertainty, not attributed agent changes.
- [ ] Scope endpoints to authorized session context, preserve Connection admission, dispose subscriptions and cancel stale requests on switching.
- [ ] Run adapter/storage tests plus Task 1 host contract tests. Prove session A cannot render session B's data after a delayed response. Commit.

### Task 5: Connect intent, actions, changes, dependencies and checks

**Files:** Create `core/evidence.js`, `core/dependencies.js`, `core/symbols.js`, `test/evidence.test.js`, `test/dependencies.test.js`.

**Interfaces:** `relateEvidence(snapshot, events) -> ReviewSnapshot`; `analyzeSources(files) -> {symbols, dependencies, diagnostics}`. Relationships retain source references, provenance, rationale and snapshot association.

- [ ] Add failing cases for declared user objective, declared agent action, inferred business capability/risk, ambiguous edit attribution, duplicate command results, failed/pending/stale checks, and commands whose zero exit status does not establish tests passing.
- [ ] Link observed edit/tool events to exact snapshots/hunks where supported; leave ambiguity explicit. Group by task, capability, module, risk and milestone through separate relationships.
- [ ] Parse JavaScript/TypeScript symbols and imports with a maintained parser; record unsupported/dynamic dependencies. Test cycles, unresolved imports, functions sharing files and unsupported language fallback.
- [ ] Build story steps from sourced relationships and ordered milestones; do not invent a hidden rationale. Link command evidence to the snapshot it actually verified.
- [ ] Run evidence/dependency tests. Verify changed snapshot makes previous verification stale. Commit.

### Task 6: Rebuild the compact sidebar and common interaction state

**Files:** Modify `index.html`, `style.css`, `app.js`; create `ui/state.js`, `ui/shell.js`, `ui/story.js`, `test/ui-state.test.js`, `test/browser/sidebar.spec.js`.

**Interfaces:** `createReviewState(sessionId)`, `reduceReview(state, action)`, `renderShell(root, snapshot, state, dispatch)`; actions select objective/view/snapshot/hunk, filter query, change layout and toggle follow. State keyed by session plus source; views consume projections from Task 2.

- [ ] Test unknown objective count, independent session state, demo/live separation, selection retention and loading/error/empty states.
- [ ] Implement the reviewed compact header, source menu, overview/story rows, small view tabs and contextual inspector; remove oversized stacked selects and paragraph-like filename cards.
- [ ] Use one column at 360–480 px and navigation/detail split at >=760 px as starting breakpoints; tune from approved captures. Preserve host-owned expansion controls.
- [ ] Provide keyboard focus, semantic accessible controls, reduced-motion behavior and readable theme contrast. Keep missing-context notices concise.
- [ ] Run UI state tests and cloud browser checks at 360, 480, 900 and 1440 px; capture light/dark. Review against Task 1 visuals, not just screenshot existence. Commit.

### Task 7: Implement the real Change Explorer

**Files:** Create `ui/explorer.js`, `ui/diff-view.js`, `test/browser/explorer.spec.js`; extend `core/diff.js` tests.

**Interfaces:** `renderExplorer(snapshot, state, dispatch)` and `renderDiff(hunk, {layout, selectedLine})`; both use common state. Copy action returns raw patch for the selected hunk.

- [ ] Add browser assertions for file/symbol search, collapsible groups, exact +/− counters, next/previous hunk, correct line selection and clipboard patch.
- [ ] Implement compact basename/path rows and all five grouping perspectives. A selected hunk must retain identity across grouping changes.
- [ ] Render aligned side-by-side and unified code, clear old/new gutters, horizontal scrolling contained within code, and source-linked Why/Verification details.
- [ ] Run tests for insertion/deletion alignment, long paths, multiple hunks and search with no matches. Capture narrow/expanded views. Commit.

### Task 8: Implement distinct Map and Journey views

**Files:** Create `ui/map.js`, `ui/journey.js`, `test/browser/map-journey.spec.js`.

**Interfaces:** Both consume `projectReview` and dispatch common select events. Map nodes reference modules/files/symbols; timeline events reference snapshots, actions, checks and hunk IDs.

- [ ] Add tests proving a graph node selects its exact change and linked action; a timeline event restores its historical snapshot; switching views preserves selected evidence.
- [ ] Render SVG dependency nodes/edges, selected-neighbor highlighting, legend and fit/zoom controls with an accessible list equivalent. Containment and dependency edges must be visually distinct.
- [ ] Render chronological milestone groups with timestamps, activity type, declared intent and verification state. Provide honest no-events/no-dependencies states.
- [ ] Validate cyclic/empty/large graphs, multiple actions per hunk, keyboard navigation and historical deleted files in cloud. Capture both actual views. Commit.

### Task 9: Add live catch-up, Follow Agent and persistence

**Files:** Create `ui/live.js`; extend `ui/state.js`, `plugin/history-store.js`; create `test/browser/live-history.spec.js`.

**Interfaces:** `connectReview(context, {onSnapshot, onStatus}) -> dispose`; `applyIncomingSnapshot(state, snapshot)` leaves selection unchanged unless follow is enabled.

- [ ] Test update arrival while reading a historical hunk, explicit follow, collapse/expand scroll restoration, restart, session switch, disconnect/reconnect and overlapping responses.
- [ ] Show a subtle new-updates indicator with a catch-up action. Follow Agent defaults off. Preserve exact selected snapshot, line, filters and scroll across host layout changes.
- [ ] Display current agent activity only from observed events; browsing old changes never sends execution-control commands.
- [ ] Run live/history browser tests with deterministic recorded host events. Verify no implicit selection jump and no cross-session state bleed. Commit.

### Task 10: Close the acceptance matrix and ship reviewable evidence

**Files:** Commit `test/browser/` coverage, `playwright.config.js`, test scripts in `package.json`; update `.github/workflows/dsh-lab.yml`, `scripts/smoke-lab.js`, README, architecture and lab docs; create `docs/acceptance-results.md`.

**Interfaces:** `npm test`, `npm run test:browser`, and existing DSH smoke script form the reproducible validation entry points. Exact supported DSH versions come from Task 1.

- [ ] Run unit/integration tests, authenticated host smoke checks and cloud browser suite; no dependency on the user's laptop browser or private credentials.
- [ ] Exercise 100-file fixture, real Git editing, two workspaces, two sessions sharing a workspace, snapshot replay, malformed/oversized events and stale verification. Use deterministic host event fixtures for CI, plus one actual authorized agent editing run when model credentials are available.
- [ ] Capture and inspect the full light/dark narrow/expanded visual matrix. Test production package installation, not only source serving.
- [ ] Fill every R01–R25 row with observed proof or an explicitly approved deferral. Missing credentials/API capabilities remain visible release gaps; mock tests do not close them.
- [ ] Correct stale documentation and record support boundaries. Open a PR with screenshots, acceptance results and material limits. Merge/deploy only the concrete reviewed result under current user authorization; verify installed version and cloud behavior afterward.

## Self-review

Coverage: R01–R03 → 1/6/10; R04–R08 → 2/4/5/6; R09–R10 → 3/7; R11–R14 → 5/8; R15–R18 → 4/6/9; R19–R21 → 1/4/5; R22 → 2/6/10; R23–R24 → 10; R25 → global constraints and adapter boundary.

Unresolved implementation dependency: verified DSH session/history/event APIs, handled first in Task 1. The plan does not assert those APIs exist merely because sidebar registration works. Visual direction is a proposed faithful reconstruction, not a recovered source implementation. Review these two foundations before coding the rebuild.
