import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  IssueNote,
  SavedIssue,
  TrackedPullRequest,
} from '../../domain/models';
import {
  BackgroundClientError,
  type BackgroundClient,
} from '../../messaging/background-client';
import type { StorageSnapshot } from '../../storage/repository';
import { DashboardApp } from './App';

const issueTitle = 'Improve inference for generic callbacks';

const issue: SavedIssue = {
  id: 'microsoft/typescript#12345',
  owner: 'Microsoft',
  repo: 'TypeScript',
  number: 12345,
  url: 'https://github.com/Microsoft/TypeScript/issues/12345',
  title: issueTitle,
  state: 'open',
  savedAt: '2026-10-19T09:15:00.000Z',
  lastSyncedAt: '2026-10-19T09:15:02.120Z',
  lastSyncError: null,
};

const unsyncedIssue: SavedIssue = {
  id: 'octocat/hello-world#42',
  owner: 'octocat',
  repo: 'Hello-World',
  number: 42,
  url: 'https://github.com/octocat/Hello-World/issues/42',
  title: null,
  state: 'unknown',
  savedAt: '2026-10-18T14:00:00.000Z',
  lastSyncedAt: null,
  lastSyncError: 'GitHub metadata sync failed.',
};

const pullRequestTitle = 'Fix callback inference';

const pullRequest: TrackedPullRequest = {
  id: 'microsoft/typescript#54321',
  owner: 'Microsoft',
  repo: 'TypeScript',
  number: 54321,
  url: 'https://github.com/Microsoft/TypeScript/pull/54321',
  title: pullRequestTitle,
  state: 'draft',
  addedAt: '2026-10-19T10:00:00.000Z',
  lastSyncedAt: '2026-10-19T10:00:01.000Z',
  lastSyncError: null,
};

const note: IssueNote = {
  issueId: issue.id,
  body: 'Reproduce with strict mode enabled.',
  createdAt: '2026-10-19T09:20:00.000Z',
  updatedAt: '2026-10-19T09:25:30.000Z',
};

const emptySnapshot: StorageSnapshot = {
  issues: [],
  pullRequests: [],
  notes: {},
  warnings: [],
};

const populatedSnapshot: StorageSnapshot = {
  issues: [issue, unsyncedIssue],
  pullRequests: [pullRequest],
  notes: { [issue.id]: note },
  warnings: [
    {
      kind: 'invalid-record',
      storageKey: 'contribflow.v1.issue.invalid',
      reason: 'title is invalid',
    },
  ],
};

