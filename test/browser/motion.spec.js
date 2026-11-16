import { test, expect } from "@playwright/test";

// Regression guards for the visual refresh. Each one encodes a defect that
// rendered plausibly in a finished screenshot, so only an explicit check
// catches it.

test("map nodes keep their layout position while the entrance plays", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Map", exact: true }).click();
  // Sample during the animation, not after it.
  await page.waitForTimeout(200);
  const mid = await page.$$eval(".graph-node", (nodes) =>
    nodes.map((n) => n.getBoundingClientRect().x),
  );
  await page.waitForTimeout(1300);
  const end = await page.$$eval(".graph-node", (nodes) =>
    nodes.map((n) => n.getBoundingClientRect().x),
  );
  expect(new Set(end.map(Math.round)).size).toBeGreaterThan(1);
  // Animating the positioned element overrides its translate and stacks every
  // node at the origin; the inner body may scale, but only by a few pixels.
  for (let i = 0; i < end.length; i++)
    expect(Math.abs(mid[i] - end[i])).toBeLessThan(20);
});

test("verification is coloured by its outcome, never by its stage", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/");
  const seen = new Map();
  const rows = await page.locator(".file-row").count();
  for (let i = 0; i < rows; i++) {
    await page.locator(".file-row").nth(i).click();
    const node = page.locator(".trace-node").nth(3);
    const text = (await node.locator("strong").textContent()).trim();
    seen.set(text, {
      cls: await node.getAttribute("class"),
      icon: (await node.locator(".trace-label b").textContent()).trim(),
    });
  }
  expect(seen.get("failed")?.cls).toContain("outcome-failed");
  expect(seen.get("failed")?.icon).toBe("✕");
  expect(seen.get("passed")?.cls).toContain("outcome-passed");
  expect(seen.get("passed")?.icon).toBe("✓");
  for (const [text, { icon }] of seen)
    if (text !== "passed") expect(icon, text).not.toBe("✓");
});

test("hovering a change links it across figures without redrawing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/");
  const marker = await page.evaluate(() => {
    const app = document.getElementById("app");
    app.dataset.probe = "kept";
    return app.dataset.probe;
  });
  await page.locator(".impact-row").nth(1).hover();
  const id = await page
    .locator(".impact-row")
    .nth(1)
    .getAttribute("data-select");
  await expect(page.locator("#app")).toHaveAttribute("data-linking", "");
  await expect(
    page.locator(`.file-row.is-linked[data-select="${id}"]`),
  ).toHaveCount(1);
  // A redraw would have replaced #app's children but not its attributes; the
  // linked row being the same live node proves no rerender happened.
  expect(
    await page.evaluate(() => document.getElementById("app").dataset.probe),
  ).toBe(marker);
  await page.mouse.move(0, 0);
  await expect(page.locator("#app")).not.toHaveAttribute("data-linking", "");
});

test("hovering a map node isolates its own edges", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Map", exact: true }).click();
  await page.waitForTimeout(1300);
  const node = page.locator(".graph-node[data-node]").first();
  const name = await node.getAttribute("data-node");
  await node.hover();
  await expect(page.locator("#app")).toHaveAttribute("data-graph-focus", "");
  const lit = await page.$$eval(".graph-edge.is-linked", (edges) =>
    edges.map((e) => [e.dataset.from, e.dataset.to]),
  );
  expect(lit.length).toBeGreaterThan(0);
  for (const [from, to] of lit) expect([from, to]).toContain(name);
});

test("typing in search never replays the entrance animation", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForTimeout(1100);
  await page.getByPlaceholder("Find a file or symbol…").fill("session");
  await expect(page.locator("#app")).not.toHaveAttribute("data-enter", "");
});

test("reduced motion disables entrance and transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("#app")).not.toHaveAttribute("data-enter", "");
  const duration = await page
    .locator(".file-row")
    .first()
    .evaluate((n) => getComputedStyle(n).transitionDuration);
  expect(duration.split(",").every((d) => parseFloat(d) === 0)).toBe(true);
});
