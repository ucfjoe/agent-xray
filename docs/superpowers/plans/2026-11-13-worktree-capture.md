# Capture session-touched Git repositories and worktrees

Goal: shell edits outside the opened repository appear in session review without treating existing dirt as agent-authored changes.

1. Use DSH's awaited `tools/execute(exec,next)` hook; passive session events cannot guarantee a pre-tool baseline.
2. Discover bounded worktree roots from explicit working directories/file paths and supported literal shell directory selectors. Never execute shell text for discovery. Keep previously discovered roots per session for subsequent commands.
3. Capture immutable HEAD identity plus pre-existing dirty/untracked content. Compare to post-tool working bytes, including paths changed by commits during execution. Preserve worktree root identity; never combine linked worktrees through their common Git directory.
4. Persist bounded read-only observation sidecars at the matching tool-result sequence. Failed/cancelled commands may have edits; instrumentation failures must not change the tool outcome.
5. Merge sidecars only into snapshots whose boundary includes the completion event. Never read current filesystem state while explaining old history. Explicitly label interval evidence without exclusive authorship.
6. Verify independent repositories, linked worktrees, pre-existing changes, committed edits, failures, concurrency, history boundaries, limits and symlink safety. Run independent reviews and a real DSH tool-lifecycle fixture.

Limits: arbitrary dynamically computed paths and hidden persistent-shell directories cannot be discovered perfectly without host filesystem tracing. A newly created/discovered worktree without a pre-state cannot have its first interval retrospectively attributed. Explain unavailable coverage; do not fabricate a baseline. Existing sessions cannot recover erased pre-tool states.
