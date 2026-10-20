import { describe, expect, it } from 'vitest';
import { createGitHubClient, type FetchLike, type GitHubTargetRef } from './client';
import { GitHubClientError } from './errors';

const issueTarget: GitHubTargetRef = { owner: 'octocat', repo: 'Hello-World', number: 42 };

interface FetchStub {
  fetch: FetchLike;
  calls: Array<{ url: string; init: RequestInit | undefined }>;
}

function createFetchStub(response: Response): FetchStub {
  const calls: FetchStub['calls'] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return response;
    },
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

const issuePayload = {
  number: 42,
  title: 'Improve inference',
  state: 'open',
  html_url: 'https://github.com/octocat/Hello-World/issues/42',
};

const pullRequestPayload = {
  number: 42,
  title: 'Fix routing',
  state: 'open',
  draft: false,
  merged_at: null,
  html_url: 'https://github.com/octocat/Hello-World/pull/42',
};

async function expectGitHubError(
  action: Promise<unknown>,
  kind: GitHubClientError['kind'],
): Promise<GitHubClientError> {
  try {
    await action;
  } catch (error) {
    if (!(error instanceof GitHubClientError)) {
      throw error;
    }
    expect(error.kind).toBe(kind);
    return error;
  }
  throw new Error(`expected a ${kind} error`);
}

describe('github issue requests', () => {
  it('fetches and returns validated issue metadata', async () => {
    const stub = createFetchStub(jsonResponse(issuePayload));
    const client = createGitHubClient({ fetch: stub.fetch });

    const metadata = await client.fetchIssue(issueTarget);

    expect(metadata).toEqual({ number: 42, title: 'Improve inference', state: 'open' });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.url).toBe('https://api.github.com/repos/octocat/Hello-World/issues/42');
    const headers = new Headers(stub.calls[0]?.init?.headers);
    expect(headers.get('accept')).toBe('application/vnd.github+json');
    expect(headers.get('x-github-api-version')).toBe('2022-11-28');
    expect(headers.get('authorization')).toBeNull();
    expect(stub.calls[0]?.init?.method).toBe('GET');
  });

  it('preserves owner casing and repository dots in the request path', async () => {
    const stub = createFetchStub(jsonResponse(issuePayload));
    const client = createGitHubClient({ fetch: stub.fetch });

    await client.fetchIssue({ owner: 'OctoCat', repo: 'next.js', number: 42 });

    expect(stub.calls[0]?.url).toBe('https://api.github.com/repos/OctoCat/next.js/issues/42');
  });

  it('rejects a pull request returned by the issue endpoint', async () => {
    const stub = createFetchStub(
      jsonResponse({ ...issuePayload, pull_request: { url: 'https://api.github.com/...' } }),
    );
    const client = createGitHubClient({ fetch: stub.fetch });

    await expectGitHubError(client.fetchIssue(issueTarget), 'wrong-target-kind');
  });

  it('accepts an issue response with an explicit null pull_request field', async () => {
    const stub = createFetchStub(jsonResponse({ ...issuePayload, pull_request: null }));
    const client = createGitHubClient({ fetch: stub.fetch });

    await expect(client.fetchIssue(issueTarget)).resolves.toEqual({
      number: 42,
      title: 'Improve inference',
      state: 'open',
    });
  });

  it('rejects invalid targets before making a request', async () => {
    const stub = createFetchStub(jsonResponse(issuePayload));
    const client = createGitHubClient({ fetch: stub.fetch });

    await expectGitHubError(
      client.fetchIssue({ owner: '-octocat', repo: 'Hello-World', number: 42 }),
      'invalid-input',
    );
    await expectGitHubError(
      client.fetchIssue({ owner: 'octocat', repo: 'hello world', number: 42 }),
      'invalid-input',
    );
    await expectGitHubError(
      client.fetchIssue({ owner: 'octocat', repo: 'Hello-World', number: 0 }),
      'invalid-input',
    );
    expect(stub.calls).toHaveLength(0);
  });

  it('rejects malformed issue payloads', async () => {
    const client = (body: unknown) =>
      createGitHubClient({ fetch: createFetchStub(jsonResponse(body)).fetch });

    await expectGitHubError(client([]).fetchIssue(issueTarget), 'invalid-response');
    await expectGitHubError(client({ ...issuePayload, number: 7 }).fetchIssue(issueTarget), 'invalid-response');
    await expectGitHubError(client({ ...issuePayload, title: '' }).fetchIssue(issueTarget), 'invalid-response');
    await expectGitHubError(
      client({ ...issuePayload, title: 'bad\u0000title' }).fetchIssue(issueTarget),
      'invalid-response',
    );
    await expectGitHubError(client({ ...issuePayload, state: 'merged' }).fetchIssue(issueTarget), 'invalid-response');
    await expectGitHubError(client({ number: 42, state: 'open' }).fetchIssue(issueTarget), 'invalid-response');
  });
});

