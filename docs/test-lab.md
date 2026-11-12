# DeepSeek Harness test lab

The lab runs DSH 0.2.0-rc.2 with Agent X-Ray in an isolated DSH home and a disposable Git repository under `.lab/`. Node 24 is used in CI and Codespaces.

```sh
npm ci
npm install --global @deepseek-ai/dsh@0.2.0-rc.2
npm run lab:setup
npm run lab:start
```

Open the authenticated URL printed by DSH. Configure a workspace pointing at `.lab/sample-repo`, open or create a session, and choose Agent X-Ray from the right sidebar. No model key is required to inspect Git changes or opt-in examples. Agent execution requires a model configured through DSH; never place credentials in this repository.

## Sources

- **Session** reads the selected DSH session's recorded requests, actions and edit evidence. It is the default. A session without recorded edits displays an empty state.
- **Workspace** shows current tracked and untracked changes in that session's directory. This includes work outside the selected session and carries no automatic authorship claim.
- **Examples** provides three fictional projects: authentication, checkout and catalog. Each has six hunks and illustrative verification output. They never become live session activity.

The native host controls resizing, split panes, fullscreen and collapse. Narrow layouts drill into the selected change; Back returns to the list. The review retains its selected view, filters, layout and scroll. Follow Agent defaults off; new updates can be adopted explicitly using Catch up.

## Reproducible checks

```sh
npm test
npx playwright install --with-deps chromium
npm run test:browser
XRAY_FIXTURES=1 npm run lab:setup
XRAY_FIXTURES=1 node scripts/smoke-lab.js
```

The fixture flag enables a test-only bundle in this isolated DSH home. It creates two deterministic sessions through DSH's real Session service and appends validated events. Smoke tests check root isolation, recorded edits, authentication and missing-session handling. These are synthetic fixtures, not a model execution, and the fixture bundle is excluded from the shipped package.

Browser checks cover all views and scenarios, filtering, split diffs, narrow drill-down, light/dark captures, live catch-up, response cancellation and keyboard focus. Run them in CI or the cloud lab; there is no need to automate the user's laptop browser.

For a standalone example preview use `node scripts/serve-preview.js`, then localhost port 3091. ES modules require HTTP; opening index.html directly as a file is unsupported.

## Codespaces

The dev container installs dependencies and DSH, prepares the lab and starts the server. Port 3080 stays private. Read `.lab/server.log` for the token and append its query to the forwarded port URL. The startup script trusts the exact Codespaces forwarded hostname. Stop the Codespace when finished; compute and storage count against the account's quota/billing.

The rebuild is tested in a separate checkout and on port 3090, so the previous preview can remain available during review. No model API key is configured in that lab at the time of this rebuild.

## Limits

Workspace previews are bounded to 100 files, 512 KB per source file, 4 MiB of Git output and ten seconds per Git command. Untracked symlinks are not followed outside the workspace. Binary and oversized files have metadata rather than code previews.

Session previews process the latest 10,000 events, up to 1,000 hunks and roughly 4 MB of edit content, with explicit notices when bounded. DSH still supplies the validated source log. The map shows at most 40 nodes and offers a list alternative.

Historical snapshots persist under `$DSH_HOME/agent-xray/history`; no automatic deletion policy is enabled. DSH's own turn comparisons can expire before X-Ray captures them; persisted file-tool excerpts can still be replayed, but do not include original source line offsets. Generic command results remain recorded evidence without an automatic exact-hunk test verdict. See README for supported analysis and provenance.

With an isolated DSH lab already running, `node scripts/native-browser.cjs` verifies the actual native sidebar (session identity, workspace Git, fullscreen/collapse, retained layout, and diagrams). Set `XRAY_LOG=.lab/rebuild-server.log` when testing the separate rebuild server. Run this in the cloud, not on the user's laptop. It uses or creates the disposable review session and captures `test-results/native-sidebar.png`.
