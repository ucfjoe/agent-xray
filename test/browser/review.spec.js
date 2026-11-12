import { test, expect } from "@playwright/test";
test("all perspectives, scenarios, filtering and exact diff inspection", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/");
  for (const scenario of ["authentication", "checkout", "catalog"]) {
    await page.locator("#scenario").selectOption(scenario);
    for (const view of ["Story", "Changes", "Map", "Journey"]) {
      await page.getByRole("tab", { name: view, exact: true }).click();
      await expect(page.locator("[data-select]").first()).toBeVisible();
      await page.locator("[data-select]").first().click();
      await expect(page.getByLabel("Code diff")).toBeVisible();
    }
    await page.getByRole("tab", { name: "Changes", exact: true }).click();
    for (const group of ["task", "capability", "module", "risk", "milestone"]) {
      await page.locator("#group").selectOption(group);
      await expect(page.locator(".navigator .file-row")).toHaveCount(6);
    }
  }
  await page.getByPlaceholder("Find a file or symbol…").fill("no-such-file");
  await expect(page.locator(".navigator .file-row")).toHaveCount(0);
  await page.getByPlaceholder("Find a file or symbol…").fill("");
  await page.locator(".navigator .file-row").first().click();
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(page.locator(".split-diff")).toBeVisible();
  expect(errors).toEqual([]);
});
test("narrow sidebar has deliberate drill-down and no document overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 380, height: 900 });
  await page.goto("/");
  await expect(page.locator(".story-group")).toHaveCount(3);
  await page.locator(".file-row").first().click();
  await expect(page.getByLabel("Code diff")).toBeVisible();
  await expect(page.locator(".navigator")).toBeHidden();
  await page.getByLabel("Back to changes").click();
  await expect(page.locator(".navigator")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("live default never silently shows demo data", async ({ page }) => {
  await page.goto("/?live=1");
  await expect(page.locator("#source")).toHaveValue("session");
  await expect(page.getByRole("alert")).toContainText("Open Agent X-Ray");
  await expect(page.locator(".demo-strip")).toHaveCount(0);
  await page.locator("#source").selectOption("demo");
  await expect(page.locator(".story-group")).toHaveCount(3);
  await page.locator("#source").selectOption("session");
  await expect(page.locator(".story-group")).toHaveCount(0);
});
for (const scheme of ["light", "dark"])
  for (const width of [380, 900, 1440])
    test(`visual ${scheme} ${width}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 950 });
      await page.goto("/");
      await expect(page.locator(".story-group")).toHaveCount(3);
      if (width > 759) await page.locator(".file-row").first().click();
      await page.screenshot({
        path: `test-results/preview-${scheme}-${width}.png`,
        fullPage: true,
      });
      if (width === 1440) {
        await page.getByRole("tab", { name: "Map", exact: true }).click();
        await page.screenshot({
          path: `test-results/map-${scheme}.png`,
          fullPage: true,
        });
      }
    });

test("live refresh preserves inspected snapshot until explicit catch up", async ({
  page,
}) => {
  let version = 1;
  const fixture = () => ({
    source: "live",
    sessionId: "s",
    workspaceId: "w",
    snapshotId: "s" + version,
    title: "Real fixture",
    hunks: [
      {
        id: "h" + version,
        path: "a.js",
        title: "Edit a.js",
        lines: ["-old", "+new"],
        oldStart: 1,
        newStart: 1,
      },
    ],
    events: [],
    relationships: [],
    objectives: [],
    checks: [],
    notices: [],
  });
  await page.route("**/agent-xray/review?**", (route) =>
    route.fulfill({ json: fixture() }),
  );
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto("/?live=1&session=s");
  await page.locator(".file-row").first().click();
  await expect(page.locator('[data-select="h1"]')).toBeVisible();
  version = 2;
  await expect(page.getByText("New activity available")).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator('[data-select="h1"]')).toBeVisible();
  await page.getByText("New activity available").click();
  await expect(page.locator('[data-select="h2"]')).toBeVisible();
  await page.getByRole("button", { name: "Follow agent" }).click();
  version = 3;
  await expect(page.locator(".file-row.selected")).toHaveAttribute(
    "data-select",
    "h3",
    { timeout: 10000 },
  );
});

test("slow live response cannot overwrite an explicitly selected example", async ({
  page,
}) => {
  let release;
  let started;
  const ready = new Promise((r) => (started = r));
  await page.route("**/agent-xray/review?**", async (route) => {
    started();
    await new Promise((r) => (release = r));
    await route
      .fulfill({ json: { title: "Old live response", hunks: [] } })
      .catch(() => {});
  });
  await page.goto("/?live=1&session=s");
  await ready;
  await page.locator("#source").selectOption("demo");
  release();
  await expect(page.locator("#source")).toHaveValue("demo");
  await expect(page.locator(".story-group")).toHaveCount(3);
});

test("keyboard focus survives tabs, file drill-down and back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 380, height: 900 });
  await page.goto("/");
  const tab = page.getByRole("tab", { name: "Changes", exact: true });
  await tab.focus();
  await page.keyboard.press("Enter");
  await expect(tab).toBeFocused();
  const row = page.locator(".file-row").first();
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Back to changes")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".file-row.selected")).toBeFocused();
});

test("selected exact line survives view changes and reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto("/");
  await page.locator(".file-row").first().click();
  await page.locator('[data-code-line="13"][data-code-side="next"]').click();
  await expect(page.locator('[data-line-selected="true"]')).toHaveCount(1);
  await page.getByRole("tab", { name: "Changes", exact: true }).click();
  await expect(page.locator('[data-line-selected="true"]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('[data-line-selected="true"]')).toHaveCount(1);
});

test("100 changed files remain searchable without document overflow", async ({
  page,
}) => {
  const hunks = Array.from({ length: 100 }, (_, i) => ({
    id: "h" + i,
    path: `src/deep/module-${i}/long-component-name-${i}.ts`,
    title: "Update component " + i,
    oldStart: 1,
    newStart: 1,
    lines: ["-old", "+new"],
  }));
  await page.route("**/agent-xray/review?**", (route) =>
    route.fulfill({
      json: {
        source: "live",
        sessionId: "s",
        snapshotId: "large",
        title: "Large review",
        hunks,
        files: [],
        events: [],
        objectives: [],
        relationships: [],
        checks: [],
        notices: [],
      },
    }),
  );
  await page.setViewportSize({ width: 380, height: 900 });
  await page.goto("/?live=1&session=s");
  await expect(page.locator(".file-row")).toHaveCount(100);
  await page.getByPlaceholder("Find a file or symbol…").fill("module-99/");
  await expect(page.locator(".file-row")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
