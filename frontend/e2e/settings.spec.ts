import { expect, test } from "@playwright/test";

import { API } from "./helpers";

test("settings persist to the backend and theme switches", async ({ page, request }) => {
  await page.goto("/settings");
  await expect(page.getByText(/healthy/)).toBeVisible();
  await page.getByRole("button", { name: "Test" }).click();
  await expect(page.getByText(/gemini ok/)).toBeVisible({ timeout: 15_000 });

  const toggle = page.getByRole("switch", { name: "Questions" });
  const before = (await (await request.get(`${API}/v1/settings`)).json()).questions_enabled;
  await toggle.click();
  await expect.poll(async () => (await (await request.get(`${API}/v1/settings`)).json()).questions_enabled).toBe(!before);
  await toggle.click();
  await expect.poll(async () => (await (await request.get(`${API}/v1/settings`)).json()).questions_enabled).toBe(before);

  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("radio", { name: "System" }).click();

  await expect(page.getByText("Not stored")).toBeVisible();
  await expect(page.getByText("30 days")).toBeVisible();
  await expect(page.getByRole("slider", { name: "Trigger delay" })).toBeVisible();
});
