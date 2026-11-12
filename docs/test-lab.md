# DeepSeek Harness test lab

The lab runs DSH 0.2.0-rc.2 with Agent X-Ray installed as a web plugin. It uses an isolated DSH home and a disposable Git repository under `.lab/`. Model credentials can be entered through DSH's Models page when testing agent execution.

## Run locally or on a Linux cloud machine

Install Node 24 and Git, then run these commands in the checkout.

```sh
npm install --global @deepseek-ai/dsh@0.2.0-rc.2
npm run lab:setup
npm run lab:start
```

Open the tokenized URL printed by DSH. The token authenticates your browser to that lab instance. Choose Configure later to inspect the UI without a model key.

Open the right sidebar, then choose Agent X-Ray from its Start page. The native sidebar can resize, split, or expand to fullscreen. X-Ray follows DSH’s theme and retains its view while hidden. Without a model credential, sending the first message creates a session and reports a missing credential. X-Ray can still inspect the sample Git change. The sidebar reads the configured sample repository for every session, and labels that scope explicitly.

Edit `.lab/sample-repo/greet.js`, then press Refresh Git changes. The initial fixture contains a small input-validation change. Re-running setup preserves existing fixture edits.

To test actual agent editing, configure a model and create a DSH workspace pointing at the absolute path of `.lab/sample-repo`. Run a small task there, then refresh X-Ray. Attribution to agent actions, tasks, business capabilities, and executed tests remains future integration work.

## GitHub Codespaces

The checked-in dev container installs the pinned DSH release and prepares the lab. Open this repository's Code menu, choose Codespaces, and create a Codespace. Starting the Codespace launches DSH in the background. Read `.lab/server.log` for its authenticated startup URL.

Keep port 3080 private. The startup script includes the exact Codespaces forwarded hostname in DSH's trusted hosts. Open the forwarded port and append the `?token=…` query from DSH's startup URL to authenticate. Stop the Codespace after use. Compute and storage count against the account's Codespaces quota and billing settings.

## Checks

`npm test` exercises parsing and a real temporary Git repository.

`node scripts/smoke-lab.js` starts a real DSH process on port 3088, authenticates using its launch token, checks the plugin assets and sample diff, and verifies anonymous and foreign-origin requests are rejected. It shuts the process down afterward.

GitHub Actions runs both checks on Ubuntu for pushes and pull requests.

Manual browser checks verified the plugin is enabled in DSH, the Agent X-Ray panel opens, and real hunks render with module grouping and side-by-side line numbers. Automated browser interaction coverage is pending.

## Current boundaries

The live panel displays tracked text hunks against HEAD, including staged and unstaged edits combined. Untracked files are counted separately. Binary and rename-only changes have no displayed hunks. Git output is limited to 4 MiB and commands time out after ten seconds, with failures shown in the panel.

The architecture map currently groups by top-level directory. The standalone sample retains fictional task relationships. Live mode displays unavailable attribution and verification explicitly.

The plugin requires DSH's Connection authentication service. Git paths come from the configured lab environment, and HTTP callers cannot select arbitrary directories.
