# Session dependency map

Session maps derive static import links from recorded evidence at the selected review boundary. They do not scan the current filesystem to explain historical changes. File endpoints are projected onto displayed directory groups; an edge's tooltip retains the original file names. Imports within a group appear as a loop.

| Language | Resolved recorded evidence | Left unresolved |
| --- | --- | --- |
| JavaScript / TypeScript | Static relative imports, reexports and import-equals; recorded file candidates including JS-to-TS extension substitution | Build aliases, package exports, ambiguous candidates, dynamic/CommonJS calls |
| Python | Explicit relative module imports to recorded files | Absolute imports requiring a source root, dynamic imports, unsupported header syntax |
| Go | Package imports within a recorded `go.mod` module | Unrecorded module identity, replacement/workspace mappings, external modules |
| Kotlin | Explicit imports matched to recorded package and declaration names within the same recorded build module or directory | Wildcards, unknown module boundaries, ambiguous declarations |

Analysis uses a known file prefix beginning at line 1, not arbitrary edit snippets. A later edit without a safe prefix invalidates earlier analysis for that file. Removed diff lines are not treated as current imports. Saved snapshots are not rewritten. Missing evidence may therefore still produce an unconnected map; its coverage notice explains why, and unresolved imports are available separately.

These are partial recorded import relationships, not complete compiler resolution or proof of runtime calls. Go package targets represent recorded package files, without claiming build inclusion. Comment/string handling, chronology, module boundaries, bounds, all five language paths, history immutability and grouped edges have automated checks. Browser fixtures use the actual host-checkpoint-to-review path rather than hand-authored edges.
