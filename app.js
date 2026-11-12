const changes = [
  {
    id: "sign", task: "Issue signed sessions", capability: "Account security", module: "Session service",
    risk: "High", milestone: "Secure authentication", path: "src/auth/session.ts", oldLine: 12, newLine: 12,
    story: "Sign session tokens with an expiry", action: "09:41 · Agent updated token issuance",
    evidence: "Agent objective · Issue signed sessions to detect token tampering.",
    verification: "Sample run · Session signing tests passed.",
    lines: ["-  return encode({ subject });", "+  return signer.sign({ subject }, { expiresIn: '15m' });"],
  },
  {
    id: "validate", task: "Protect authenticated routes", capability: "Account security", module: "HTTP middleware",
    risk: "High", milestone: "Secure authentication", path: "src/auth/middleware.ts", oldLine: 18, newLine: 18,
    story: "Verify signatures before accepting requests", action: "09:43 · Agent updated authentication middleware",
    evidence: "User request · Secure authentication. Agent objective · Validate incoming sessions.",
    verification: "Sample run · Middleware rejection test passed.",
    lines: ["-  const session = decode(token);", "+  const session = verifier.verify(token);", "   return next(session);"],
  },
  {
    id: "guard", task: "Protect authenticated routes", capability: "Request handling", module: "HTTP middleware",
    risk: "Medium", milestone: "Secure authentication", path: "src/auth/middleware.ts", oldLine: 31, newLine: 31,
    story: "Reject requests without a valid session", action: "09:44 · Agent added the route guard",
    evidence: "Inferred from the guard condition · Requests without a session return HTTP 401.",
    verification: "Sample status · End-to-end verification pending.",
    lines: ["+  if (!session) return response.sendStatus(401);", "   return controller.handle(request);"],
  },
  {
    id: "test", task: "Verify session handling", capability: "Account security", module: "Auth tests",
    risk: "Low", milestone: "Regression coverage", path: "test/auth/middleware.test.ts", oldLine: 25, newLine: 25,
    story: "Cover tampered tokens with a regression test", action: "09:46 · Agent added a rejection test",
    evidence: "Agent objective · Exercise signature rejection in middleware.",
    verification: "Sample run · Tampered-token regression passed.",
    lines: ["+  const response = await requestWithToken(tamperedToken);", "+  expect(response.status).toBe(401);"],
  },
];

const fields = { task: "Implementation task", capability: "Business capability", module: "Architecture module", risk: "Review priority", milestone: "Conversation milestone" };
const state = { task: "", view: "story", group: "task", selected: changes[0].id };
const byId = (id) => document.getElementById(id);
const tasks = byId("task");
tasks.add(new Option("All objectives", ""));
for (const task of new Set(changes.map((change) => change.task))) tasks.add(new Option(task, task));

function list(label, entries, title) {
  const section = document.createElement("section");
  const heading = document.createElement("h2");
  heading.textContent = label;
  section.append(heading);
  const items = document.createElement("ul");
  for (const change of entries) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.textContent = title(change);
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
  const entries = changes.filter((change) => !state.task || change.task === state.task);
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
    case "map":
      navigation.append(...grouped(entries, "module", (change) => change.story));
      break;
    case "journey":
      navigation.append(list("Agent actions", entries, (change) => change.action));
      break;
    default:
      navigation.append(list("Changes in this session", entries, (change) => change.story));
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
  byId("path").textContent = `${change.path} · line ${change.newLine}`;
  byId("evidence").textContent = change.evidence;
  byId("verification").textContent = change.verification;
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
  if (state.task && current.task !== state.task) state.selected = changes.find(({ task }) => task === state.task).id;
  renderNavigation();
  renderDetail();
});
byId("layout").addEventListener("change", renderDetail);
renderNavigation();
renderDetail();
