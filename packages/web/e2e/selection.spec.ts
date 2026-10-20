// P-233 — selection flow: add source A + B, expand the trees, check files,
// and reach the "Continue to Merge" gate (P-215).

import { expect, test } from '@playwright/test';
import {
  addLocalSource,
  installApiFixtures,
  installTourOptOut,
  selectOneFilePerSlot,
} from './helpers.js';

test('add sources + select files', async ({ page }) => {
  await installTourOptOut(page);
  await installApiFixtures(page);

  await page.goto('/sources');
  await expect(page.getByRole('region', { name: 'repo A picker' })).toBeVisible();

  await addLocalSource(page, 'A', 'a');
  await addLocalSource(page, 'B', 'b');

  // Both slots resolved -> the page advances to Select (P-211/P-212).
  await page.waitForURL('**/select');
  await expect(page.getByRole('region', { name: 'Select files' })).toBeVisible();

  await selectOneFilePerSlot(page);

  await expect(page.getByTestId('slot-counts')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to Merge' })).toBeEnabled();
});
