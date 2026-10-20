// P-233 — the merge flow end to end: sources -> selection -> run ->
// review -> approve -> results, plus the reject path (P-218).

import { expect, test, type Page } from '@playwright/test';
import {
  addLocalSource,
  installApiFixtures,
  installTourOptOut,
  selectOneFilePerSlot,
} from './helpers.js';

/** Drive the app to the review step through the real UI. */
async function seedToReview(page: Page): Promise<void> {
  await installTourOptOut(page);
  await installApiFixtures(page);
  await page.goto('/sources');
  await addLocalSource(page, 'A', 'a');
  await addLocalSource(page, 'B', 'b');
  await page.waitForURL('**/select');
  await selectOneFilePerSlot(page);
  await page.getByRole('button', { name: 'Continue to Merge' }).click();
  await page.waitForURL('**/stitch');
  await page.getByRole('button', { name: 'Run Merge' }).click();
  await expect(page.getByLabel('merge summary')).toBeVisible();
  await page.getByRole('link', { name: 'Review' }).click();
  await page.waitForURL('**/review');
  await page.getByRole('button', { name: 'Reject merge' }).waitFor();
}

test('full merge to results', async ({ page }) => {
  await seedToReview(page);

  // The proposed diff is on the review step (P-217).
  await expect(page.getByTestId('diff-src/index.ts')).toBeVisible();

  // Two-step approval (P-218): arm, then confirm.
  await page.getByRole('button', { name: 'Approve & Create C' }).click();
  await page.getByRole('button', { name: 'Confirm & Create C' }).click();

  await page.waitForURL('**/results');
  await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible();
});

test('reject flow', async ({ page }) => {
  await seedToReview(page);

  await page.getByLabel('Rejection reason').fill('The diff touches a generated file.');
  await page.getByRole('button', { name: 'Reject merge' }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'Merge rejected' })).toBeVisible();
});
