import { expect, test } from './fixtures';

declare const chrome: {
  tabs: {
    query(queryInfo: unknown): Promise<Array<{ url?: string }>>;
  };
};

const issueUrl = 'https://github.com/octocat/Hello-World/issues/42';

const issueMetadata = {
  number: 42,
  title: 'E2E issue',
  state: 'open',
  pull_request: null,
};

const pullRequestMetadata = {
  number: 42,
  title: 'E2E pull request',
  state: 'open',
  draft: false,
  merged_at: null,
};

test('popup shows an unsupported-page state without a GitHub tab', async ({
  page,
  extensionId,
}) => {
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await expect(page.getByRole('heading', { name: 'ContribFlow' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'No supported GitHub page' }),
  ).toBeVisible();
  await expect(
    page.getByText('This page is not a supported GitHub issue or pull request.'),
  ).toBeVisible();
});

test('popup saves, reloads, and removes an issue', async ({
  page,
  extensionId,
  context,
}) => {
  let apiCalls = 0;
  await context.route('https://api.github.com/**', async (route) => {
    apiCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(issueMetadata),
    });
  });
  await page.addInitScript((activeUrl) => {
    chrome.tabs.query = async () => [{ url: activeUrl }];
  }, issueUrl);

  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByRole('button', { name: 'Save issue' })).toBeVisible();
  await page.getByRole('button', { name: 'Save issue' }).click();

  await expect(page.getByText('The issue was saved.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'E2E issue' })).toBeVisible();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  expect(apiCalls).toBe(1);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Remove issue' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'E2E issue' })).toBeVisible();
  expect(apiCalls).toBe(1);

  await page.getByRole('button', { name: 'Remove issue' }).click();
  await expect(page.getByText('The issue was removed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save issue' })).toBeVisible();
});

test('popup tracks and untracks a pull request', async ({
  page,
  extensionId,
  context,
}) => {
  let apiCalls = 0;
  await context.route('https://api.github.com/**', async (route) => {
    apiCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(pullRequestMetadata),
    });
  });
  await page.addInitScript((activeUrl) => {
    chrome.tabs.query = async () => [{ url: activeUrl }];
  }, 'https://github.com/octocat/Hello-World/pull/42');

  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(
    page.getByRole('button', { name: 'Track pull request' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Track pull request' }).click();

  await expect(page.getByText('The pull request was tracked.')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'E2E pull request' }),
  ).toBeVisible();
  await expect(page.getByText('Tracked', { exact: true })).toBeVisible();
  expect(apiCalls).toBe(1);

  await page.getByRole('button', { name: 'Untrack pull request' }).click();
  await expect(page.getByText('The pull request was untracked.')).toBeVisible();
  await expect(page.getByText('Not tracked', { exact: true })).toBeVisible();
});

test('popup keeps a saved issue and retries failed metadata', async ({
  page,
  extensionId,
  context,
}) => {
  let apiCalls = 0;
  await context.route('https://api.github.com/**', async (route) => {
    apiCalls += 1;
    if (apiCalls === 1) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Server error' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(issueMetadata),
    });
  });
  await page.addInitScript((activeUrl) => {
    chrome.tabs.query = async () => [{ url: activeUrl }];
  }, issueUrl);

  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.getByRole('button', { name: 'Save issue' }).click();

  await expect(
    page.getByText(
      'The issue was saved, but GitHub metadata could not be fetched.',
    ),
  ).toBeVisible();
  await expect(page.getByText('Metadata unavailable')).toBeVisible();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Retry metadata' }).click();

  await expect(page.getByText('GitHub metadata was refreshed.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'E2E issue' })).toBeVisible();
  expect(apiCalls).toBe(2);
});

test('dashboard renders the ContribFlow shell', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);

  await expect(page.getByRole('heading', { name: 'ContribFlow Dashboard' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pull requests' })).toBeVisible();
});
