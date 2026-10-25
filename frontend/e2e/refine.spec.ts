import { expect, test } from "@playwright/test";

import type { EnhanceResponse } from "../src/lib/api/types";

import { API, isMobile, noHydrationErrors, openInspector } from "./helpers";

test.describe("Refine", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.removeItem("pe.refine.draft"));
  });

  test("typing produces a live suggestion that can be accepted or applied", async ({ page }, info) => {
    const checkHydration = await noHydrationErrors(page);
    await page.goto("/refine");
    const editor = page.getByRole("textbox", { name: "Prompt" });
    await editor.click();
    // A complete instruction can correctly return none; this journey needs an unfinished thought to accept.
    const prompt = "Refactor the Stripe webhook handler so failed events are retried with exponential backoff and";
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url() === `${API}/v1/enhance` &&
        response.request().method() === "POST" &&
        response.request().postDataJSON()?.prompt === prompt,
    );
    await editor.pressSequentially(prompt, { delay: 5 });
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    const suggestion = (await response.json()) as EnhanceResponse;
    expect(
      ["autocomplete", "multiple_choice"],
      "The unfinished fixture should produce an actionable suggestion",
    ).toContain(suggestion.type);

    const ghost = page.getByTestId("ghost-text");
    const question = page.getByLabel("Question");
    await expect(ghost.or(question).first()).toBeVisible({ timeout: 30_000 });

    if (await ghost.count()) {
      await editor.press("Tab");
      await expect(ghost).toHaveCount(0);
      expect((await editor.inputValue()).length).toBeGreaterThan(prompt.length);
      await expect(editor).toBeFocused();
    } else {
      const options = question.getByRole("radio");
      expect(await options.count()).toBeGreaterThanOrEqual(2);
      await options.first().click();
      await expect(question.getByText(/\d+ edits? ·/)).toBeVisible();
      await question.getByRole("button", { name: "Apply" }).click();
      await expect(question).toBeHidden();
      expect(await editor.inputValue()).not.toBe(prompt);
    }

    const continuedPrompt = `${await editor.inputValue()} `;
    const nextRequestPromise = page.waitForRequest(
      (request) =>
        request.url() === `${API}/v1/enhance` &&
        request.method() === "POST" &&
        request.postDataJSON()?.prompt === continuedPrompt,
    );
    await editor.fill(continuedPrompt);
    const nextRequest = await nextRequestPromise;
    expect(nextRequest.postDataJSON().previous_request_id).toBe(suggestion.request_id);

    await openInspector(page, info, /show context/i);
    await expect(page.getByText("Pipeline").first()).toBeVisible();
    await expect(page.getByText(/Tags/).first()).toBeVisible();
    checkHydration();
  });

  test("a vague prompt asks a question and declining leaves the prompt unchanged", async ({ page }) => {
    await page.goto("/refine");
    const editor = page.getByRole("textbox", { name: "Prompt" });
    await editor.click();
    const prompt = "Write a migration plan for our database.";
    await editor.pressSequentially(prompt, { delay: 5 });
    const question = page.getByLabel("Question");
    const ghost = page.locator("#prompt-ghost-status").getByText("Suggestion available");
    await expect(ghost.or(question).first()).toBeVisible({ timeout: 30_000 });
    if (await question.isVisible()) {
      await question.getByRole("button", { name: "Decline all options" }).click();
      await expect(question).toBeHidden();
    } else {
      await editor.press("Escape");
      await expect(ghost).toHaveCount(0);
    }
    expect(await editor.inputValue()).toBe(prompt);
  });

  test("Send to Codex stores the hand-off", async ({ page, context, request }, info) => {
    if (!isMobile(info)) await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/refine");
    const editor = page.getByRole("textbox", { name: "Prompt" });
    const prompt = `Hand-off check ${Date.now()}`;
    await editor.fill(prompt);
    await page.getByRole("button", { name: "Send to Codex" }).click();
    await expect(page.getByText(/Copied for Codex|clipboard/i).first()).toBeVisible();
    const latest = await (await request.get(`${API}/v1/handoff/latest`)).json();
    expect(latest.prompt).toBe(prompt);
  });
});
