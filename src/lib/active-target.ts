import { browser } from 'wxt/browser';
import { parseGitHubUrl } from '../domain/github-url';
import type { GitHubTarget } from '../domain/models';

export type ActiveTargetResult =
  | { status: 'supported'; target: GitHubTarget }
  | { status: 'missing'; message: string }
  | { status: 'unsupported'; message: string };

export const ACTIVE_TAB_QUERY_ERROR_MESSAGE = 'Could not read the active tab.';
export const MISSING_ACTIVE_TAB_URL_MESSAGE = 'No active tab URL is available.';
export const UNSUPPORTED_ACTIVE_PAGE_MESSAGE =
  'This page is not a supported GitHub issue or pull request.';

export async function detectActiveTarget(): Promise<ActiveTargetResult> {
  let tabs;
  try {
    tabs = await browser.tabs.query({ active: true, currentWindow: true });
  } catch {
    return { status: 'missing', message: ACTIVE_TAB_QUERY_ERROR_MESSAGE };
  }

  const activeTab = tabs[0];
  const url = activeTab?.url;
  if (typeof url !== 'string' || url.trim().length === 0) {
    return { status: 'missing', message: MISSING_ACTIVE_TAB_URL_MESSAGE };
  }

  const parsed = parseGitHubUrl(url);
  if (!parsed.ok) {
    return { status: 'unsupported', message: UNSUPPORTED_ACTIVE_PAGE_MESSAGE };
  }

  return { status: 'supported', target: parsed.target };
}
