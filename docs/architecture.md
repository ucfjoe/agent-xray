# Agent X-Ray architecture

## Review experience

The default side panel starts with Change Story, a short sequence of outcomes whose entries open the exact diff. Split gives the reviewer more space alongside the host conversation. Max expands the inspection workspace. All three share selection and filters. The host conversation area in this demo is a placeholder.

Mission Control, Change Explorer, Architecture Map, and Journey share a selected hunk ID. Selecting an objective scopes the inspection to its changes. Selecting a module, story entry, or journey event navigates to its associated change. In a live integration, new events should preserve the current inspection unless the reviewer enables Follow Agent. Reviewing historical changes must be independent of agent execution.

## Change model

Store each hunk once with its path, old and new ranges, diff lines, and stable identity within a change snapshot. A single file can have hunks tied to different objectives. Objective, business capability, architecture module, risk, and conversation milestone are views over hunk relationships.

Store relationship evidence separately from the diff. Identify user requests, agent-declared objectives, and inferred relationships. Give each inference a rationale and a source reference. Verification records should reference an observed command execution, its result, and the snapshot it ran against. Pending verification should remain visible.

## Proposed DeepSeek Harness integration

1. Validate the host's panel and maximized-view APIs, session event hooks, available identifiers, and permissions against a supported DSH version.
2. Capture permitted session events and Git snapshots through a host adapter. Track ordering and deduplicate event replay. Preserve snapshot identity so changes can still be inspected after later edits.
3. Parse Git diffs into hunks and connect requests, agent actions, modules, and verification evidence. Preserve uncertain or missing attribution.
4. Feed a read-only review model to the panel. Keep workspace selection and filters local to the UI.

The browser demo implements the review model with static sample data. Host API compatibility, live event capture, and dependency discovery remain open.
