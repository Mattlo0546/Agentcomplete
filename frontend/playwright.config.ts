import { defineConfig, devices } from "@playwright/test";

// Real-browser journeys against the live backend (Tiger Data + Gemini). Start both servers first,
// or let Playwright start them (reuses running ones).
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e-report" }]],
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: "uv run --project ../backend --directory ../backend uvicorn app.main:app --port 8000",
      url: "http://127.0.0.1:8000/v1/health",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    { command: "pnpm dev --port 3000", url: "http://localhost:3000/refine", reuseExistingServer: true, timeout: 120_000 },
  ],
});
