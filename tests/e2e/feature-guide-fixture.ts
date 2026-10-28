import type { Page } from "@playwright/test";

/** Existing business fixtures represent returning users; first-visit guide tests omit this seed. */
export async function seedReturningFeatureGuideUser(page: Page, accountIds: readonly string[]) {
  await page.addInitScript((ids) => {
    for (const accountId of ids) {
      for (const surface of ["projects", "workspace", "studio", "fabrics", "trends"]) {
        localStorage.setItem(`fashion:feature-guide:v1:${accountId}:${surface}`, "completed");
      }
    }
  }, [...accountIds]);
}
