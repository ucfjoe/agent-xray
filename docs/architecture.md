# Agent X-Ray architecture

## Host boundary

`plugin/client.js` registers a retained native right-sidebar body. Its session-scoped factory supplies the exact session ID to the iframe. DSH owns docking, resizing and fullscreen. Theme tokens and font settings are mirrored from the host.

Authenticated routes in `plugin/index.js` serve an explicit asset allowlist and `/agent-xray/review`. Session/workspace roots come from `sessionQuery.readSession`, never from browser-supplied filesystem paths. `/agent-xray/changes` is a legacy explicit-lab smoke endpoint; normal panels do not use it.

`plugin/dsh-adapter.js` projects validated DSH user messages, tool calls/results and per-turn changes into the review model. It never reads hidden reasoning. File-tool excerpts and exact turn comparisons have distinct range semantics. The same hunk can carry task, capability, module, risk and milestone relationships without duplication by perspective.

## Model and storage

`core/model.js` normalizes snapshots and computes scoped groups/counts. `core/evidence.js` supplies labeled path heuristics. `core/dependencies.js` uses the TypeScript parser for static imports/exports and declaration locations. Dynamic imports, unsupported languages and unchanged dependencies are not a complete architecture analysis.

`plugin/workspace.js` reads bounded Git changes from the resolved workspace, including untracked files and metadata for binary/oversized files. It uses literal pathspecs, avoids following untracked symlinks outside the workspace, and preserves no-final-newline information.

`plugin/history-store.js` stores immutable snapshots under `$DSH_HOME/agent-xray/history`, defaulting to `~/.dsh/agent-xray/history`. Session IDs are hashed for paths. A temporary file plus atomic exclusive link prevents simultaneous writers replacing a published snapshot. Files are private to the host user. Snapshot records are plugin-created evidence; they are not a replacement for DSH's authoritative session log.

## Review UI

`ui/state.js` separates inspection state from execution. Session/source-specific storage retains view, selection, filters, diff layout and scroll. Follow Agent starts off. Polling announces new activity while the reader's current snapshot remains stable; Catch up explicitly adopts it.

`ui/render.js` presents distinct Story, Changes, Map and Journey surfaces using the same hunk identity. `ui/diff.js` aligns old/new rows, preserves patch semantics and escapes displayed code. Unknown attribution counts as zero objectives. Unlinked commands remain session evidence rather than becoming a green check on an unrelated diff.

Examples pass through the same model with explicit demo provenance and never become ordinary session activity. The runtime remains DSH-specific only at the adapter boundary; a future Claude adapter is outside this release.

## Support boundaries

Supported host contract: DSH 0.2.0-rc.2. Workspace preview: first 100 files, 512 KB source preview per file, 4 MiB Git command output, 10-second Git command timeout. Map rendering: first 40 nodes with a list alternative. Historical retention consumes local disk; there is no automatic deletion policy in this version. Generic commands lack a reliably established tested-snapshot relation, so exact test attribution stays unknown unless supplied by evidence.
