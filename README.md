# Agent X-Ray

A browser prototype for reviewing what a coding agent changed, why it changed, and how it was verified.

DeepSeek Harness is the current integration target. Support as a Claude mod plugin is planned for a later phase. The current deliverable is a standalone browser demo, with live DeepSeek Harness integration still to implement.

Open `index.html` in a browser. There are no dependencies or build steps. Select a task, architecture module, journey step, or Change Story entry to inspect the associated diff. Use **Group by** to browse the same changes by objective, business capability, module, risk, or milestone.

The prototype was reconstructed from the Agent X-Ray design discussion. It uses a fictional authentication session, including illustrative verification records. See [architecture and design decisions](docs/architecture.md).
