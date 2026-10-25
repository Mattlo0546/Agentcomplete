import { expect, test } from "@playwright/test";

import type { PromptVersion } from "../src/lib/history/api";

test("saves ghost text through a real context menu, compares versions and restores across reload", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const versions: PromptVersion[] = [
    {
      id: "9ec64df2-65f7-4bbb-ad14-25858dc1b927",
      prompt: "Retry immediately",
      suggestion_text: null,
      saved_text: "Retry immediately",
      title: "Initial retry",
      description: "Original draft",
      created_at: "2026-10-24T20:00:00Z",
      updated_at: "2026-10-24T20:00:00Z",
    },
  ];
  const outcomes: string[] = [];
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.postDataJSON();
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (path === "/v1/settings")
      return json({ trigger_delay_ms: 150, autocomplete_enabled: true, questions_enabled: true, max_options: 3 });
    if (path === "/v1/enhance")
      return json({
        schema_version: 1,
        request_id: body.request_id,
        prompt_revision: body.prompt_revision,
        type: "autocomplete",
        insert_at: body.prompt.length,
        text: " and jitter.",
      });
    if (path === "/v1/outcomes") {
      outcomes.push(body.event);
      return route.fulfill({ status: 204 });
    }
    if (path.startsWith("/v1/traces/")) return json({ error: { code: "not_found", message: "No trace" } }, 404);
    if (path === "/v1/prompt-history") {
      if (request.method() === "POST") {
        const version = {
          ...body,
          id: "fbd2a272-b921-48c6-8726-e99e6134cf3d",
          saved_text: body.prompt + (body.suggestion_text ?? ""),
          created_at: "2026-10-25T01:00:00Z",
          updated_at: "2026-10-25T01:00:00Z",
        };
        versions.unshift(version);
        return json(version, 201);
      }
      return json({ items: versions, total: versions.length });
    }
    if (path.startsWith("/v1/prompt-history/")) {
      const index = versions.findIndex((item) => item.id === path.split("/").pop());
      if (request.method() === "DELETE") {
        versions.splice(index, 1);
        return route.fulfill({ status: 204 });
      }
      if (request.method() === "PATCH") Object.assign(versions[index], body);
      return json(versions[index]);
    }
    return json({ error: { code: "not_found", message: "Not found" } }, 404);
  });
  const settingsLoaded = page.waitForResponse((response) => response.url().endsWith("/v1/settings"));
  await page.goto("/refine");
  await settingsLoaded;
  const editor = page.getByRole("textbox", { name: "Prompt", exact: true, includeHidden: true });
  await editor.click();
  await editor.pressSequentially("Retry with backoff", { delay: 5 });
  const ghost = page.getByTestId("ghost-text").getByText("and jitter.", { exact: true });
  await expect(ghost).toBeVisible();
  await page.screenshot({ path: `/tmp/agentcomplete-${info.project.name}-refine.png`, animations: "disabled" });
  await ghost.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Save as prompt version" }).click();
  const save = page.getByRole("dialog", { name: "Save prompt version" });
  await expect(save).toBeVisible();
  await save.getByLabel("Name", { exact: true }).fill("Jitter variant");
  await save.getByLabel("Description").fill("Bound retries and spread load");
  await save.getByRole("button", { name: "Save version", exact: true }).click();
  const history = page.getByRole("dialog", { name: "Prompt history" });
  await expect(history).toBeVisible();
  expect(versions[0].saved_text).toBe("Retry with backoff and jitter.");
  await expect(editor).toHaveValue("Retry with backoff");
  expect(outcomes).not.toContain("accepted");
  await history.getByLabel("Compare with").selectOption(versions[1].id);
  await expect(history.getByLabel("Version comparison").locator("del")).toContainText("immediately");
  await expect(history.getByLabel("Version comparison").locator("ins")).toContainText("backoff");
  await page.screenshot({ path: `/tmp/agentcomplete-${info.project.name}-history.png`, animations: "disabled" });
  await history.getByRole("button", { name: "Restore version" }).click();
  await expect(editor).toHaveValue("Retry with backoff");
  await history.getByRole("button", { name: "Restore selected version" }).click();
  await expect(editor).toHaveValue("Retry with backoff and jitter.");
  await page.reload();
  await expect(editor).toHaveValue("Retry with backoff and jitter.");
  await page.getByRole("button", { name: "Prompt history", exact: true }).click();
  if (info.project.name === "mobile") await history.getByRole("button", { name: /Jitter variant/ }).click();
  await history.getByLabel("Name", { exact: true }).fill("Backoff and jitter");
  await history.getByRole("button", { name: "Save details" }).click();
  await expect(history.getByRole("button", { name: "Save details" })).toBeDisabled();
  await history.getByRole("button", { name: "Delete", exact: true }).click();
  await history.getByRole("button", { name: "Delete version", exact: true }).click();
  await expect(history.getByLabel("Name", { exact: true })).toHaveValue("Initial retry");
  expect(errors).toEqual([]);
});
