import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  captureRepository,
  compareRepository,
} from "../../plugin/repository-capture.js";
import { enrichRepositoryEvidence } from "../../plugin/repository-evidence.js";
import { normalizeSnapshot } from "../../core/model.js";
test("observed outside repository changes show precise scope and attribution", async ({
  page,
}) => {
  const parent = await mkdtemp(join(tmpdir(), "xray-browser-"));
  let snapshot;
  try {
    const root = join(parent, "other-repository");
    await mkdir(root);
    const git = (...args) =>
      execFileSync("git", args, { cwd: root, stdio: "ignore" });
    git("init", "-q");
    await writeFile(
      join(root, "service.ts"),
      'export const status = "initial";\n',
    );
    git("add", ".");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "baseline",
    );
    await writeFile(
      join(root, "service.ts"),
      'export const status = "pre-existing";\n',
    );
    const before = await captureRepository(root);
    await writeFile(
      join(root, "service.ts"),
      'export const status = "pre-existing";\nexport const checked = true;\n',
    );
    const observation = await compareRepository(before);
    snapshot = await enrichRepositoryEvidence(
      normalizeSnapshot({
        sessionId: "observed",
        snapshotId: "observed-1",
        root: "/opened/workspace",
        title: "Review shell changes outside the workspace",
        identity: { throughSeq: 2 },
      }),
      {
        getRepositoryCaptures: async () => [
          {
            sessionId: "observed",
            seq: 2,
            callId: "shell",
            observations: [observation],
            notices: [],
            capturedAt: 1,
          },
        ],
      },
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
  await page.route("**/agent-xray/review?**", (route) =>
    route.fulfill({ json: snapshot }),
  );
  for (const theme of ["light", "dark"])
    for (const width of [380, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/?live=1&session=observed");
      await page.locator(".file-row").first().click();
      await expect(page.locator(".inspector")).toContainText(
        "Existing unchanged edits are excluded",
      );
      await expect(page.getByLabel("Code diff")).toContainText(
        "checked = true",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/repository-observation-${theme}-${width}.png`,
        fullPage: true,
      });
    }
});
