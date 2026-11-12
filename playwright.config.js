import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "test/browser",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3091", headless: true },
  webServer: {
    command: "node scripts/serve-preview.js",
    url: "http://127.0.0.1:3091",
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
});
