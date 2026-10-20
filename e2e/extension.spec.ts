import { expect, test } from './fixtures';

test('popup renders the ContribFlow shell', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await expect(page.getByRole('heading', { name: 'ContribFlow' })).toBeVisible();
  await expect(
    page.getByText('Open a GitHub issue or pull request to save it here.'),
  ).toBeVisible();
});

test('dashboard renders the ContribFlow shell', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);

  await expect(page.getByRole('heading', { name: 'ContribFlow Dashboard' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();
});
