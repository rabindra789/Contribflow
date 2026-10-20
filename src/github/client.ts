import {
  isValidOwnerSyntax,
  isValidRepoSyntax,
  isValidTargetNumber,
  type PullRequestState,
} from '../domain/models';
import { derivePullRequestState } from '../domain/pull-request-state';
import { isPlainRecord, isValidTitle } from '../domain/validation';
import { GitHubClientError } from './errors';
import { parseRateLimitHeaders } from './rate-limit';

export interface GitHubTargetRef {
  owner: string;
  repo: string;
  number: number;
}

export interface GitHubIssueMetadata {
  number: number;
  title: string;
  state: 'open' | 'closed';
}

export interface GitHubPullRequestMetadata {
  number: number;
  title: string;
  state: Exclude<PullRequestState, 'unknown'>;
}

export interface GitHubClient {
  fetchIssue(target: GitHubTargetRef): Promise<GitHubIssueMetadata>;
  fetchPullRequest(target: GitHubTargetRef): Promise<GitHubPullRequestMetadata>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GitHubClientOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}

const API_BASE_URL = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 10_000;

const API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

function invalidTargetError(message: string): GitHubClientError {
  return new GitHubClientError('invalid-input', message);
}

function invalidResponseError(): GitHubClientError {
  return new GitHubClientError('invalid-response', 'GitHub returned an unexpected response body.');
}

function timeoutError(): GitHubClientError {
  return new GitHubClientError('timeout', 'The GitHub request timed out.');
}

function networkError(): GitHubClientError {
  return new GitHubClientError('network', 'Could not reach GitHub.');
}

function assertValidTarget(target: GitHubTargetRef): void {
  if (!isPlainRecord(target)) {
    throw invalidTargetError('The GitHub target is invalid.');
  }
  if (!isValidOwnerSyntax(target.owner)) {
    throw invalidTargetError('The GitHub owner is invalid.');
  }
  if (!isValidRepoSyntax(target.repo)) {
    throw invalidTargetError('The GitHub repository is invalid.');
  }
  if (!isValidTargetNumber(target.number)) {
    throw invalidTargetError('The GitHub number is invalid.');
  }
}

function readMatchingNumber(record: Record<string, unknown>, expected: number): number {
  const number = record.number;
  if (!isValidTargetNumber(number) || number !== expected) {
    throw invalidResponseError();
  }
  return number;
}

function readTitle(record: Record<string, unknown>): string {
  const title = record.title;
  if (!isValidTitle(title)) {
    throw invalidResponseError();
  }
  return title;
}

export function createGitHubClient(options: GitHubClientOptions = {}): GitHubClient {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? (() => Date.now());

  function buildHttpError(response: Response): GitHubClientError {
    const status = response.status;

    if (status === 404 || status === 410) {
      return new GitHubClientError(
        'not-found',
        'The GitHub issue or pull request was not found or is not public.',
        { status },
      );
    }

    if (status === 403 || status === 429) {
      const rateLimit = parseRateLimitHeaders(response.headers, now());
      const message =
        rateLimit.retryAfterSeconds === null
          ? 'GitHub rate limit reached. Try again later.'
          : `GitHub rate limit reached. Try again in ${rateLimit.retryAfterSeconds} seconds.`;

      return new GitHubClientError('rate-limited', message, {
        status,
        retryAfterSeconds: rateLimit.retryAfterSeconds ?? undefined,
        rateLimitResetAt: rateLimit.resetAt ?? undefined,
      });
    }

    return new GitHubClientError('http', `GitHub returned HTTP ${status}.`, { status });
  }

  async function requestJson(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      let response: Response;
      try {
        response = await fetchImpl(`${API_BASE_URL}${path}`, {
          method: 'GET',
          headers: API_HEADERS,
          signal: controller.signal,
          cache: 'no-store',
        });
      } catch {
        if (controller.signal.aborted) {
          throw timeoutError();
        }
        throw networkError();
      }

      if (!response.ok) {
        throw buildHttpError(response);
      }

      try {
        return await response.json();
      } catch {
        if (controller.signal.aborted) {
          throw timeoutError();
        }
        throw invalidResponseError();
      }
    } finally {
      clearTimeout(timer);
    }
  }

  function targetPath(target: GitHubTargetRef, resource: 'issues' | 'pulls'): string {
    return `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/${resource}/${target.number}`;
  }

  return {
    async fetchIssue(target: GitHubTargetRef): Promise<GitHubIssueMetadata> {
      assertValidTarget(target);

      const record = await requestJson(targetPath(target, 'issues'));
      if (!isPlainRecord(record)) {
        throw invalidResponseError();
      }
      if (record.pull_request !== undefined && record.pull_request !== null) {
        throw new GitHubClientError(
          'wrong-target-kind',
          'The GitHub URL points to a pull request, not an issue.',
        );
      }

      const number = readMatchingNumber(record, target.number);
      const title = readTitle(record);
      const state = record.state;
      if (state !== 'open' && state !== 'closed') {
        throw invalidResponseError();
      }

      return { number, title, state };
    },

    async fetchPullRequest(target: GitHubTargetRef): Promise<GitHubPullRequestMetadata> {
      assertValidTarget(target);

      const record = await requestJson(targetPath(target, 'pulls'));
      if (!isPlainRecord(record)) {
        throw invalidResponseError();
      }

      const number = readMatchingNumber(record, target.number);
      const title = readTitle(record);
      const mergedAt = record.merged_at;
      if (
        mergedAt !== null &&
        (typeof mergedAt !== 'string' ||
          mergedAt.length === 0 ||
          !Number.isFinite(Date.parse(mergedAt)))
      ) {
        throw invalidResponseError();
      }

      const derived = derivePullRequestState(record.state, record.draft, mergedAt);
      if (!derived.ok || derived.value === 'unknown') {
        throw invalidResponseError();
      }

      return { number, title, state: derived.value };
    },
  };
}
