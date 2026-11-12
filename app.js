const params = new URLSearchParams(location.search);
const live = params.has("live");
const initialExample = exampleScenarios.find((scenario) => scenario.id === params.get("demo")) ?? exampleScenarios[0];
let changes = [];
let currentScenario;
let pendingRequest;

const fields = { task: "Implementation task", capability: "Business capability", module: "Architecture module", risk: "Review priority", milestone: "Conversation milestone" };
const state = { task: "", view: "story", group: "task", selected: changes[0]?.id };
const byId = (id) => document.getElementById(id);
const tasks = byId("task");
const source = byId("source");
const scenarios = byId("scenario");
const status = byId("source-status");
const refresh = document.createElement("button");
refresh.textContent = "Refresh Git changes";
refresh.hidden = true;
byId("panel").querySelector("header").append(refresh);
for (const scenario of exampleScenarios) scenarios.add(new Option(scenario.title, scenario.id));
scenarios.value = initialExample.id;
source.value = live && !params.has("demo") ? "live" : "examples";
if (!live) source.querySelector('[value="live"]').disabled = true;

function visibleChanges() {
  return changes.filter((change) => !state.task || change.task === state.task);
}

function replaceChanges(nextChanges) {
  changes = nextChanges;
  if (!changes.some((change) => change.task === state.task)) state.task = "";
  const entries = visibleChanges();
  if (!entries.some((change) => change.id === state.selected)) state.selected = entries[0]?.id;
  tasks.replaceChildren(new Option("All objectives", ""));
  for (const task of new Set(changes.map((change) => change.task))) tasks.add(new Option(task, task));
  tasks.value = state.task;
  tasks.disabled = !changes.length;
  renderNavigation();
  renderDetail();
}

function list(label, entries, title) {
  const section = document.createElement("section");
  const heading = document.createElement("h2");
  heading.textContent = label;
  section.append(heading);
  const items = document.createElement("ul");
  for (const change of entries) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const text = document.createElement("span");
    text.textContent = title(change);
    button.append(text);
    if (change.check) {
      const check = document.createElement("small");
      check.className = "check-state";
      check.dataset.status = change.check.status.toLowerCase();
      check.textContent = change.check.status;
      button.append(check);
    }
    button.dataset.hunk = change.id;
    button.setAttribute("aria-pressed", change.id === state.selected);
    item.append(button);
    items.append(item);
  }
  section.append(items);
  return section;
}

function grouped(entries, field, title) {
  const groups = new Map();
  for (const change of entries) {
    const key = change[field];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(change);
  }
  return Array.from(groups, ([name, members]) => list(name, members, title));
}

function renderNavigation() {
  const entries = visibleChanges();
  byId("scope-summary").textContent = [
    entries.length + " hunks",
    new Set(entries.map((change) => change.path)).size + " files",
    new Set(entries.map((change) => change.task)).size + " tasks",
  ].join(" · ");
  const navigation = byId("navigation");
  navigation.replaceChildren();
  switch (state.view) {
    case "changes": {
      const label = document.createElement("label");
      label.textContent = "Group by ";
      const select = document.createElement("select");
      for (const [key, name] of Object.entries(fields)) select.add(new Option(name, key));
      select.value = state.group;
      select.addEventListener("change", () => {
        state.group = select.value;
        renderNavigation();
        navigation.querySelector("select").focus();
      });
      label.append(select);
      navigation.append(label, ...grouped(entries, state.group, (change) => `${change.path} · line ${change.newLine}`));
      break;
    }
    case "map": {
      for (const moduleName of new Set(entries.map((change) => change.module))) {
        const members = entries.filter((change) => change.module === moduleName);
        const section = list(moduleName, members, (change) => change.story);
        const module = currentScenario?.modules.find((entry) => entry.name === moduleName);
        if (module) {
          const connections = document.createElement("p");
          connections.className = "module-connections";
          connections.textContent = module.dependsOn.length ? "Depends on " + module.dependsOn.join(", ") : "No outgoing dependencies in this example";
          section.querySelector("h2").after(connections);
        }
        navigation.append(section);
      }
      break;
    }
    case "journey":
      navigation.append(list("Agent actions", entries, (change) => change.action));
      break;
    default:
      navigation.append(...grouped(entries, "task", (change) => change.story));
  }
}

