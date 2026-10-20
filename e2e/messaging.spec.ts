import { expect, test } from './fixtures';

declare const chrome: {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
  };
};

const issueUrl = 'https://github.com/octocat/Hello-World/issues/42';
const issueId = 'octocat/hello-world#42';

test('background commands validate, save, and remove an issue', async ({
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
      body: JSON.stringify({
        number: 42,
        title: 'E2E issue',
        state: 'open',
        pull_request: null,
      }),
    });
  });

  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  const initial = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'GET_SNAPSHOT' }),
  );
  expect(initial).toMatchObject({
    ok: true,
    data: { issues: [], pullRequests: [], notes: {}, warnings: [] },
  });

  const invalid = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'SAVE_ISSUE' }),
  );
  expect(invalid).toMatchObject({ ok: false, error: { code: 'invalid-command' } });
  expect(apiCalls).toBe(0);

  const saved = await page.evaluate(
    (url) => chrome.runtime.sendMessage({ type: 'SAVE_ISSUE', url }),
    issueUrl,
  );
  expect(saved).toMatchObject({
    ok: true,
    data: {
      created: true,
      syncError: null,
      issue: {
        id: issueId,
        title: 'E2E issue',
        state: 'open',
        lastSyncError: null,
      },
    },
  });
  expect(apiCalls).toBe(1);

  const duplicate = await page.evaluate(
    (url) => chrome.runtime.sendMessage({ type: 'SAVE_ISSUE', url }),
    issueUrl,
  );
  expect(duplicate).toMatchObject({
    ok: true,
    data: { created: false, syncError: null },
  });
  expect(apiCalls).toBe(1);

  const snapshot = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'GET_SNAPSHOT' }),
  );
  expect(snapshot).toMatchObject({
    ok: true,
    data: {
      issues: [{ id: issueId, title: 'E2E issue', state: 'open' }],
      pullRequests: [],
      notes: {},
      warnings: [],
    },
  });

  const removed = await page.evaluate(
    (id) => chrome.runtime.sendMessage({ type: 'REMOVE_ISSUE', issueId: id }),
    issueId,
  );
  expect(removed).toMatchObject({ ok: true, data: { issueId } });

  const empty = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'GET_SNAPSHOT' }),
  );
  expect(empty).toMatchObject({
    ok: true,
    data: { issues: [], pullRequests: [], notes: {}, warnings: [] },
  });
});
