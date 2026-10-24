import { expect, test } from "@playwright/test";

import { API, isMobile } from "./helpers";

test.describe("Knowledge", () => {
  test("search filters the list and a row opens its detail", async ({ page }) => {
    await page.goto("/knowledge");
    const list = page.getByRole("listbox", { name: "Knowledge" });
    await expect(list.getByRole("option").first()).toBeVisible();
    await page.getByRole("searchbox", { name: "Search knowledge" }).fill("postgres");
    await expect(list.getByRole("option", { name: /PostgreSQL/i }).first()).toBeVisible();
    await expect(list.getByRole("option", { name: /Stripe/i })).toHaveCount(0);
    await list.getByRole("option", { name: /zero-downtime/i }).click();
    await expect(page.getByText("Summary").first()).toBeVisible();
    await expect(page.getByText(/lock_timeout/).first()).toBeVisible();
  });

  test("add knowledge streams real ingest steps, then delete it", async ({ page, request }, info) => {
    const title = `e2e-${info.project.name}-${Date.now()}`;
    await page.goto("/knowledge");
    await page.getByRole("button", { name: "Add knowledge" }).click();
    const dialog = page.getByRole("dialog", { name: "Add knowledge" });
    await dialog.getByLabel("Title").fill(title);
    await dialog
      .getByLabel("Body")
      .fill("# Feature flags\n\nGate risky rollouts behind a flag, ramp by percentage, and remove stale flags after full rollout.");
    await dialog.getByRole("button", { name: /^Add$/ }).click();
    await expect(dialog.getByText("Save")).toBeVisible({ timeout: 45_000 });
    await expect(dialog.getByRole("button", { name: "Done" })).toBeEnabled({ timeout: 45_000 });
    await expect(dialog.getByText("Summary")).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();

    const found = await (await request.get(`${API}/v1/knowledge?q=${encodeURIComponent(title)}`)).json();
    expect(found.total).toBe(1);
    expect(found.items[0].tags.length).toBeGreaterThanOrEqual(3);

    if (isMobile(info)) {
      await page.getByRole("searchbox", { name: "Search knowledge" }).fill(title);
      await page.getByRole("option", { name: new RegExp(title) }).click();
    }
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: /Delete/ }).click();
    await expect.poll(async () => (await (await request.get(`${API}/v1/knowledge?q=${title}`)).json()).total).toBe(0);
  });
});
