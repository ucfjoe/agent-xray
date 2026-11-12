# Evidence and History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make evidence claims consistent and preserve host-provided historical ranges safely.
**Architecture:** Add a shared conservative evidence projection, preserve immutable aggregate snapshots, and retain checkpoint supplements by session/event sequence. Serve saved history after validating host identity without requiring its former directory.
**Tech Stack:** Existing JavaScript/Node, DSH 0.2.0-rc.2, node:test and Playwright. No new dependencies.
**Spec:** docs/superpowers/specs/2026-11-12-evidence-history.md (evidence and history only; dependency/language changes deferred).

## Global Constraints
- Preserve IDs, cache paths, read-only operation, saved selections and explicit examples.
- No test success inferred from free text, isError:false, or matching review IDs.
- No increased output/environment capture, workspace copying or automatic deletion.
- Existing 100-file/1,000-hunk/~4MB preview bounds remain.
- User approved implementation and expert review; do not pause between tasks. Merge/deployment remain separate.

## Review Focus
- Forged/legacy success labels must remain unknown for live data (Task 1).
- Command/edit shared events must agree in diagram and inspector (Task 1).
- Rapid checkpoints and disposal must not collapse into the latest event (Task 2).
- Corrupt/unwritable stores and overload must report failure without blocking DSH (Task 2).
- Deleted workspaces must not prevent authorized cached reads or permit cross-session reads (Task 3).

### Task 1: Conservative evidence projection
Files: core/verification.js (new), ui/render.js, ui/figures.js, plugin/dsh-adapter.js, plugin/index.js; test/verification.test.js.
Interface: projectCheck(snapshot, check, hunk?) returns display status, testOutcome, toolOutcome, binding and association; checksForHunk(snapshot,hunk) returns consistently selected projected evidence.
- [x] Add failing tests for legacy/forged passing results, shared-event context and demo separation.
- [x] Implement projection; live results always testOutcome unknown, binding contextual or unlinked; new adapter records explicit review identity and unknown test metadata.
- [x] Use same helper in figures, inspector and command list; add browser-served asset.
- [x] Run unit tests, commit.

### Task 2: Event-bounded checkpoint preservation
Files: plugin/capture-queue.js (new), plugin/history-store.js, plugin/dsh-adapter.js, plugin/index.js; test/capture.test.js.
Interfaces: createCaptureQueue({capture,onError,maxPending=32}) returns enqueue(sessionId,seq,type), dispose(), idle(); sequential global work bounds memory, preserves sequence per enqueue, suppresses duplicates. Capture uses readSessionReview throughSeq and abort signal. Store putCheckpoint(sessionId,seq,value)/getCheckpoint persist optional supplements separately; supplement includes only that checkpoint's exact hunks/files/event, not extra raw content.
- [x] Test rapid events with distinct ranges, bounded queue errors, disposal and write errors.
- [x] Replace collapsing debounce with bounded queue; retain event sequence and capture failures as bounded per-session notices.
- [x] Persist exact checkpoint supplements immutably; adapter uses saved checkpoint when host comparison expires. Keep old aggregates unchanged.
- [x] Test fresh store reload, cross-session isolation and unavailable comparisons; run suite, commit.

### Task 3: Independent saved-history reads and integration
Files: plugin/index.js, plugin/review-service.js (new); test/review-service.test.js; docs/acceptance-results.md.
Interface: readReview({services,store,sessionId,snapshotId,scope}) validates host session identity; requested historical snapshots use only saved data and optional checkpoint supplements, no realpath/current workspace replay. Current and workspace routes preserve prior behavior.
- [x] Test saved reads after directory removal and denied/mismatched sessions; missing snapshot remains 404.
- [x] Implement read service and stable supplemental enrichment without rewriting saved aggregate.
- [ ] Run unit, cloud browser, native host, package import and CI checks; capture contextual-evidence screenshot.
- [ ] Independent expert reviews of evidence and history; fix material findings with regression tests. Open reviewable PR; no merge or installation.
