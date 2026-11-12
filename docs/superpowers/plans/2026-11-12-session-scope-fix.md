# Session scope correction

User confirmed that session review must include edits outside the opened folder. Three experts reviewed the DSH contract, path safety, and cache/UI behavior before implementation, then reviewed the code.

1. Reproduce the two discarded-path bugs with outside-folder recorded diffs and host checkpoints.
2. Introduce pure lexical path projection: relative paths within the session cwd/canonical alias; absolute outside paths; retain raw path. No external filesystem reads or scans.
3. Recover previously filtered same-ID snapshots additively without overwriting stored records. Replay selected history only at its saved sequence boundary. Use a versioned checkpoint supplement so old incomplete entries do not shadow live host evidence.
4. Match the verified DSH write/create presentation contract for successful new-file creation. Show distinguishable paths in Story/Journey.
5. Verify bounds, missing/deleted paths, cache immutability, no later-event leakage, separate sessions, native fixture routes and responsive UI. Apply expert review fixes before PR.

Limits: only evidence supplied by DSH can be shown. Arbitrary outside-repository shell writes without host diff metadata cannot be reconstructed. Workspace mode remains the explicit opened-repository Git view. Older history without a recorded sequence boundary is preserved; unavailable external exact checkpoints remain unavailable rather than inferred from current files.
