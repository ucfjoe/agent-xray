# Session repository capture acceptance

Independent engineering reviewers inspected discovery, before/after Git capture, the awaited DSH hook, persistence and history projection. Blocking findings were corrected: hidden dirty paths (`assume-unchanged`/`skip-worktree`), trailing-space root identities, nested duplicate observations, partial outer capture dropping child evidence, cancellation losing known roots, serialized/in-memory/in-flight queue bounds, and empty observations crowding history.

103 unit tests passed, including real Git repository/worktree operations and immutable historical sidecars. The full cloud browser suite passed 22 tests. GitHub CI also passed the native integration gate.

Native DSH acceptance uses real agent-preset composition and actual Bash through `tools.execute`, without an LLM/key and without supplied diff metadata. It writes in a separate Git repository and linked worktree outside the opened repository, both containing pre-existing dirty files. The review API returns exactly the two newly observed deltas and excludes unchanged pre-existing edits. The fixtures use supported temporary writable roots; no production permission policy was weakened.

The new inspector caption was reviewed in four cloud screenshots (380/1000px, light/dark). The pre-existing line is neutral diff context, only the new line is green, and the interval/concurrent-attribution limit is visible. Observation events are separate from command action counts. Screenshot fixture uses real Git before/after capture and history projection; native tool-hook verification is a separate smoke test, not a mock UI response assertion.

See ../session-repository-capture.md for remaining limits. In particular this is foreground/tool-return interval evidence; arbitrary dynamic paths, newly discovered roots with no baseline, and background writes after return are not claimed as fully captured. It does not reconstruct old missing baselines. Host checkpoints and observations may overlap; this is recorded evidence volume, not a net authored diff.
