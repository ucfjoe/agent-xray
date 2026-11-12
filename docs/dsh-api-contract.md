# Verified DSH API contract

Inspected installed `@deepseek-ai/dsh` version 0.2.0-rc.2, matching the lab pin. Source references below are package-relative under its `node_modules/@deepseek-ai/`.

- `dsh-client-ui-slots/lib/types/index.d.ts`: session-scoped registered panel components receive `sessionId` as a standard prop. The outer `slots.inject` callback does not receive a session ID; a registration's separate `inject` option has session-aware factory arguments. Read the component prop; do not scrape the URL or choose a global active session.
- `dsh-session-query/lib/types/index.d.ts`: `sessionQuery.readSession(id)` returns `{session, events, inheritedEventCount}` with cloned validated history. It does not make a stored session live.
- `dsh-session/lib/types/types.d.ts`: `session.id`, `session.cwd`, events `{seq,time,type,data}`; user/message, tool/call, tool/result, turn/start, turn/end. Use only observed user-facing content, never assistant hidden reasoning.
- `dsh-session/lib/types/index.d.ts`: `ctx.on('session/event', (session,event) => ...)` observes appended events; seed events do not emit, so always replay history. Listener must not block agent execution.
- `dsh-workspace-changes/lib/types/types.d.ts`: `workspaceChanges.summary(id,seq)` and `diff(id,seq,index,signal)` return observed turn-start/end comparisons for `workspace/changes` events. Cache them before session disposal; they are not durable in this service.
- `dsh-tool-fs/lib/types/diff.d.ts`: persisted file-tool result `meta.diffs` has `{path,oldText,newText}`. These contextual fragments lack original line offsets; display as recorded excerpts, not invented line 1 hunks.
- Authentication: existing `connection.admit(req)` protects routes. Session lookup is host-owned, filesystem roots come only from validated session headers. DSH is the trusted local single-user host; no new multi-user authorization model is implied.

Read-only polling is used for the UI; host event notifications trigger bounded cache capture. Unknown service/version capability produces a visible unsupported state, never fixture data. Cloud contract validation is still required before marking this task complete.
