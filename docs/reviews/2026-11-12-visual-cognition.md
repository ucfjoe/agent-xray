# Whole-product visual cognition review

Scope: all four views, source modes, evidence meanings, hierarchy/density, diagrams, path identity, navigation, scrolling, light/dark themes, narrow/expanded layouts and keyboard accessibility. An independent visual cognition agent inspected source and existing screenshots. Follow-up captures cover Story, Changes, Map and Journey at 380/900/1440 pixels in light and dark themes, plus multi-folder fixtures. Screenshots alone do not prove screen-reader behavior or usability with real users.

## Immediate improvements in the session-scope fix

- Distinguishing directory suffixes replace long shared absolute prefixes in row labels and the footprint chart. Full paths remain available on hover and in the inspector.
- Long Journey links wrap rather than widening the sidebar.
- An understated overview line distinguishes recorded session evidence across folders from opened-repository Git changes and exposes the shell-evidence limitation.

## Remaining priorities across the product

| Priority | Finding | Recommended next change | Acceptance check |
|---|---|---|---|
| High | Journey search filters linked chips but retains unrelated events. | Filter events to matching linked changes during file search, or explicitly label the different search scope. | Searching a unique filename produces a comprehensible event list. |
| High | Action in the evidence trail opens Journey without locating the corresponding event. Missing intent remains clickable. | Highlight/scroll to the associated event; disable or explain unavailable evidence targets. | An older change's action is immediately discoverable in a long timeline. |
| Medium | Narrow evidence trail uses a serpentine 1,2,4,3 visual arrangement. | Prefer a row-major or compact vertical progression with matching keyboard order. | Readers understand stage order without tracing arrows. |
| Medium | Four evidence cards dominate tiny diffs. | Reduce absent-stage density while keeping unknown states explicit. | Filename, coverage boundary and start of diff need less scrolling at 380px. |
| Medium | Map edges and multi-change nodes need clearer meaning. | Explain arrow direction and make multiple changes discoverable; retain exact vs inferred distinctions. | A node with two changes exposes both; no-edge and cyclic maps stay understandable. |
| Medium | Map labels may truncate away distinguishing context. | Apply unique display labels and expose full names. | Similar long module names remain distinguishable. |
| Medium | Tab roles do not provide the full expected keyboard pattern. | Add roving focus, arrow keys and associated panels, or use ordinary selected buttons. | Keyboard-only switching and content focus follow a consistent pattern. |
| Lower | Some secondary text is 8–10px. | Increase decision-relevant context to 10–11px selectively. | Paths, unknown verification and scope text are legible at normal scale and zoom. |
| Lower | Variable overview heights interact with nested fixed-height scrolling. | Validate long goals, resize, selection changes and restored scroll positions. | No inaccessible final rows or unexpected scroll jumps. |

## What already works

The restrained IDE theme, selected-row tint, unified/split controls, sidebar drill-down, explicit fictional examples, fail-closed live verification, textual addition/deletion signs, graph list alternative and distinct review perspectives are useful foundations. Preserve these while improving clarity incrementally.

## Evidence and remaining validation gaps

The original screenshots covered only a subset of views. The expanded automated capture matrix checks horizontal containment across all four views and themes. Further interaction/assistive-technology validation is still needed for 200% zoom, keyboard tabs, error/empty states, dense cyclic graphs and long-goal scrolling. A screenshot pass is not a claim that every usability recommendation has been implemented.

## Fresh-capture follow-up

The visual cognition agent inspected all 27 captures (24 view/theme/width combinations plus three multi-folder captures). Cross-folder labels, visible coverage explanation and responsive layout passed. The review identified unreadably scaled Map captions at 900px; the fix now selects compact layout using the map pane's available width, with a browser assertion for the resulting layout. A fresh capture verifies this separately.

Remaining visual observations: compact graph arcs can overlap; multiple hunks in the same file need clearer row labels; example Journey titles embed timestamps that disagree with event times; footprint captions can shrink in medium-width layouts. These are documented follow-up work, not claimed fixed by the session-scope patch.

## Blocking arrow-routing correction

The initial review flagged overlapping arcs, but that finding was wrongly deferred. It is a diagram correctness issue, and the prior map image was not acceptable. The user rejected it before merge.

The graph now uses topological ordering, distinct ports, orthogonal outside-card rails in compact mode, and column gutters/outer lanes in expanded mode. Selected-node relationships and arrowheads receive matching emphasis. The legend explicitly defines arrow direction. Geometry regressions cover the diamond, reversed edges, cycles, self loops, bounds and zero diamond crossings; an independent agent additionally checked 4,000 randomized layouts for card intersections and canvas bounds.

The visual cognition expert re-inspected six fresh Map captures (light/dark at 380/900/1440). Verdict: **PASS for the pictured four-node graph**, with all relationships independently traceable, no hidden segments or crossings, distinct arrowheads, readable labels, and correct selected-edge emphasis. This is not a claim that arbitrary dense graphs have been visually validated. The screenshots in this PR replace the rejected map image.

Release rule: material visual findings block visual sign-off until fixed, captured again, and rechecked. Automated code/geometry tests do not substitute for that gate.