function createClient(
  overrides: Partial<BackgroundClient> = {},
): BackgroundClient {
  return {
    getSnapshot: vi
      .fn<BackgroundClient['getSnapshot']>()
      .mockResolvedValue(emptySnapshot),
    saveIssue: vi.fn<BackgroundClient['saveIssue']>(),
    refreshIssue: vi.fn<BackgroundClient['refreshIssue']>(),
    removeIssue: vi.fn<BackgroundClient['removeIssue']>(),
    trackPullRequest: vi.fn<BackgroundClient['trackPullRequest']>(),
    refreshPullRequest: vi.fn<BackgroundClient['refreshPullRequest']>(),
    removePullRequest: vi.fn<BackgroundClient['removePullRequest']>(),
    ...overrides,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('dashboard', () => {
  it('shows loading state until the snapshot arrives', async () => {
    const pending = deferred<StorageSnapshot>();
    const client = createClient({
      getSnapshot: vi
        .fn<BackgroundClient['getSnapshot']>()
        .mockReturnValue(pending.promise),
    });

    render(<DashboardApp client={client} />);

    expect(screen.getByText('Loading your workspace...')).toBeVisible();

    await act(async () => {
      pending.resolve(populatedSnapshot);
      await pending.promise;
    });

    expect(
      await screen.findByRole('heading', {
        name: 'Improve inference for generic callbacks',
      }),
    ).toBeVisible();
    expect(screen.queryByText('Loading your workspace...')).not.toBeInTheDocument();
  });

  it('retries after a snapshot failure', async () => {
    const getSnapshot = vi
      .fn<BackgroundClient['getSnapshot']>()
      .mockRejectedValueOnce(
        new BackgroundClientError(
          'invalid-response',
          'The extension returned an unexpected response.',
        ),
      )
      .mockResolvedValueOnce(emptySnapshot);
    const client = createClient({ getSnapshot });

    render(<DashboardApp client={client} />);

    expect(
      await screen.findByRole('heading', {
        name: 'Could not load your workspace',
      }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The extension returned an unexpected response.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByRole('heading', { name: 'Your workspace is empty' }),
    ).toBeVisible();
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('renders an empty workspace with zero counts', async () => {
    render(<DashboardApp client={createClient()} />);

    expect(
      await screen.findByRole('heading', { name: 'Your workspace is empty' }),
    ).toBeVisible();
    expect(
      screen.getByRole('group', { name: 'Saved issues: 0' }),
    ).toBeVisible();
    expect(
      screen.getByRole('group', { name: 'Tracked pull requests: 0' }),
    ).toBeVisible();
    expect(screen.getByRole('group', { name: 'Private notes: 0' })).toBeVisible();
  });

  it('renders saved issues, tracked pull requests, counts, and warnings', async () => {
    const client = createClient({
      getSnapshot: vi
        .fn<BackgroundClient['getSnapshot']>()
        .mockResolvedValue(populatedSnapshot),
    });

    render(<DashboardApp client={client} />);

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();
    expect(screen.getByText('Microsoft/TypeScript#12345')).toBeVisible();
    expect(screen.getByText('Last known: Open')).toBeVisible();
    expect(screen.getByText('Last known: Unknown')).toBeVisible();
    expect(screen.getByText('Last known: Draft')).toBeVisible();
    expect(screen.getByText('Title unavailable')).toBeVisible();

    expect(
      screen.getByRole('group', { name: 'Saved issues: 2' }),
    ).toBeVisible();
    expect(
      screen.getByRole('group', { name: 'Tracked pull requests: 1' }),
    ).toBeVisible();
    expect(screen.getByRole('group', { name: 'Private notes: 1' })).toBeVisible();

    const issueLink = screen.getByRole('link', {
      name: 'Open Microsoft/TypeScript#12345 on GitHub',
    });
    expect(issueLink).toHaveAttribute('href', issue.url);
    expect(issueLink).toHaveAttribute('rel', 'noreferrer');

    expect(
      screen.getByRole('heading', { name: 'Storage warnings' }),
    ).toBeVisible();
    expect(
      screen.getByText(/contribflow\.v1\.issue\.invalid: title is invalid/),
    ).toBeVisible();

    const summary = screen.getByRole('region', {
      name: 'Collection summary',
    });
    expect(within(summary).getByText('Saved issues')).toBeVisible();
  });

  it('refreshes the collection on demand', async () => {
    const getSnapshot = vi
      .fn<BackgroundClient['getSnapshot']>()
      .mockResolvedValueOnce({ ...emptySnapshot, issues: [issue] })
      .mockResolvedValueOnce(populatedSnapshot);
    const client = createClient({ getSnapshot });

    render(<DashboardApp client={client} />);

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh collection' }),
    );

    expect(await screen.findByText('The collection was refreshed.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Title unavailable' })).toBeVisible();
    expect(
      screen.getByRole('group', { name: 'Saved issues: 2' }),
    ).toBeVisible();
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('keeps the loaded workspace when refreshing fails', async () => {
    const getSnapshot = vi
      .fn<BackgroundClient['getSnapshot']>()
      .mockResolvedValueOnce({ ...emptySnapshot, issues: [issue] })
      .mockRejectedValueOnce(
        new BackgroundClientError(
          'messaging-unavailable',
          'The extension background service is unavailable.',
        ),
      );
    const client = createClient({ getSnapshot });

    render(<DashboardApp client={client} />);

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh collection' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The extension background service is unavailable.',
    );
    expect(screen.getByRole('heading', { name: issueTitle })).toBeVisible();
  });

  it('searches saved items by repository, number, and title', async () => {
    render(
      <DashboardApp
        client={createClient({
          getSnapshot: vi
            .fn<BackgroundClient['getSnapshot']>()
            .mockResolvedValue(populatedSnapshot),
        })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();
    const search = screen.getByLabelText('Search');

    fireEvent.change(search, { target: { value: 'octocat' } });

    expect(
      screen.getByRole('heading', { name: 'Title unavailable' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: issueTitle }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: pullRequestTitle }),
    ).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: '54321' } });

    expect(
      screen.getByRole('heading', { name: pullRequestTitle }),
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Title unavailable' }),
    ).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'FIX CALLBACK' } });

    expect(
      screen.getByRole('heading', { name: pullRequestTitle }),
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: issueTitle }),
    ).not.toBeInTheDocument();
  });

  it('filters by type and state while keeping total counts', async () => {
    render(
      <DashboardApp
        client={createClient({
          getSnapshot: vi
            .fn<BackgroundClient['getSnapshot']>()
            .mockResolvedValue(populatedSnapshot),
        })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();
    expect(
      screen.getByRole('group', { name: 'Saved issues: 2' }),
    ).toBeVisible();

    const type = screen.getByLabelText('Type');
    const state = screen.getByLabelText('State');

    fireEvent.change(type, { target: { value: 'issue' } });

    expect(
      screen.queryByRole('heading', { name: 'Pull requests' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Issues' })).toBeVisible();
    expect(
      within(state).queryByRole('option', { name: 'Draft' }),
    ).not.toBeInTheDocument();

    fireEvent.change(type, { target: { value: 'pull_request' } });
    expect(
      within(state).getByRole('option', { name: 'Draft' }),
    ).toBeVisible();
    fireEvent.change(state, { target: { value: 'draft' } });

    expect(
      screen.queryByRole('heading', { name: 'Issues' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: pullRequestTitle }),
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: issueTitle }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Saved issues: 2' }),
    ).toBeVisible();
    expect(screen.getByText('1 of 1')).toBeVisible();

    fireEvent.change(type, { target: { value: 'issue' } });
    expect(state).toHaveValue('all');
  });

  it('removes a saved issue after confirmation and updates the view', async () => {
    const removeIssue = vi
      .fn<BackgroundClient['removeIssue']>()
      .mockResolvedValue({ issueId: issue.id });
    render(
      <DashboardApp
        client={createClient({
          getSnapshot: vi
            .fn<BackgroundClient['getSnapshot']>()
            .mockResolvedValue(populatedSnapshot),
          removeIssue,
        })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Remove Microsoft/TypeScript#12345 and its note',
      }),
    );
    expect(screen.getByText('Remove this issue and its note?')).toBeVisible();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Confirm removing Microsoft/TypeScript#12345',
      }),
    );

    expect(
      await screen.findByText('The issue and any private note were removed.'),
    ).toBeVisible();
    expect(removeIssue).toHaveBeenCalledWith(issue.id);
    expect(
      screen.queryByRole('heading', { name: issueTitle }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Saved issues: 1' }),
    ).toBeVisible();
    expect(screen.getByRole('group', { name: 'Private notes: 0' })).toBeVisible();
  });

  it('cancels issue removal without writing', async () => {
    const removeIssue = vi.fn<BackgroundClient['removeIssue']>();
    render(
      <DashboardApp
        client={createClient({
          getSnapshot: vi
            .fn<BackgroundClient['getSnapshot']>()
            .mockResolvedValue(populatedSnapshot),
          removeIssue,
        })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Remove Microsoft/TypeScript#12345 and its note',
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Cancel removing Microsoft/TypeScript#12345',
      }),
    );

    expect(removeIssue).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { name: issueTitle }),
    ).toBeVisible();
  });

  it('keeps the issue and confirmation visible when removal fails', async () => {
    const removeIssue = vi
      .fn<BackgroundClient['removeIssue']>()
      .mockRejectedValue(
        new BackgroundClientError(
          'command-failed',
          'ContribFlow storage is unavailable.',
        ),
      );
    render(
      <DashboardApp
        client={createClient({
          getSnapshot: vi
            .fn<BackgroundClient['getSnapshot']>()
            .mockResolvedValue(populatedSnapshot),
          removeIssue,
        })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Remove Microsoft/TypeScript#12345 and its note',
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Confirm removing Microsoft/TypeScript#12345',
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'ContribFlow storage is unavailable.',
    );
    expect(
      screen.getByRole('heading', { name: issueTitle }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: 'Confirm removing Microsoft/TypeScript#12345',
      }),
    ).toBeEnabled();
  });

  it('prevents duplicate issue removals while the request is pending', async () => {
    const pendingRemoval = deferred<{ issueId: string }>();
    const removeIssue = vi
      .fn<BackgroundClient['removeIssue']>()
      .mockReturnValue(pendingRemoval.promise);
    render(
      <DashboardApp
        client={createClient({
          getSnapshot: vi
            .fn<BackgroundClient['getSnapshot']>()
            .mockResolvedValue(populatedSnapshot),
          removeIssue,
        })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Remove Microsoft/TypeScript#12345 and its note',
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Confirm removing Microsoft/TypeScript#12345',
      }),
    );

    expect(
      screen.getByRole('button', { name: 'Removing issue...' }),
    ).toBeDisabled();
    expect(removeIssue).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingRemoval.resolve({ issueId: issue.id });
      await pendingRemoval.promise;
    });

    expect(
      await screen.findByText('The issue and any private note were removed.'),
    ).toBeVisible();
    expect(removeIssue).toHaveBeenCalledTimes(1);
  });

  it('untracks a pull request after confirmation and updates the view', async () => {
    const removePullRequest = vi
      .fn<BackgroundClient['removePullRequest']>()
      .mockResolvedValue({ pullRequestId: pullRequest.id });
    render(
      <DashboardApp
        client={createClient({
          getSnapshot: vi
            .fn<BackgroundClient['getSnapshot']>()
            .mockResolvedValue(populatedSnapshot),
          removePullRequest,
        })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: pullRequestTitle }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Untrack Microsoft/TypeScript#54321',
      }),
    );
    expect(screen.getByText('Untrack this pull request?')).toBeVisible();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Confirm untracking Microsoft/TypeScript#54321',
      }),
    );

    expect(
      await screen.findByText('The pull request was untracked.'),
    ).toBeVisible();
    expect(removePullRequest).toHaveBeenCalledWith(pullRequest.id);
    expect(
      screen.queryByRole('heading', { name: pullRequestTitle }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Tracked pull requests: 0' }),
    ).toBeVisible();
  });

  it('shows a no-match state and clears filters', async () => {
    render(
      <DashboardApp
        client={createClient({
          getSnapshot: vi
            .fn<BackgroundClient['getSnapshot']>()
            .mockResolvedValue(populatedSnapshot),
        })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();

    fireEvent.change(screen.getByLabelText('Search'), {
      target: { value: 'no-such-item' },
    });

    expect(
      screen.getByRole('heading', { name: 'No items match your filters' }),
    ).toBeVisible();

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);

    expect(screen.getByRole('heading', { name: issueTitle })).toBeVisible();
    expect(screen.getByLabelText('Search')).toHaveValue('');
  });
});
