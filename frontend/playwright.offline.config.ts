import { defineConfig, devices } from "@playwright/test";

// Deterministic browser coverage for history and plugin handoff; no live AI/DB services.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "prompt-history.spec.ts",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: "/tmp/agentcomplete-browser-results",
  use: { baseURL: "http://localhost:3017", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --port 3017",
    url: "http://localhost:3017/refine",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
