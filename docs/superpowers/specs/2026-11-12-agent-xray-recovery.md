# Agent X-Ray: requirements recovery and acceptance contract

Status: audited requirements and proposed implementation contract; not a completion report.

## Sources and limits

Reviewed the accessible original conversation `6af5f407-e304-83ed-ab8f-b2dd7f70ead8` (five returned turns, no older cursor), its recovered reference image, this continuation, the user's current screenshot, and the repository code/tests. The original interactive component source is not available through that transcript. Recovered text and screenshot support the intent below; pixel-perfect reproduction of unavailable components cannot be claimed.

The user explicitly chose DSH first, a theme-matched native sidebar with expansion, cloud testing without operating their laptop browser, rich opt-in examples, and grouping changes by task/business purpose. The original conversation also proposed synchronized views, contextual evidence, history, and Follow Agent. This contract includes those discussed proposals in the requested completeness audit; they are not all implemented today. Claude mod support remains explicitly deferred.

Baseline: main merged PR #4 at `569fdb785e95d1f9912fa3351eab258e77b0a90d`; local implementation examined at `7036752`, the PR's source commit. Only documentation changes belong to this audit.

## Product intent

Help someone returning to a coding session understand what the agent changed, why, what it affects, and what has actually been verified. Begin with a calm change story; let them descend from objective to module/file/function/hunk and evidence. All views inspect the same underlying changes. They must not merely rename a Git list.

## Coverage audit

| ID | Discussed requirement | Observed implementation | Acceptance evidence required |
|---|---|---|---|
| R01 | Native right sidebar; resizable/split/maximized | Native host registration and retained iframe exist | Open, resize, split, maximize, collapse, restore in supported DSH |
| R02 | Match IDE theme and feel | Theme tokens mirrored; poor hierarchy and spacing | Light/dark screenshots at narrow, split, and maximized widths; visual comparison with reference |
| R03 | Calm overview even with 100 changed files | Full controls and wrapping file cards; arbitrary height limits | Compact objective/status summary, collapsible groups, search; large fixture remains usable |
| R04 | Active objective, steps/progress, current activity | Dropdown called Mission Control | Observed objectives and statuses; no fabricated progress or counting unknown buckets as tasks |
| R05 | Story first, code second | Story field becomes path plus raw hunk header in live mode | Short evidence-backed outcome sequence with exact diff navigation; explicit fallback when context absent |
| R06 | Group by task, business capability, architecture, risk, milestone | Five selectors work only meaningfully on fixtures | Relationships derived from evidence, with unknown groups and explanations; same hunk in multiple perspectives |
| R07 | Hunk/function-level identity; one change stored once | Hunks hashed per current diff; string metadata | Snapshot-scoped hunks and separate many-to-many relationship records; multiple objectives in one file |
| R08 | Explain why and provenance | Generic evidence paragraph | User request → declared action/inference → exact change → verification, each with source references |
| R09 | Changed-file search, tree, addition/deletion counts | Missing | Search by path/symbol, collapsible groups, compact basename/path rows and accurate +/− counts |
| R10 | Exact diffs, unified/side-by-side, hunk navigation, copy | Basic diffs/layout exist; copy/navigation absent | Correct ranges, aligned split lines, next/previous, copy exact patch, keyboard navigation |
| R11 | Interactive architecture map | Lists grouped by top-level path; demo dependency text | Real nodes/edges, affected state, legend, selection and focus; distinguish dependencies from containment |
| R12 | Select module/class/function → diff and action | Shared selected hunk, no symbols or actual graph | Cross-view selection including symbol ranges and originating action; unsupported languages labeled |
| R13 | Journey timeline and visual catch-up | Flat action list; live action unavailable | Ordered user requests/actions/checks, milestones and timestamps; click to related changes |
| R14 | All perspectives stay synchronized | Basic task/hunk shared state | One selection model; map/story/tree/journey highlight same snapshot/hunk and evidence |
| R15 | Follow Agent opt-in; subtle live update indicator | Manual refresh only | Updates do not steal focus or scroll; explicit follow selects latest relevant change |
| R16 | Retain file, line, filters, scroll on collapse/maximize | Host keepMounted; state only partly retained | Session-scoped view state and scroll survive layout changes; no state leakage to another session |
| R17 | Inspect old milestones after later edits | Current working tree only | Durable immutable snapshots and source references; historic diff unchanged after further edits |
| R18 | Review cannot interrupt execution | Read-only Git inspection | No execution-control side effects from view changes; bounded collection and independent UI state |
| R19 | Correct session/workspace data | One environment-configured test repository | Active DSH session resolves its authorized workspace; two sessions/workspaces stay isolated |
| R20 | Actual agent events and task relationships | Not collected | Verified DSH adapter, history replay plus live events, deterministic ordering and deduplication |
| R21 | Actual verification evidence | Illustrative fixture checks; live unavailable message | Command/result/snapshot association; failed/pending/stale/unknown distinct; exit 0 alone not “tests passed” |
| R22 | Rich examples only for testing | Three opt-in scenarios after PR #4 | Never automatically shown as session activity; demo stores/IDs cannot contaminate live data |
| R23 | Cloud test environment independent of laptop | Codespace and CI smoke checks exist | Repeatable deterministic DSH run, screenshots and end-to-end tests entirely in cloud |
| R24 | GitHub sync and architecture notes | Repository/PRs exist; README is stale | Current setup/architecture/limits match released behavior; clean commits and reviewable PR |
| R25 | Claude mod later | Deferred in docs | Host-neutral model, DSH adapter first; no Claude implementation in this work |

