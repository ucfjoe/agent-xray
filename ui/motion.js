// Motion and cross-figure linking for the review UI.
//
// The app redraws by replacing innerHTML on every state change, so entrance
// motion must not be tied to "element appeared" — that would replay on every
// keystroke. Entrance plays only when the motion key (view, snapshot, source)
// changes. Hover linking works on the live DOM and never triggers a redraw.

const ENTER_MS = 900;
let lastKey = null;
let enterTimer = null;

export function prefersReducedMotion() {
  return Boolean(
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
}

// Call after every draw. Returns true when entrance motion was started.
export function playEntrance(root, key) {
  if (key === lastKey) return false;
  lastKey = key;
  if (prefersReducedMotion()) return false;
  clearTimeout(enterTimer);
  root.removeAttribute("data-enter");
  // Force a style flush so re-adding the attribute restarts the animations.
  void root.offsetWidth;
  root.setAttribute("data-enter", "");
  root
    .querySelectorAll(
      ".story-group, .file-group, .timeline-event, .graph-node, .trace-node, .impact-row",
    )
    .forEach((node, i) =>
      node.style.setProperty("--i", String(Math.min(i, 14))),
    );
  enterTimer = setTimeout(() => root.removeAttribute("data-enter"), ENTER_MS);
  return true;
}

function clearLinks(root) {
  root.removeAttribute("data-linking");
  root.removeAttribute("data-graph-focus");
  root
    .querySelectorAll(".is-linked")
    .forEach((node) => node.classList.remove("is-linked"));
}

function linkSelection(root, id) {
  const matches = root.querySelectorAll(`[data-select="${CSS.escape(id)}"]`);
  if (matches.length < 1) return;
  root.setAttribute("data-linking", "");
  matches.forEach((node) => node.classList.add("is-linked"));
}

function linkGraphNode(root, name) {
  const edges = [...root.querySelectorAll(".graph-edge")].filter(
    (edge) => edge.dataset.from === name || edge.dataset.to === name,
  );
  root.setAttribute("data-graph-focus", "");
  edges.forEach((edge) => {
    edge.classList.add("is-linked");
    for (const end of [edge.dataset.from, edge.dataset.to])
      root
        .querySelector(`.graph-node[data-node="${CSS.escape(end)}"]`)
        ?.classList.add("is-linked");
  });
}

// Hovering or focusing any element that names a change highlights every other
// element naming the same change; hovering a map node isolates its edges.
export function installLinking(root) {
  const enter = (event) => {
    const node = event.target.closest?.(".graph-node[data-node]");
    const target = event.target.closest?.("[data-select]");
    if (!node && !target) return;
    clearLinks(root);
    if (node) linkGraphNode(root, node.dataset.node);
    if (target) linkSelection(root, target.dataset.select);
  };
  const leave = (event) => {
    const from = event.target.closest?.(
      "[data-select], .graph-node[data-node]",
    );
    const to = event.relatedTarget?.closest?.(
      "[data-select], .graph-node[data-node]",
    );
    if (from && from !== to) clearLinks(root);
  };
  root.addEventListener("pointerover", enter);
  root.addEventListener("pointerout", leave);
  root.addEventListener("focusin", enter);
  root.addEventListener("focusout", leave);
}
