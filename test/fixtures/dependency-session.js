import { readReview } from "../../plugin/review-service.js";
// Recorded checkpoint evidence passes through the real review service, not demo edges.
export async function dependencySession() {
  const sources = [
    ["web/app.js", 'import { value } from "../shared/value.js";\n'],
    ["web/page.ts", 'import { value } from "../shared/value.js";\n'],
    ["shared/value.ts", "export const value = 1;\n"],
    ["python/app/main.py", "from ..shared.value import value\n"],
    ["python/shared/value.py", "value = 1\n"],
    ["go.mod", "module example.org/review\n"],
    [
      "cmd/main.go",
      'package main\nimport "example.org/review/internal/service"\n',
    ],
    ["internal/service/service.go", "package service\n"],
    ["kotlin/build.gradle.kts", "plugins {}\n"],
    ["kotlin/app/Main.kt", "package app\nimport shared.Value\nclass Main\n"],
    ["kotlin/shared/Value.kt", "package shared\nclass Value\n"],
  ];
  const services = {
    sessionQuery: {
      readSession: async () => ({
        session: { id: "languages", cwd: "/nonexistent-xray-evidence" },
        events: [
          { seq: 1, time: 1, type: "workspace/changes", data: { turn: 1 } },
        ],
      }),
    },
    workspaceChanges: {
      summary: () => ({
        total: sources.length,
        files: sources.map(() => ({})),
      }),
      diff: async (_id, _seq, i) => ({
        path: sources[i][0],
        kind: "text",
        hunks: [
          {
            oldStart: 1,
            newStart: 1,
            lines: sources[i][1]
              .trimEnd()
              .split("\n")
              .map((l) => "+" + l),
          },
        ],
      }),
    },
  };
  const store = {
    get: async () => null,
    put: async () => {},
    list: async () => [],
    putCheckpoint: async () => {},
    getCheckpoint: async () => null,
  };
  return readReview({ services, store, sessionId: "languages" });
}
