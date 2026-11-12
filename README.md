# Agent X-Ray

A browser prototype for reviewing what a coding agent changed, why it changed, and how it was verified.

DeepSeek Harness is the current integration target. Support as a Claude mod plugin is planned for a later phase. The current deliverable is a standalone browser demo, with live DeepSeek Harness integration still to implement.

Open `index.html` in a browser. There are no dependencies or build steps. Select a task, architecture module, journey step, or Change Story entry to inspect the associated diff. Use **Group by** to browse the same changes by objective, business capability, module, risk, or milestone.

The prototype was reconstructed from the Agent X-Ray design discussion. It uses a fictional authentication session, including illustrative verification records. See [architecture and design decisions](docs/architecture.md).

## DeepSeek Harness test lab

Agent X-Ray now includes a DSH web plugin and a repeatable test lab. Open Agent X-Ray from the right sidebar’s Start page to inspect real tracked Git changes in the configured sample repository. The standalone demo above remains available.

See [test lab setup and current boundaries](docs/test-lab.md). GitHub Codespaces configuration and an Ubuntu GitHub Actions smoke test are included. Live task attribution and test-execution evidence remain to implement.
