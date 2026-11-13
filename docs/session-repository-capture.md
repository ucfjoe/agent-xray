# Shell changes across repositories and worktrees

Agent X-Ray now observes shell commands through DSH's awaited tool hook. Before execution it discovers Git roots from explicit working directories, file paths and supported literal shell words (`cd`, `git -C`, worktree destinations). Previously discovered roots remain tracked in that active session. No shell expressions are evaluated for discovery.

For each captured root, X-Ray retains the HEAD object and pre-existing dirty/untracked bytes. After the tool returns, it compares against working bytes, including paths committed during the command. Unchanged pre-existing edits are excluded; dirty files changed again show only their new delta. Linked worktrees are distinct identities. Assume-unchanged and skip-worktree paths are included in baselines so hidden old edits cannot be credited to the session.

Observations are immutable sidecars attached to the matching tool-result sequence. Old snapshots cannot see future completions, and viewing history does not scan the current filesystem. The inspector labels these as interval observations: concurrent tools or people may have contributed. Host checkpoints and tool observations can overlap, so totals represent recorded evidence rather than unique net edits.

Limits remain explicit:

- Dynamic shell paths and hidden persistent-shell working directories may be undiscoverable. Existing recorded file-tool diffs remain available.
- A worktree created/discovered only after the command has no pre-command baseline for that first interval; later commands can be observed.
- Background/promoted shell jobs are captured only through tool return, not through later process completion.
- Installing this feature cannot reconstruct pre-tool states for old edits. Discovery state is held for active sessions; recorded observations survive restart.
- Git-ignored files, non-Git directories and unsupported tool paths are not independently scanned.
- Eight roots per session; 100 candidate files per root; 512 KB per file; bounded content, output, concurrent captures and persistence queues. Omitted evidence produces a notice. Symlinks and unsafe/nonregular paths are not followed for source capture.

Capture failures do not change command results. Read operations disable external diff/text conversion and optional Git locks; X-Ray does not stage, commit or modify repository files.
