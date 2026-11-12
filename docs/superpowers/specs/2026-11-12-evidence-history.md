# Agent X-Ray: expert review and staged improvement proposal

Reviewed 2026-11-12 after PR #5 merged. Three independent agents examined history capture, verification evidence, and dependency analysis. This is a proposal; no product code or running installation changed. Existing 23 unit/integration tests pass locally.

## Decision

Improve evidence correctness first. Preserve existing history IDs, saved selections, the read-only DSH integration, and opt-in example separation. Do not expand automatic file/output capture or replace the parser in this release.

## First proposed PR: trustworthy evidence semantics

A review ID currently identifies a session-history cursor, not the code a test executed. Current DSH command results do not supply an authoritative structured test result. Make that distinction explicit without introducing a new test runner.

1. Add optional identity metadata stating that the existing ID identifies a review. Keep IDs and cache paths unchanged; legacy records remain readable with unknown identity completeness.
2. Add a conservative evidence projection separating tool outcome, test outcome and relationship to code. Current live commands remain test-outcome unknown and unlinked to tested content. A shared event is contextual only. Preserve stored legacy fields; do not rewrite historical records.
3. Use the same evidence-selection/projection function in the inspector and evidence diagram. A command that also edits a file must not receive different meanings in the two views. Observed command context may be displayed, but must not appear as test coverage.
4. Invalid metadata, free-text claims of success, and exit-code-like output cannot produce a test-passed badge. Existing demonstration results stay explicitly fictional and separate from live evidence.
5. Capture no additional file contents, command output, environment variables or arbitrary reports. Make no new runtime dependencies necessary.

Acceptance: old histories and UI selection still load; later edits cannot bind earlier commands to new code; shared command/edit events are consistent across views; forged success output and malformed metadata remain unknown; concurrent sessions and bounded previews cannot claim exact-content association. Run existing unit, browser, native DSH, package-install and CI checks. Add screenshots of contextual/unknown evidence, not only successful examples. Obtain independent review before proposing merge. No deployment as part of this change.

## Subsequent separate PRs

### Historical capture reliability

Preserve DSH's already-available exact turn comparisons by event sequence using bounded background capture. Keep supplemental checkpoint evidence separate from immutable aggregate snapshots. Report capture failures. Permit authenticated, host-session-validated reads of saved history without requiring the old workspace directory to exist. Cover rapid checkpoints, host disposal, concurrent readers/writers, plugin shutdown and disk failures. Retain excerpts when original ranges are unavailable; never locate old edits by guessing against today's files.

### Dependency graph precision

Separate observed import declarations from resolved targets. Missing local sources, packages and aliases must not all become confirmed external dependencies. Keep existing from/to fields with optional resolution metadata and legacy fallbacks; distinguish unresolved graph nodes and their reasons. Test supported extension/index resolution, re-exports, comments, malformed files, duplicate specifiers from different directories and narrow/expanded graph navigation. Analysis remains bounded and source-version explicit.

### Additional languages and verified test runner

Select the next language from actual project needs; add one pure parser adapter at a time. Do not execute project code merely to draw a diagram. Evaluate parser packaging, resource limits and licensing before adding dependencies.

A future opt-in test runner needs an isolated/frozen input set and structured outcomes, plus declared environment and dependency scope. A before/after hash of bounded previews is insufficient: concurrent changes can be reverted during a run. Coverage, when available, identifies exercised lines; it does not prove semantic correctness. Design this separately from passive command observation.

## Expert findings behind the decision

- History: plugin/dsh-adapter.js hashes session ID and final sequence. The event listener debounces and reads the latest history rather than binding capture to the triggering sequence. Saved-history requests reconstruct current data first, requiring a valid cwd.
- Verification: existing command snapshotId is the replay review ID. isError describes tool failure, not authoritative test success. Inspector allows shared-event evidence while the diagram only checks hunk links.
- Languages: core/dependencies.js conflates unresolved imports with external targets, resolves only supplied changed sources, and omits some accepted extension candidates. Historical session graphs must not silently analyze current files.

## Release safeguards

Small independent PRs, regression tests before fixes, unchanged legacy identifiers, conservative unknown defaults, bounded read-only work, cloud browser verification, and explicit approval before merge/deployment. No claim of complete model-driven verification until the cloud lab has credentials for an actual coding run. No promise of recovering never-captured historical ranges.
