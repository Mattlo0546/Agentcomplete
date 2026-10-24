// Captures desktop screens of the running app for the fidelity check (docs/evidence/).
import { chromium } from "@playwright/test";

const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const wait = (ms) => page.waitForTimeout(ms);

await page.goto("http://localhost:3000/refine");
const editor = page.getByRole("textbox", { name: "Prompt" });
await editor.fill("");
await editor.pressSequentially("Add retries to the payment client using exponential backoff and", { delay: 3 });
await page
  .locator("#prompt-ghost-status")
  .getByText("Suggestion available")
  .or(page.getByLabel("Question"))
  .first()
  .waitFor({ timeout: 30000 });
await wait(800);
await shot("desktop-refine-autocomplete");

await editor.fill("");
await editor.pressSequentially("Write a migration plan for moving our session store from Redis to Postgres.", {
  delay: 3,
});
await page
  .getByLabel("Question")
  .or(page.locator("#prompt-ghost-status").getByText("Suggestion available"))
  .first()
  .waitFor({ timeout: 30000 });
const question = page.getByLabel("Question");
if (await question.count()) await question.getByRole("radio").first().click();
await wait(800);
await shot("desktop-refine-question");

await page.emulateMedia({ colorScheme: "dark" });
await wait(500);
await shot("desktop-refine-question-dark");
await page.emulateMedia({ colorScheme: "light" });

await page.goto("http://localhost:3000/knowledge");
await page.getByRole("option").nth(8).click();
await wait(1500);
await shot("desktop-knowledge");
await page.getByRole("button", { name: "Add knowledge" }).click();
await wait(500);
await shot("desktop-knowledge-add");

await page.goto("http://localhost:3000/activity");
await page.getByText("POST /v1/enhance").first().click();
await wait(1500);
await shot("desktop-activity");

await page.goto("http://localhost:3000/settings");
await page.getByText(/healthy/).waitFor();
await shot("desktop-settings");
await browser.close();
