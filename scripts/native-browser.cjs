// Run only in the cloud lab against an already running isolated DSH instance.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  const log = fs.readFileSync(
    process.env.XRAY_LOG || ".lab/server.log",
    "utf8",
  );
  const url = /http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/.exec(log)?.[0];
  if (!url) throw Error("No DSH startup URL found");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(url);
    await page
      .getByRole("button", { name: "Continue", exact: true })
      .click({ timeout: 3000 })
      .catch(() => {});
    await page
      .getByRole("button", { name: "Configure later", exact: true })
      .click({ timeout: 7000 })
      .catch(() => {});
    const session = page.getByRole("treeitem", {
      name: /Review Agent X-Ray rebuild/,
    });
    if (await session.count()) await session.last().click();
    else {
      await page
        .getByRole("button", { name: "Choose workspace", exact: true })
        .click();
      const existing = page.getByRole("menuitem", {
        name: "sample-repo",
        exact: true,
      });
      if (await existing.isVisible()) await existing.click();
      else {
        const add = page.getByRole("menuitem", {
          name: "Add workspace…",
          exact: true,
        });
        if (await add.isVisible()) await add.click();
        await page
          .getByRole("button", { name: "Edit path", exact: true })
          .click();
        await page
          .getByRole("textbox", { name: "Edit path", exact: true })
          .fill(path.resolve(".lab/sample-repo"));
        await page
          .getByRole("textbox", { name: "Edit path", exact: true })
          .press("Enter");
        await page.getByRole("button", { name: "Open", exact: true }).click();
        await page
          .getByRole("dialog", { name: "Select Workspace Directory" })
          .waitFor({ state: "hidden" });
      }
      await page
        .getByRole("textbox", {
          name: "Describe what you want to build, / commands, @ files or sessions",
        })
        .fill("Review Agent X-Ray rebuild");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
    }
    const open = page.getByRole("button", {
      name: "Open right sidebar",
      exact: true,
    });
    if (await open.isVisible()) await open.click();
    const guide = page.getByRole("button", {
      name: "Agent X-Ray Inspect code changes and their context",
      exact: true,
    });
    if (await guide.isVisible()) await guide.click();
    const frame = page.locator('iframe[title="Agent X-Ray"]');
    await frame.waitFor();
    const src = await frame.getAttribute("src");
    if (!src.includes("session=session-"))
      throw Error("Native session identity missing");
    const panel = page.frameLocator('iframe[title="Agent X-Ray"]');
    await panel.locator("#source").selectOption("workspace");
    await panel.locator(".file-row").first().waitFor();
    await panel.locator(".file-row").first().click();
    await page.getByRole("button", { name: "Fullscreen", exact: true }).click();
    await panel.getByRole("button", { name: "Split", exact: true }).click();
    await page
      .getByRole("button", { name: "Exit fullscreen", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Collapse right sidebar", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open right sidebar", exact: true })
      .click();
    if (
      (await panel
        .getByRole("button", { name: "Split", exact: true })
        .getAttribute("aria-pressed")) !== "true"
    )
      throw Error("Diff layout not retained");
    await panel.locator("#source").selectOption("demo");
    await panel.getByRole("tab", { name: "Map", exact: true }).click();
    await panel.locator(".graph-node[role=button]").first().click();
    fs.mkdirSync("test-results", { recursive: true });
    await page.screenshot({
      path: "test-results/native-sidebar.png",
      fullPage: true,
    });
    if (errors.length) throw Error(errors.join("\n"));
    console.log(
      "Native DSH session propagation, workspace Git, fullscreen/collapse, retained state, and diagrams passed.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
