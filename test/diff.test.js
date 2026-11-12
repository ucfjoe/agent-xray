import test from "node:test";
import assert from "node:assert/strict";
import { alignedRows, patchText, renderDiff } from "../ui/diff.js";
test("split aligns replacements and preserves independent line numbers", () => {
  const h = {
    path: "a",
    oldStart: 10,
    newStart: 10,
    lines: [" context", "-old", "+new", "+extra", " tail"],
  };
  const r = alignedRows(h);
  assert.equal(r[1][0].old, 11);
  assert.equal(r[1][1].next, 11);
  assert.equal(r[2][0], undefined);
  assert.equal(r[3][0].old, 12);
  assert.equal(r[3][1].next, 13);
  assert.match(patchText(h), /@@ -10,3 \+10,4 @@/);
});
test("untrusted code is escaped and excerpt numbers are not fabricated", () => {
  const html = renderDiff(
    { rangeKind: "excerpt", lines: ["+<script>"], newStart: 1 },
    "unified",
  );
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /·/);
});
import { parseDiff } from "../plugin/git.js";
test("copy patch retains no-final-newline semantics and quotes unusual names", () => {
  const raw =
    "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n";
  const parsed = parseDiff(raw)[0];
  const patch = patchText({
    ...parsed,
    path: "tab\tname.js",
    oldStart: 1,
    newStart: 1,
  });
  assert.equal(patch.split("\\ No newline at end of file").length - 1, 2);
  assert.match(patch, /@@ -1,1 \+1,1 @@/);
  assert.ok(patch.includes('"a/tab\\tname.js"'));
});
