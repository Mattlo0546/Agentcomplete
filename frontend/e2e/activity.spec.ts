import { expect, test } from "@playwright/test";

import { API, openInspector } from "./helpers";

test("activity shows stats, logs and a request timeline", async ({ page, request }, info) => {
  // Make sure there is a fresh enhance request to inspect.
  const requestId = `req_e2e${Date.now().toString(16).slice(-8)}`;
  const enhance = await request.post(`${API}/v1/enhance`, {
    data: { request_id: requestId, prompt: "Add pagination to the users API endpoint", prompt_revision: 1, cursor: 40 },
    headers: { "X-Request-ID": requestId },
    timeout: 30_000,
  });
  expect([200, 502]).toContain(enhance.status());

  await page.goto("/activity");
  await expect(page.getByLabel("Outcome summary")).toContainText(/Suggestions/i);
  const table = page.getByRole("table", { name: "Request log" }).or(page.getByLabel("Request log"));
  await expect(table.getByText("POST /v1/enhance").first()).toBeVisible();

  if (info.project.name === "desktop") {
    await page.getByRole("searchbox", { name: "Request id" }).fill(requestId);
  }
  await table.getByText("POST /v1/enhance").first().click();
  await openInspector(page, info, /show request detail/i);
  await expect(page.getByText(/req_[0-9a-z]+/).first()).toBeVisible();
  await expect(page.getByLabel("Timeline")).toBeVisible();
});
