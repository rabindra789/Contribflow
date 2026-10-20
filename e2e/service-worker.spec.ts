import { expect, test } from './fixtures';

test('manifest v3 service worker is running', async ({ extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
});

test('api.github.com requests from the service worker are mockable', async ({ context }) => {
  let [serviceWorker] = context.serviceWorkers();
  serviceWorker ??= await context.waitForEvent('serviceworker');

  await context.route('https://api.github.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mocked: true }),
    });
  });

  const result = await serviceWorker.evaluate(async () => {
    const response = await fetch('https://api.github.com/rate_limit');
    return { status: response.status, body: (await response.json()) as unknown };
  });

  expect(result).toEqual({ status: 200, body: { mocked: true } });
});
