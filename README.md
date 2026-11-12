# Agent X-Ray

A native DeepSeek Harness sidebar for understanding code changes and their evidence. It separates **Session** (recorded agent activity), **Workspace** (current Git differences, without authorship claims), and opt-in **Examples**.

The sidebar includes a change story, grouped explorer, dependency map, chronological journey, unified/split diffs, hunk navigation and copy, contextual provenance, command evidence, historical snapshots, search and opt-in Follow Agent. Narrow layouts drill into a focused inspector; expanded layouts put navigation beside code. Host theme and docking controls are retained.

## Development

Node >=22.19.0; CI and the cloud lab use Node 24.

```sh
npm ci
npm test
npm run lab:setup
npm run lab:start
```

Install `@deepseek-ai/dsh@0.2.0-rc.2` first. Open the authenticated URL printed by the lab. See [the lab guide](docs/test-lab.md).

For a standalone example preview, run `node scripts/serve-preview.js` and open its localhost port 3091. The preview now uses ES modules and requires an HTTP server; opening `index.html` directly as a file is unsupported.

Browser checks: `npx playwright install --with-deps chromium`, then `npm run test:browser`. No model credentials are required for deterministic fixtures. For the stronger native-host contract test, run `XRAY_FIXTURES=1 npm run lab:setup` followed by `XRAY_FIXTURES=1 node scripts/smoke-lab.js` in an isolated lab.

## Evidence boundaries

- Session scope comes from the native sidebar's session identity and DSH's validated history. It does not read one global test repository for every session.
- File-tool results preserve recorded excerpts. DSH does not provide their original line offsets, so the UI labels them as excerpts and does not invent numbers.
- DSH per-turn comparisons carry exact ranges, but may include concurrent workspace edits. Current workspace changes also do not establish authorship.
- Static import/symbol analysis supports JavaScript/TypeScript. Other languages retain file navigation and explicit diagnostics. Only inspected changed sources contribute dependency edges.
- Business/risk suggestions are labeled path-based heuristics. They are not agent declarations.
- Generic command output is recorded execution evidence. It is not automatically treated as a passed test for an exact hunk. Examples' verification results are fictional.
- The historical cache begins when this plugin observes or reads a session. Expired host-only turn comparisons cannot be reconstructed if they were never cached; persisted file-tool excerpts remain available.

See [architecture](docs/architecture.md), [acceptance results](docs/acceptance-results.md), and the [recovery requirements](docs/superpowers/specs/2026-11-12-agent-xray-recovery.md). Claude mod integration remains deferred.
