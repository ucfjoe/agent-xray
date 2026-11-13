import { test, expect } from "@playwright/test";
import { dependencySession } from "../fixtures/dependency-session.js";
for (const theme of ["light", "dark"]) {
  test(`recorded five-language session map ${theme}`, async ({ page }) => {
    const snapshot = await dependencySession();
    expect(snapshot.dependencies.length).toBeGreaterThanOrEqual(5);
    await page.route("**/agent-xray/review?**", (route) =>
      route.fulfill({ json: snapshot }),
    );
    for (const width of [380, 900, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/?live=1&session=languages");
      await page.getByRole("tab", { name: "Map", exact: true }).click();
      await expect(page.locator(".graph-edge")).toHaveCount(4);
      await expect(page.locator('.map-note[role="status"]')).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/session-dependencies-${theme}-${width}.png`,
        fullPage: true,
      });
      if (width === 900) {
        for (const offset of [500, 1000, 1500]) {
          await page.locator(".navigator").evaluate((node, top) => {
            node.scrollTop = top;
          }, offset);
          await page.screenshot({
            path: `test-results/session-dependencies-${theme}-${width}-scroll-${offset}.png`,
            fullPage: true,
          });
        }
      }
    }
  });
}
test("missing source evidence explains unavailable analysis before the map", async ({
  page,
}) => {
  const snapshot = await dependencySession();
  snapshot.dependencies = [];
  snapshot.dependencyAnalysis = {
    status: "unavailable",
    summary:
      "Dependency analysis unavailable: no verified source prefixes were recorded.",
  };
  await page.route("**/agent-xray/review?**", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.goto("/?live=1&session=languages");
  await page.getByRole("tab", { name: "Map", exact: true }).click();
  await expect(page.locator(".graph-edge")).toHaveCount(0);
  await expect(page.locator('.map-note[role="status"]')).toContainText(
    "Dependency analysis unavailable",
  );
});
test("unresolved imports remain inspectable without invented edges", async ({
  page,
}) => {
  const snapshot = await dependencySession();
  snapshot.dependencyAnalysis.unresolved = [
    {
      from: "web/page.ts",
      specifier: "@app/missing",
      reason: "Target cannot be resolved from recorded evidence.",
    },
  ];
  await page.route("**/agent-xray/review?**", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.goto("/?live=1&session=languages");
  await page.getByRole("tab", { name: "Map", exact: true }).click();
  await page.getByText("1 unresolved imports", { exact: true }).click();
  await expect(
    page.locator(".map-list").filter({ hasText: "1 unresolved imports" }),
  ).toContainText("@app/missing");
  await expect(page.locator(".graph-edge")).toHaveCount(4);
});
