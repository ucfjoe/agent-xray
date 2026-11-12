# Recovery acceptance results

## Verified implementation

- Native DSH 0.2.0-rc.2 session propagation, current workspace Git, fullscreen/collapse and retained diff layout: verified by cloud browser against the running harness. A native test exposed and corrected an initial component-prop binding mistake that a mock had missed.
- Unit/integration suite: 23 passing tests covering model provenance, independent sessions, malformed/duplicate events, immutable concurrent history writes, unusual Git paths, binary/new/deleted files, outside symlinks, 100-file limits, split alignment and no-final-newline patch fidelity.
- Browser suite covers all three example scenarios and four views, all grouping perspectives, filtering, narrow layout, light/dark captures, stale-response cancellation, catch-up/follow, keyboard focus, selected lines and 100-file search. Interactive diagrams have dedicated navigation checks.
- Actual DSH fixture contract: two sessions created through the native Session service resolve different roots and recorded edits. Invalid sessions cannot fall back to the lab repository. Authentication checks pass.
- The packed 0.2.0 plugin installs and imports with production dependencies; fixture helpers and lab data are excluded.
- Independent whole-branch review found six important defects. Literal pathspecs, exclusive history publication, replay deduplication, malformed metadata, newline fidelity and keyboard focus were corrected and covered by regressions.

## Requirement coverage

| Requirements | Delivered behavior / evidence |
|---|---|
| R01–R03 | Native retained sidebar; narrow drill-down, expanded inspector; theme inheritance; 100-file search; impact bar figure. Native lifecycle and browser checks. |
| R04–R05 | Declared user requests, recorded-action counts, grouped narrative Story; unknown context is explicit. No invented progress or intent. |
| R06–R08 | Five relationship perspectives over shared hunks; declared/observed/inferred/demo provenance; intent → action → code → verification diagram with source-aware unknown states. |
| R09–R10 | Search, collapsible file groups, +/− counts, metadata-only files, exact/excerpt distinction, aligned split/unified diffs, navigation, selected lines and patch copy. |
| R11–R12 | Layered selectable dependency graph, symbol containment, zoom/fit, legend and accessible list; current JS/TS static imports/symbols. Unsupported languages and incomplete dependency scope are disclosed. |
| R13–R14 | Chronological request/action/checkpoint timeline; synchronized selection across figures, Story, Changes, Map, Journey and inspector. |
| R15–R18 | Follow defaults off, explicit catch-up, session/source-scoped UI state, immutable cached history, read-only inspection. History storage starts at observation; it cannot recover never-captured host snapshots. |
| R19–R20 | DSH session identity and validated history; host-owned root resolution; distinct workspace versus session scope. Native fixture and browser checks. |
| R21 | Real session command output is visible. It is deliberately not converted into “this hunk passed tests” without a reliable tested-snapshot link. Exact-hunk automatic verification remains source-limited. |
| R22–R24 | Explicit examples; cloud tests, screenshots, distributable package and updated documentation; reviewable GitHub branch. |
| R25 | Claude mod integration remains deferred, as requested. |

## Figures

- **Change footprint:** clickable added/removed line bars, derived from the currently filtered changes.
- **Evidence trail:** intent → action → code → verification diagram. Unknown links are dashed and labeled; fictional evidence stays marked.
- **Architecture map:** directed dependency edges and distinct dashed symbol-containment edges, zoom/fit, exact-change navigation and list alternative.
- **Journey:** chronological event timeline with visually distinct requests, action status and links to changes.

## Honest release limits

No model API key is configured in the cloud lab, so a credentialed end-to-end model coding run has not been performed. Native host fixtures verify the integration but are not advertised as a real model's work. Generic commands do not establish exact-hunk test coverage; results remain recorded/unlinked. Historical file-tool excerpts lack original line offsets. Static dependency analysis is JS/TS-only and limited to inspected changed sources. Large previews have explicit bounds. These limits must remain visible rather than being concealed with demonstration data.

## Implementation decisions

The existing task checkout was reused on a new feature branch. DSH's recorded file edits and per-turn comparisons were preferred over guessed authorship from Git timing. Visuals were built and inspected through the real UI, not represented by fabricated screenshots. Historical excerpts use an explicit non-numbered mode; command evidence uses conservative unknown attribution. Session previews and graphs are bounded with notices, and historical metadata is indexed separately to avoid reloading all code on each poll. Browser automation runs only in the cloud. A testable package and draft PR are delivered before replacing a user's running installation.
