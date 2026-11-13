import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSessionDependencies as analyze } from "../core/session-dependencies.js";
const snapshot = (files) => ({
  hunks: Object.entries(files).map(([path, content], i) => ({
    id: String(i),
    path,
    sourceId: "e",
    newStart: 1,
    rangeKind: "file",
    lines: content.split("\n").map((l) => "+" + l),
  })),
});
const links = (s) => analyze(s).dependencies.map((d) => d.from + " -> " + d.to);
test("recorded JS and TS relative imports, reexports and extension substitution", () => {
  assert.deepEqual(
    links(
      snapshot({
        "a.js": 'import x from "./b.js";',
        "b.ts": 'export { c } from "./c";',
        "c.ts": "export const c=1;",
      }),
    ),
    ["a.js -> b.ts", "b.ts -> c.ts"],
  );
});
test("Python explicit relative import resolves; absolute package stays unresolved", () => {
  const r = analyze(
    snapshot({
      "pkg/a.py": "from .b import run\nimport thirdparty",
      "pkg/b.py": "def run(): pass",
    }),
  );
  assert.equal(r.dependencies[0].to, "pkg/b.py");
  assert.equal(r.dependencyAnalysis.unresolved.length, 1);
});
test("Go imports use recorded module identity and import blocks", () => {
  const r = links(
    snapshot({
      "go.mod": "module example.org/app",
      "main.go": 'package main\nimport (\n api "example.org/app/api"\n)',
      "api/api.go": "package api",
    }),
  );
  assert.deepEqual(r, ["main.go -> api/api.go"]);
  assert.equal(
    links(
      snapshot({
        "main.go": 'package main\nimport "example.org/app/api"',
        "api/api.go": "package api",
      }),
    ).length,
    0,
  );
});
test("Kotlin uses explicit package declarations and unique names, not filenames", () => {
  assert.deepEqual(
    links(
      snapshot({
        "build.gradle": "plugins {}",
        "a/A.kt": "package app\nimport other.Widget",
        "odd/Foo.kt": "package other\nclass Widget",
      }),
    ),
    ["a/A.kt -> odd/Foo.kt"],
  );
  const r = analyze(
    snapshot({
      "a.kt": "import p.B",
      "b.kt": "package p\nclass B",
      "other.kt": "package p\nclass B",
    }),
  );
  assert.equal(r.dependencies.length, 0);
  assert.match(r.dependencyAnalysis.unresolved[0].reason, /Ambiguous/);
});
test("untrusted excerpts and non-prefix checkpoints are unavailable", () => {
  const s = snapshot({
    "a.ts": 'import x from "./b";',
    "b.ts": "export const x=1;",
  });
  s.hunks[0].rangeKind = "excerpt";
  s.hunks[1].newStart = 20;
  assert.equal(analyze(s).dependencyAnalysis.status, "unavailable");
  assert.equal(links(s).length, 0);
});
test("removed imports, strings, nested comments and truncated syntax never create edges", () => {
  for (const content of [
    "/* outer\n/* inner */\nimport p.B\n*/",
    'val s = """\nimport p.B\n"""',
  ])
    assert.equal(
      links(snapshot({ "a.kt": content, "b.kt": "package p\nclass B" })).length,
      0,
    );
  assert.equal(
    links(
      snapshot({ "a.ts": 'import x from "./b', "b.ts": "export const x=1;" }),
    ).length,
    0,
  );
  const s = snapshot({ "a.py": "from .b import x", "b.py": "x=1" });
  s.hunks[0].lines = ["-from .b import x", "+x=1"];
  assert.equal(links(s).length, 0);
});
test("latest evidence invalidates earlier imports without stitching hunks", () => {
  const s = snapshot({
    "a.ts": 'import x from "./b";',
    "b.ts": "export const x=1;",
  });
  s.events = [
    { id: "e", seq: 1 },
    { id: "later", seq: 2 },
  ];
  s.hunks.push({
    id: "late",
    path: "a.ts",
    sourceId: "later",
    newStart: 30,
    rangeKind: "file",
    lines: ["+x()"],
  });
  assert.equal(links(s).length, 0);
});
test("ambiguous JS paths and cross-folder absolute Kotlin symbols stay unresolved", () => {
  assert.equal(
    links(
      snapshot({
        "a.ts": 'import x from "./b";',
        "b.ts": "export const x=1;",
        "b.js": "export const x=1;",
      }),
    ).length,
    0,
  );
  assert.equal(
    links(
      snapshot({
        "/repo-a/A.kt": "import p.B",
        "/repo-b/B.kt": "package p\nclass B",
      }),
    ).length,
    0,
  );
});
test("Go nested modules are not mistaken for parent module packages", () => {
  assert.equal(
    links(
      snapshot({
        "go.mod": "module a",
        "main.go": 'package main\nimport "a/sub"',
        "sub/go.mod": "module different",
        "sub/x.go": "package sub",
      }),
    ).length,
    0,
  );
});
test("explicit complete recorded sources work but stale sources cannot override newer edits", () => {
  const s = snapshot({
    "a.ts": 'import x from "./b";',
    "b.ts": "export const x=1;",
  });
  s.hunks[0].rangeKind = "excerpt";
  s.events = [{ id: "e", seq: 3 }];
  s.dependencySources = [
    { path: "a.ts", content: 'import x from "./b";', complete: true, seq: 3 },
  ];
  assert.equal(links(s).length, 1);
  s.dependencySources[0].seq = 2;
  assert.equal(links(s).length, 0);
});

test("valid prefix import survives later truncated declaration", () => {
  assert.equal(
    links(
      snapshot({
        "a.ts": 'import x from "./b";\nexport function foo() {',
        "b.ts": "export const x=1;",
      }),
    ).length,
    1,
  );
});
test("explicit hunk sequence overrides action start order", () => {
  const s = snapshot({
    "a.ts": 'import x from "./b";',
    "b.ts": "export const x=1;",
  });
  s.hunks[0].seq = 5;
  s.hunks.push({
    id: "late",
    path: "a.ts",
    seq: 6,
    newStart: 20,
    rangeKind: "file",
    lines: ["+x()"],
  });
  assert.equal(links(s).length, 0);
});

test("workspace Go module cannot resolve imports from an external absolute repository", () => {
  assert.equal(
    links(
      snapshot({
        "go.mod": "module example.org/app",
        "/other/main.go": 'package main\nimport "example.org/app/api"',
        "api/api.go": "package api",
      }),
    ).length,
    0,
  );
});
test("deleted sources cannot produce outgoing dependencies", () => {
  const s = snapshot({
    "a.ts": 'import x from "./b";',
    "b.ts": "export const x=1;",
  });
  s.files = [{ path: "a.ts", kind: "deleted" }];
  assert.equal(links(s).length, 0);
});

test("analysis bounds oversized sources and large import output explicitly", () => {
  const large = snapshot({
    "a.ts": 'import x from "./b";\n'.repeat(2100),
    "b.ts": "export const x=1;",
  });
  const r = analyze(large);
  assert.equal(r.dependencyAnalysis.limited, true);
  assert.ok(r.dependencies.length <= 2000);
  assert.match(r.dependencyAnalysis.summary, /limit reached/);
  const oversized = analyze(snapshot({ "a.py": "#".repeat(512001) }));
  assert.equal(oversized.dependencies.length, 0);
  assert.equal(oversized.dependencyAnalysis.limited, true);
});
