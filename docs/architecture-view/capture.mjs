// Start: python3 -m http.server 4310 --bind 127.0.0.1 --directory docs
// Then:  node docs/architecture-view/capture.mjs
// Uses the repository's existing frontend Playwright dependency; never calls app services.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(
  new URL("../../frontend/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
    deviceScaleFactor: 1.5,
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:4310/architecture-view/?still=1");
  await page.waitForFunction(
    () => document.documentElement.dataset.sceneReady === "true",
  );
  await page.locator("#labels button").first().waitFor();
  assert.equal(await page.locator("#labels button").count(), 8);
  for (const route of [
    "lexical",
    "semantic",
    "fallback",
    "handoff",
    "analytics",
    "overview",
  ]) {
    await page.locator(`[data-route="${route}"]`).click();
    assert.equal(
      await page
        .locator(`[data-route="${route}"]`)
        .getAttribute("aria-pressed"),
      "true",
    );
  }
  await page
    .locator("#component-buttons")
    .getByRole("button", { name: "Gemini", exact: true })
    .click();
  assert.match(
    await page.locator("#detail-facts").innerText(),
    /gemini-3.5-flash-lite/,
  );
  await page
    .getByRole("button", { name: "Inspect Tiger Data", exact: true })
    .click();
  assert.equal(await page.locator("#detail-title").innerText(), "Tiger Data");
  await page.locator('[data-route="overview"]').click();
  assert.equal(await page.locator("#motion").innerText(), "Play flow");
  await page.locator("#motion").click();
  assert.equal(await page.locator("#motion").innerText(), "Pause flow");
  await page.locator("#motion").click();
  await page.locator("#reset").click();
  await page.screenshot({
    path: fileURLToPath(new URL("../assets/architecture.png", import.meta.url)),
    fullPage: true,
  });
  // Orbit and zoom should move the projected labels; reset restores their positions.
  const before = await page.locator("#labels button").first().boundingBox();
  const stage = await page.locator("#canvas-host").boundingBox();
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    stage.x + stage.width / 2 + 100,
    stage.y + stage.height / 2 + 30,
    { steps: 10 },
  );
  await page.mouse.up();
  await page.waitForFunction(
    (x) =>
      Math.abs(
        document.querySelector("#labels button").getBoundingClientRect().x - x,
      ) > 1,
    before.x,
  );
  await page.locator("#reset").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => document.documentElement.scrollWidth <= innerWidth,
  );
  await page
    .getByRole("button", { name: "Local semantic", exact: true })
    .click();
  await page
    .locator("#component-buttons")
    .getByRole("button", { name: "Codex", exact: true })
    .click();
  assert.equal(await page.locator("#detail-title").innerText(), "Codex plugin");
  await page.locator('[data-route="overview"]').click();
  await page.screenshot({
    path: "/tmp/agentcomplete-architecture-mobile.png",
    fullPage: true,
  });
  const fallbackPage = await browser.newPage();
  await fallbackPage.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type.includes("webgl") ? null : original.call(this, type, ...args);
    };
  });
  await fallbackPage.goto("http://127.0.0.1:4310/architecture-view/");
  await fallbackPage.waitForFunction(
    () => document.documentElement.dataset.sceneReady === "fallback",
  );
  await fallbackPage
    .locator("#component-buttons")
    .getByRole("button", { name: "Snowflake", exact: true })
    .click();
  assert.equal(
    await fallbackPage.locator("#detail-title").innerText(),
    "Snowflake",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Architecture verified: 6 routes, 8 component labels, model inspector, camera orbit/reset, pause/resume, mobile, and WebGL fallback. Screenshot saved to docs/assets/architecture.png.",
  );
} finally {
  await browser.close();
}
