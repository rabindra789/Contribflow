import { expect, test } from './fixtures';

declare const chrome: {
  tabs: {
    query(queryInfo: unknown): Promise<Array<{ url?: string }>>;
  };
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
  };
};

const issueUrl = 'https://github.com/octocat/Hello-World/issues/42';
const issueId = 'octocat/hello-world#42';

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

const mergedPullRequestMetadata = {
  ...pullRequestMetadata,
  title: 'E2E pull request merged',
  state: 'closed',
  merged_at: '2026-10-19T10:00:00Z',
};

const refreshedIssueMetadata = {
  ...issueMetadata,
  title: 'Refreshed E2E issue',
  state: 'closed',
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
  const dashboardLink = page.getByRole('link', { name: 'Open dashboard' });
  await expect(dashboardLink).toHaveAttribute(
    'href',
    `chrome-extension://${extensionId}/dashboard.html`,
  );
  await expect(dashboardLink).toHaveAttribute('target', '_blank');
  await expect(dashboardLink).toHaveAttribute('rel', 'noreferrer');
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

test('dashboard updates live when storage changes in the background', async ({
  page,
  extensionId,
  context,
}) => {
  await context.route('https://api.github.com/**', async (route) => {
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
  await expect(page.getByText('The issue was saved.')).toBeVisible();

  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await expect(
    page.getByRole('heading', { name: 'E2E issue' }),
  ).toBeVisible();

  await page.evaluate(
    (id) =>
      chrome.runtime.sendMessage({
        type: 'SAVE_NOTE',
        issueId: id,
        body: 'Live note body',
        expectedUpdatedAt: null,
      }),
    issueId,
  );

  await expect(page.getByText('Live note body')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Live note body')).toBeVisible();
});

test('dashboard shows a saved issue, persists its note, and removes it', async ({
  page,
  extensionId,
  context,
}) => {
  await context.route('https://api.github.com/**', async (route) => {
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
  await expect(page.getByText('The issue was saved.')).toBeVisible();

  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await expect(
    page.getByRole('heading', { name: 'E2E issue' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Add note for octocat/Hello-World#42' })
    .click();
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('E2E note body');
  await page.getByRole('button', { name: 'Save note' }).click();

  await expect(page.getByText('E2E note body')).toBeVisible();
  await page.reload();
  await expect(page.getByText('E2E note body')).toBeVisible();

  await page
    .getByRole('button', { name: 'Remove octocat/Hello-World#42 and its note' })
    .click();
  await page
    .getByRole('button', { name: 'Confirm removing octocat/Hello-World#42' })
    .click();
  await expect(
    page.getByText('The issue and any private note were removed.'),
  ).toBeVisible();
  await expect(page.getByText('E2E note body')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'E2E issue' })).toHaveCount(0);

  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Your workspace is empty' }),
  ).toBeVisible();
});

test('dashboard shows a tracked PR, refreshes it, and untracks it', async ({
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
      body: JSON.stringify(
        apiCalls === 1 ? pullRequestMetadata : mergedPullRequestMetadata,
      ),
    });
  });
  await page.addInitScript((activeUrl) => {
    chrome.tabs.query = async () => [{ url: activeUrl }];
  }, 'https://github.com/octocat/Hello-World/pull/42');

  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.getByRole('button', { name: 'Track pull request' }).click();
  await expect(page.getByText('The pull request was tracked.')).toBeVisible();

  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await expect(
    page.getByRole('heading', { name: 'E2E pull request' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Refresh octocat/Hello-World#42 from GitHub' })
    .click();

  await expect(page.getByText('The pull request was refreshed from GitHub.')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'E2E pull request merged' }),
  ).toBeVisible();
  await expect(page.getByText('Last known: Merged')).toBeVisible();
  expect(apiCalls).toBe(2);

  await page
    .getByRole('button', { name: 'Untrack octocat/Hello-World#42' })
    .click();
  await page
    .getByRole('button', { name: 'Confirm untracking octocat/Hello-World#42' })
    .click();
  await expect(
    page.getByText('The pull request was untracked.'),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'E2E pull request merged' }),
  ).toHaveCount(0);
});

test('dashboard shows an issue, refreshes it successfully', async ({
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
      body: JSON.stringify(
        apiCalls === 1 ? issueMetadata : refreshedIssueMetadata,
      ),
    });
  });
  await page.addInitScript((activeUrl) => {
    chrome.tabs.query = async () => [{ url: activeUrl }];
  }, issueUrl);

  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.getByRole('button', { name: 'Save issue' }).click();
  await expect(page.getByText('The issue was saved.')).toBeVisible();

  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await expect(
    page.getByRole('heading', { name: 'E2E issue' }),
  ).toBeVisible();

  await page
    .getByRole('button', { name: 'Refresh octocat/Hello-World#42 from GitHub' })
    .click();

  await expect(page.getByText('The issue was refreshed from GitHub.')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Refreshed E2E issue' }),
  ).toBeVisible();
  await expect(page.getByText('Last known: Closed')).toBeVisible();
  await expect(page.getByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/)).toBeVisible();
  expect(apiCalls).toBe(2);
});

test('dashboard issue refresh failure preserves last-known metadata', async ({
  page,
  extensionId,
  context,
}) => {
  let apiCalls = 0;
  const syncError = 'GitHub rate limit reached. Try again later.';
  await context.route('https://api.github.com/**', async (route) => {
    apiCalls += 1;
    if (apiCalls === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(issueMetadata),
      });
      return;
    }
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ message: syncError }),
    });
  });
  await page.addInitScript((activeUrl) => {
    chrome.tabs.query = async () => [{ url: activeUrl }];
  }, issueUrl);

  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.getByRole('button', { name: 'Save issue' }).click();
  await expect(page.getByText('The issue was saved.')).toBeVisible();

  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await expect(
    page.getByRole('heading', { name: 'E2E issue' }),
  ).toBeVisible();

  await page
    .getByRole('button', { name: 'Refresh octocat/Hello-World#42 from GitHub' })
    .click();

  const alert = await page.getByRole('alert');
  await expect(alert).toContainText('Refresh failed');
  await expect(alert).toContainText('rate limit');
  await expect(alert).toContainText('Try again later');
  await expect(alert).toContainText('The last known state is still shown.');
  await expect(page.getByText('Last known: Open')).toBeVisible();
  await expect(page.getByText('Last sync failed')).toBeVisible();
  await expect(page.getByText('Last sync failed').locator('..').getByText(syncError, { exact: true })).toBeVisible();
  expect(apiCalls).toBe(2);
});

test('dashboard note edit does not issue GitHub API requests', async ({
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
  await page.getByRole('button', { name: 'Save issue' }).click();
  await expect(page.getByText('The issue was saved.')).toBeVisible();

  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await expect(
    page.getByRole('heading', { name: 'E2E issue' }),
  ).toBeVisible();

  // Add a note via UI
  await page
    .getByRole('button', { name: 'Add note for octocat/Hello-World#42' })
    .click();
  await page.getByLabel('Note', { exact: true }).fill('E2E note body');
  await page.getByRole('button', { name: 'Save note' }).click();

  await expect(page.getByText('E2E note body')).toBeVisible();
  expect(apiCalls).toBe(1); // only the initial issue save
});

test('dashboard renders the ContribFlow shell', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);

  await expect(page.getByRole('heading', { name: 'ContribFlow Dashboard' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Your workspace is empty' }),
  ).toBeVisible();
});