function diffColumn(lines, oldStart, newStart, side) {
  const column = document.createElement("pre");
  if (side) column.setAttribute("aria-label", side === "before" ? "Before" : "After");
  let oldLine = oldStart;
  let newLine = newStart;
  for (const line of lines) {
    const row = document.createElement("span");
    const sign = line[0];
    const before = sign === "+" ? "" : oldLine++;
    const after = sign === "-" ? "" : newLine++;
    const numbers = side === "before" ? [before] : side === "after" ? [after] : [before, after];
    row.textContent = numbers.map((number) => String(number).padStart(3)).join(" ") + "  " + line;
    if (sign === "+") row.className = "added";
    if (sign === "-") row.className = "removed";
    column.append(row);
  }
  return column;
}

function renderDetail() {
  const change = changes.find(({ id }) => id === state.selected);
  byId("check-detail").hidden = !change?.check;
  byId("change-context").textContent = "";
  if (!change) {
    byId("path").textContent = "No selected change";
    byId("evidence").textContent = "";
    byId("verification").textContent = "";
    byId("diff").replaceChildren();
    return;
  }
  byId("path").textContent = `${change.path} · line ${change.newLine}`;
  byId("evidence").textContent = change.evidence;
  byId("change-context").textContent = change.task + " · " + change.capability + " · " + change.risk + " risk";
  byId("verification").textContent = change.verification ?? "";
  if (change.check) {
    byId("check-summary").textContent = "Example verification · " + change.check.status;
    byId("check-summary").dataset.status = change.check.status.toLowerCase();
    byId("check-command").textContent = change.check.command;
    byId("check-output").textContent = change.check.output;
    byId("check-detail").open = change.check.status === "Failed";
  }
  const columns = byId("layout").value === "split"
    ? [
        diffColumn(change.lines.filter((line) => line[0] !== "+"), change.oldLine, change.newLine, "before"),
        diffColumn(change.lines.filter((line) => line[0] !== "-"), change.oldLine, change.newLine, "after"),
      ]
    : [diffColumn(change.lines, change.oldLine, change.newLine)];
  byId("diff").replaceChildren(...columns);
}

function activate(container, key, action) {
  container.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    for (const choice of container.querySelectorAll("button")) choice.setAttribute("aria-pressed", choice === button);
    action(button.dataset[key]);
  });
}

activate(byId("modes"), "mode", (mode) => { byId("workspace").dataset.mode = mode; });
activate(byId("views"), "view", (view) => {
  state.view = view;
  renderNavigation();
});
activate(byId("navigation"), "hunk", (id) => {
  state.selected = id;
  renderDetail();
});
tasks.addEventListener("change", () => {
  state.task = tasks.value;
  const current = changes.find(({ id }) => id === state.selected);
  if (state.task && current?.task !== state.task) state.selected = changes.find(({ task }) => task === state.task).id;
  renderNavigation();
  renderDetail();
});
byId("layout").addEventListener("change", renderDetail);

if (live) {
  byId("host").hidden = true;
  byId("workspace").dataset.mode = "max";
  byId("modes").hidden = true;
}

async function selectSource() {
  pendingRequest?.abort();
  const showExamples = source.value === "examples";
  refresh.hidden = showExamples;
  byId("scenario-control").hidden = !showExamples;
  byId("example-notice").hidden = !showExamples;
  byId("scenario-goal").hidden = !showExamples;
  currentScenario = showExamples ? exampleScenarios.find((scenario) => scenario.id === scenarios.value) : undefined;
  if (showExamples) {
    refresh.disabled = false;
    byId("scenario-goal").textContent = currentScenario.goal;
    status.textContent = live
      ? "Example data · Select a task or hunk to explore its context. Switch to Live Git changes for the configured repository."
      : "Example data · Open the DSH sidebar to inspect live changes.";
    replaceChanges(currentScenario.changes);
    return;
  }
  const request = new AbortController();
  pendingRequest = request;
  refresh.disabled = true;
  status.textContent = "Reading test repository…";
  const previousSelection = { task: state.task, selected: state.selected };
  replaceChanges([]);
  try {
    const response = await fetch("/agent-xray/changes", { signal: request.signal });
    if (!response.ok) throw new Error("Git changes unavailable (HTTP " + response.status + ")");
    const result = await response.json();
    if (request.signal.aborted) return;
    state.task = previousSelection.task;
    state.selected = previousSelection.selected;
    replaceChanges(result.changes);
    status.textContent = result.note;
  } catch (error) {
    if (request.signal.aborted) return;
    replaceChanges([]);
    status.textContent = error.message;
  } finally {
    if (!request.signal.aborted) refresh.disabled = false;
  }
}

source.addEventListener("change", selectSource);
scenarios.addEventListener("change", selectSource);
refresh.addEventListener("click", selectSource);
selectSource();
