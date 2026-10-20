import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Browser } from 'wxt/browser';
import {
  ACTIVE_TAB_QUERY_ERROR_MESSAGE,
  MISSING_ACTIVE_TAB_URL_MESSAGE,
  UNSUPPORTED_ACTIVE_PAGE_MESSAGE,
  detectActiveTarget,
} from './active-target';

type TabsQuery = (queryInfo: Browser.tabs.QueryInfo) => Promise<Browser.tabs.Tab[]>;

function mockTabsQuery(): MockInstance<TabsQuery> {
  return vi.spyOn(fakeBrowser.tabs, 'query') as unknown as MockInstance<TabsQuery>;
}

function mockTabs(tabs: Array<{ url?: string }>): void {
  mockTabsQuery().mockResolvedValue(tabs as unknown as Browser.tabs.Tab[]);
}

describe('detectActiveTarget', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.restoreAllMocks();
  });

  it('returns the canonical target for a GitHub issue tab', async () => {
    mockTabs([
      {
        url: 'https://github.com/Microsoft/TypeScript/issues/12345?notification_referrer_id=1',
      },
    ]);

    await expect(detectActiveTarget()).resolves.toEqual({
      status: 'supported',
      target: {
        kind: 'issue',
        owner: 'Microsoft',
        repo: 'TypeScript',
        number: 12345,
        url: 'https://github.com/Microsoft/TypeScript/issues/12345',
        id: 'microsoft/typescript#12345',
      },
    });
  });

  it('returns a pull request target when the tab is on a pull request', async () => {
    mockTabs([{ url: 'https://github.com/octocat/Hello-World/pull/42/files' }]);

    const result = await detectActiveTarget();

    expect(result.status).toBe('supported');
    if (result.status === 'supported') {
      expect(result.target.kind).toBe('pull_request');
      expect(result.target.url).toBe('https://github.com/octocat/Hello-World/pull/42');
      expect(result.target.id).toBe('octocat/hello-world#42');
    }
  });

  it('queries only the active tab in the current window', async () => {
    const query = mockTabsQuery();
    query.mockResolvedValue([]);

    await detectActiveTarget();

    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
  });

  it.each([
    ['a non-GitHub page', 'https://example.com/issues/1'],
    ['a chrome page', 'chrome://extensions/'],
    ['an unsupported GitHub page', 'https://github.com/octocat/Hello-World'],
    ['a GitHub issue creation page', 'https://github.com/octocat/Hello-World/issues/new'],
  ])('returns unsupported for %s', async (_label, url) => {
    mockTabs([{ url }]);

    await expect(detectActiveTarget()).resolves.toEqual({
      status: 'unsupported',
      message: UNSUPPORTED_ACTIVE_PAGE_MESSAGE,
    });
  });

  it('returns missing when there is no active tab', async () => {
    mockTabs([]);

    await expect(detectActiveTarget()).resolves.toEqual({
      status: 'missing',
      message: MISSING_ACTIVE_TAB_URL_MESSAGE,
    });
  });

  it.each([
    ['an absent URL', undefined],
    ['an empty URL', ''],
    ['a whitespace-only URL', '   '],
    ['a non-string URL', 42],
  ])('returns missing for %s', async (_label, url) => {
    mockTabs([{ url: url as string | undefined }]);

    await expect(detectActiveTarget()).resolves.toEqual({
      status: 'missing',
      message: MISSING_ACTIVE_TAB_URL_MESSAGE,
    });
  });

  it('returns a safe missing result when the tab query rejects', async () => {
    mockTabsQuery().mockRejectedValue(new Error('Secret browser query failure'));

    await expect(detectActiveTarget()).resolves.toEqual({
      status: 'missing',
      message: ACTIVE_TAB_QUERY_ERROR_MESSAGE,
    });
  });
});