describe('github pull request requests', () => {
  it.each([
    { payload: { state: 'open', draft: false, merged_at: null }, expected: 'open' },
    { payload: { state: 'open', draft: true, merged_at: null }, expected: 'draft' },
    { payload: { state: 'closed', draft: false, merged_at: null }, expected: 'closed' },
    {
      payload: { state: 'closed', draft: false, merged_at: '2026-10-19T10:00:00Z' },
      expected: 'merged',
    },
  ])('derives the stored state as $expected', async ({ payload, expected }) => {
    const stub = createFetchStub(jsonResponse({ ...pullRequestPayload, ...payload }));
    const client = createGitHubClient({ fetch: stub.fetch });

    const metadata = await client.fetchPullRequest(issueTarget);

    expect(metadata).toEqual({ number: 42, title: 'Fix routing', state: expected });
    expect(stub.calls[0]?.url).toBe('https://api.github.com/repos/octocat/Hello-World/pulls/42');
  });

  it('rejects malformed pull request payloads', async () => {
    const client = (body: unknown) =>
      createGitHubClient({ fetch: createFetchStub(jsonResponse(body)).fetch });

    await expectGitHubError(
      client({ ...pullRequestPayload, state: 'unknown' }).fetchPullRequest(issueTarget),
      'invalid-response',
    );
    await expectGitHubError(
      client({ ...pullRequestPayload, merged_at: 42 }).fetchPullRequest(issueTarget),
      'invalid-response',
    );
    await expectGitHubError(
      client({ ...pullRequestPayload, draft: 'yes' }).fetchPullRequest(issueTarget),
      'invalid-response',
    );
    await expectGitHubError(
      client({ ...pullRequestPayload, merged_at: 'not-a-date' }).fetchPullRequest(issueTarget),
      'invalid-response',
    );
  });
});

describe('github HTTP failures', () => {
  it('maps 404 and 410 to not-found', async () => {
    const notFound = createGitHubClient({ fetch: createFetchStub(new Response('', { status: 404 })).fetch });
    const gone = createGitHubClient({ fetch: createFetchStub(new Response('', { status: 410 })).fetch });

    await expectGitHubError(notFound.fetchIssue(issueTarget), 'not-found');
    await expectGitHubError(gone.fetchPullRequest(issueTarget), 'not-found');
  });

  it('maps 403 rate limits with reset timing', async () => {
    const now = Date.parse('2026-10-20T12:00:00.000Z');
    const reset = Math.floor(now / 1000) + 120;
    const stub = createFetchStub(
      new Response('', {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(reset),
        },
      }),
    );
    const client = createGitHubClient({ fetch: stub.fetch, now: () => now });

    const error = await expectGitHubError(client.fetchIssue(issueTarget), 'rate-limited');

    expect(error.status).toBe(403);
    expect(error.retryAfterSeconds).toBe(120);
    expect(error.rateLimitResetAt).toBe(new Date(reset * 1000).toISOString());
  });

  it('honors Retry-After on a 429 response', async () => {
    const stub = createFetchStub(
      new Response('', { status: 429, headers: { 'retry-after': '30' } }),
    );
    const client = createGitHubClient({ fetch: stub.fetch });

    const error = await expectGitHubError(client.fetchPullRequest(issueTarget), 'rate-limited');

    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(30);
    expect(error.rateLimitResetAt).toBeUndefined();
  });

  it('maps a 403 without rate-limit evidence to an HTTP error', async () => {
    const stub = createFetchStub(new Response('', { status: 403 }));
    const client = createGitHubClient({ fetch: stub.fetch });

    const error = await expectGitHubError(client.fetchIssue(issueTarget), 'http');

    expect(error.status).toBe(403);
    expect(error.message).toContain('403');
  });

  it('treats a 403 with Retry-After as rate limited', async () => {
    const stub = createFetchStub(
      new Response('', { status: 403, headers: { 'retry-after': '45' } }),
    );
    const client = createGitHubClient({ fetch: stub.fetch });

    const error = await expectGitHubError(client.fetchIssue(issueTarget), 'rate-limited');

    expect(error.status).toBe(403);
    expect(error.retryAfterSeconds).toBe(45);
  });

  it('maps other statuses to a typed HTTP error', async () => {
    const stub = createFetchStub(new Response('', { status: 500 }));
    const client = createGitHubClient({ fetch: stub.fetch });

    const error = await expectGitHubError(client.fetchIssue(issueTarget), 'http');

    expect(error.status).toBe(500);
    expect(error.message).toContain('500');
  });
});

describe('github transport failures', () => {
  it('maps fetch rejections to a network error', async () => {
    const client = createGitHubClient({
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
    });

    await expectGitHubError(client.fetchIssue(issueTarget), 'network');
  });

  it('aborts and reports a timeout', async () => {
    const client = createGitHubClient({
      timeoutMs: 10,
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    });

    const error = await expectGitHubError(client.fetchIssue(issueTarget), 'timeout');

    expect(error.message).toContain('timed out');
  });

  it('rejects invalid JSON', async () => {
    const stub = createFetchStub(
      new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const client = createGitHubClient({ fetch: stub.fetch });

    await expectGitHubError(client.fetchIssue(issueTarget), 'invalid-response');
  });

  it('returns validated data when optional rate-limit headers are absent', async () => {
    const stub = createFetchStub(jsonResponse(issuePayload));
    const client = createGitHubClient({ fetch: stub.fetch });

    await expect(client.fetchIssue(issueTarget)).resolves.toEqual({
      number: 42,
      title: 'Improve inference',
      state: 'open',
    });
  });
});