## Specific defects established in code

- `plugin/git.js` assigns every live hunk `task: "Unattributed changes"`; `app.js` counts distinct task strings, producing a false “1 tasks”. Unknown attribution is absence of evidence, not an objective.
- `parseDiff` uses the free text after `@@` as part of the story. For prose files this is arbitrary text, not an explanation of the agent's intent.
- Live map groups by the first path segment, which is not a dependency graph.
- `plugin/index.js` resolves all requests through `XRAY_TEST_REPOSITORY`; the sidebar does not pass session context. Repository-wide changes cannot be presented as changes made by the selected session.
- `app.js` rebuilds navigation on filters/refresh; keepMounted alone does not establish scroll/selection retention.
- Four automated tests cover registration, fixture consistency, simple parsing and a temporary repository. They do not establish design quality, session isolation, event provenance, timelines or graph behavior. Prior browser scripts in `work/` are not committed regression coverage.
- README still describes live integration as unimplemented and one authentication fixture. Documentation has drifted.

## Proposed visual contract (implementation decisions, not recovered pixels)

A compact header contains the current objective/session and a subdued activity indicator. Repository/source scope is visible but secondary. Demo selection belongs in a small explicit menu, not the primary live workflow. Use host theme tokens and typography.

At 360–480 px, use one column: compact summary, short view tabs, grouped story rows, then a focused inspector reached by selection with a clear back action. Avoid permanent tree/diff columns squeezed into the sidebar. At 760 px and above, reveal a resizable navigation/inspector split. Maximized layout uses the available height for graph/timeline/code rather than growing form controls. These breakpoints are proposed starting values, verified in DSH before release.

Story rows show outcome, evidence type, change count and verification state. Explorer uses a file tree/group list, with basename on the primary row, subdued directory, and +/− counters. Do not wrap long paths into paragraphs. The detail inspector has filename/range, compact layout and hunk controls, code, and a collapsible “Why this changed” section. Missing evidence is summarized once and actionable; unavailable views explain what data is missing.

Map is a node/edge view with an accessible list equivalent, a legend, zoom-to-selection, and explicit edge provenance. Journey is a chronological timeline of actual requests/actions/checks grouped by milestone, not another file list. Both can navigate to the same inspector.

Design acceptance must include narrow/expanded, light/dark, unknown-context, error/empty, long filenames and 100-file screenshots. Automated checks alone cannot mark R02/R03 complete.

## Data and integration contract

A host-neutral ReviewSnapshot contains workspaceId, sessionId, snapshotId, capturedAt, base revision, observed scope, files, hunks, objectives, events, relationships and verification records. A relationship stores source IDs and a provenance kind: observed, agent-declared, inferred, or demo. Inferred relationships carry their rationale. Unknown relationships remain absent. All counts derive from real entities, not display placeholders.

The DSH adapter resolves a session/workspace from verified host APIs. Never accept an arbitrary filesystem path supplied by the iframe, fall back silently to the lab repository, or scan unrelated user history. Workspace Git changes and session-attributed changes are separate scopes. A session opened after changes were made may lack a baseline; the UI must state that rather than claim authorship.

Capture checkpoints around supported observed edit/command boundaries. Preserve original event IDs, ordering, snapshot identity, and relevant command results. Handle replay, reconnection, branching, concurrent sessions sharing a repository, and missing/truncated history explicitly. Persist only necessary review evidence in plugin-owned storage; do not ingest credentials or claim access to hidden reasoning.

Dependency/symbol analysis begins with JavaScript/TypeScript imports/exports and declarations; unsupported languages retain file-level navigation and explicit capability limits. Directory containment is never labeled an import dependency. Risk and business-purpose classification must identify their heuristic/declared source rather than pose as facts.

## Completion gate

Every R01–R25 row must have a test, screenshot, or explicit approved deferral. Mock coverage cannot close live-integration requirements. Before release, exercise two workspaces, two sessions in one workspace, restart/history replay, later edits to the same hunk, large/odd-path repositories, no credentials, failed/stale checks and opt-in demos. Confirm exact DSH version support. Do not overwrite the user's running installation until the tested release is concrete and its destination is confirmed.
