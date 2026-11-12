import { normalizeSnapshot, fromExample, projectReview } from "./core/model.js";
import { initialState, reduceReview, restoreState } from "./ui/state.js";
import { render } from "./ui/render.js";
import { patchText } from "./ui/diff.js";
const params = new URLSearchParams(location.search),
  sessionId = params.get("session") ?? "";
let source = params.has("live") ? "session" : "demo",
  scenario = params.get("demo") ?? "authentication";
const scenarios = exampleScenarios;
const root = document.getElementById("app");
let snapshot = normalizeSnapshot({ title: "Session review" }),
  state = initialState(),
  error = "",
  pending = null,
  history = [],
  request,
  revision = 0;
const stateKey = () =>
  `xray:v2:${sessionId}:${source}:${source === "demo" ? scenario : ""}`;
function save() {
  try {
    sessionStorage.setItem(stateKey(), JSON.stringify(state));
  } catch {}
}
function draw() {
  const focus = document.activeElement;
  const focusId = focus?.id;
  const caret = focus?.selectionStart;
  const positions =
    state.scroll?.[state.view + ":" + (state.selected ?? "")] ??
    [...root.querySelectorAll(".navigator,.inspector,.code-scroll")].map(
      (n) => [n.className, n.scrollTop, n.scrollLeft],
    );
  root.innerHTML = render(snapshot, state, {
    source,
    scenarios,
    scenario,
    error,
    pending,
    history,
  });
  for (const [cls, top, left] of positions) {
    const node = root.getElementsByClassName(cls)[0];
    if (node) {
      node.scrollTop = top;
      node.scrollLeft = left;
    }
  }
  if (focusId) {
    const node = document.getElementById(focusId);
    node?.focus({ preventScroll: true });
    if (node?.type === "search" && caret !== null)
      node.setSelectionRange(caret, caret);
  }
  save();
}
function dispatch(action) {
  state = reduceReview(state, action);
  draw();
}
function apply(next) {
  snapshot = normalizeSnapshot(next);
  history = next.history ?? history;
  if (!snapshot.hunks.some((h) => h.id === state.selected))
    state.selected = null;
  error = "";
  pending = null;
  draw();
}
async function load({ background = false } = {}) {
  if (source === "demo") {
    apply(
      fromExample(scenarios.find((s) => s.id === scenario) ?? scenarios[0]),
    );
    return;
  }
  if (!sessionId) {
    error = "Open Agent X-Ray from a DSH session to inspect real activity.";
    draw();
    return;
  }
  if (request && background) return;
  request?.abort();
  const controller = new AbortController();
  request = controller;
  const own = ++revision;
  const url = new URL("/agent-xray/review", location.origin);
  url.searchParams.set("session", sessionId);
  url.searchParams.set("scope", source);
  if (state.historyId && !background)
    url.searchParams.set("snapshot", state.historyId);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const data = await res.json();
    if (!res.ok) throw Error(data.error ?? "Review unavailable");
    if (own !== revision) return;
    if (
      background &&
      data.snapshotId !== snapshot.snapshotId &&
      !state.follow
    ) {
      if (pending?.snapshotId === data.snapshotId) return;
      pending = data;
      history = data.history ?? history;
      draw();
      return;
    }
    if (background && data.snapshotId === snapshot.snapshotId) return;
    if (state.follow)
      state = reduceReview(state, { type: "incoming", snapshot: data });
    apply(data);
  } catch (e) {
    if (e.name !== "AbortError" && own === revision) {
      error = e.message;
      draw();
    }
  } finally {
    if (request === controller) request = null;
  }
}
root.addEventListener("click", async (event) => {
  const selected = event.target.closest("[data-select]");
  if (selected) {
    dispatch({ type: "select", id: selected.dataset.select });
    return;
  }
  const view = event.target.closest("[data-view][role=tab]");
  if (view) {
    dispatch({ type: "view", view: view.dataset.view });
    return;
  }
  const layout = event.target.closest("[data-layout]");
  if (layout) {
    dispatch({ patch: { layout: layout.dataset.layout } });
    return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "refresh") {
    await load();
  }
  if (action === "back") dispatch({ patch: { detail: false } });
  if (action === "follow") {
    dispatch({ patch: { follow: !state.follow, historyId: "" } });
    if (state.follow) await load();
  }
  if (action === "catchup") {
    state.historyId = "";
    apply(pending);
  }
  if (action === "fit") {
    root.querySelector(".graph-scroll")?.scrollTo({ left: 0, top: 0 });
  }
  if (action === "next" || action === "previous") {
    const p = projectReview(snapshot, state);
    const at = p.hunks.findIndex((h) => h.id === state.selected);
    const h = p.hunks[at + (action === "next" ? 1 : -1)];
    if (h) dispatch({ type: "select", id: h.id });
  }
  if (action === "copy") {
    const h = snapshot.hunks.find((h) => h.id === state.selected);
    if (h)
      try {
        await navigator.clipboard.writeText(patchText(h));
        document.getElementById("announcement").textContent = "Copied change";
        event.target.textContent = "Copied";
      } catch {
        error = "Clipboard access is unavailable in this browser.";
        draw();
      }
  }
});
root.addEventListener("keydown", (event) => {
  if (
    event.target.matches(".graph-node") &&
    ["Enter", " "].includes(event.key)
  ) {
    event.preventDefault();
    dispatch({ type: "select", id: event.target.dataset.select });
  }
});
root.addEventListener("input", (event) => {
  if (event.target.id === "search")
    dispatch({ patch: { query: event.target.value, detail: false } });
});
root.addEventListener("change", async (event) => {
  const { id, value } = event.target;
  if (id === "source" || id === "scenario") {
    save();
    request?.abort();
    revision++;
    request = null;
    if (id === "source") source = value;
    else scenario = value;
    state = restoreState(sessionStorage, stateKey());
    snapshot = normalizeSnapshot({ title: "Loading review…" });
    pending = null;
    error = "";
    history = [];
    draw();
    await load();
    return;
  }
  if (id === "objective")
    dispatch({ patch: { objectiveId: value, detail: false } });
  if (id === "group") dispatch({ patch: { groupBy: value } });
  if (id === "history") {
    state.historyId = value;
    state.follow = false;
    await load();
  }
});
state = restoreState(sessionStorage, stateKey());
draw();
load();
setInterval(() => {
  if (source !== "demo" && !document.hidden) load({ background: true });
}, 5000);

root.addEventListener(
  "scroll",
  () => {
    state.scroll[state.view + ":" + (state.selected ?? "")] = [
      ...root.querySelectorAll(".navigator,.inspector,.code-scroll"),
    ].map((n) => [n.className, n.scrollTop, n.scrollLeft]);
    save();
  },
  true,
);
