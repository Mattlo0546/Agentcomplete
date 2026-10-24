import { expect, type Page, type TestInfo } from "@playwright/test";

export const API = "http://127.0.0.1:8000";

export const isMobile = (info: TestInfo) => info.project.name === "mobile";

/** Opens the inspector on medium/narrow layouts (wide always shows it). */
export async function openInspector(page: Page, info: TestInfo, name: RegExp) {
  if (isMobile(info)) await page.getByRole("button", { name }).click();
}

export async function noHydrationErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /Hydration failed/.test(msg.text())) errors.push(msg.text());
  });
  return () => expect(errors, "hydration errors").toEqual([]);
}
