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
import type {
  StorageChangeSummary,
  StorageSnapshot,
} from '../../storage/repository';
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

const secondIssue: SavedIssue = {
  ...issue,
  id: 'microsoft/typescript#9999',
  number: 9999,
  url: 'https://github.com/Microsoft/TypeScript/issues/9999',
  title: 'Second saved issue',
  savedAt: '2026-10-19T11:00:00.000Z',
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
    saveNote: vi.fn<BackgroundClient['saveNote']>(),
    deleteNote: vi.fn<BackgroundClient['deleteNote']>(),
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

function createStorageSubscription() {
  const listeners: Array<(change: StorageChangeSummary) => void> = [];

  return {
    subscribe: (listener: (change: StorageChangeSummary) => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      };
    },
    emit(changedKeys: string[]): void {
      for (const listener of [...listeners]) {
        listener({ changedKeys });
      }
    },
  };
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

  it('refreshes the dashboard when ContribFlow storage changes', async () => {
    const updatedSnapshot: StorageSnapshot = {
      ...populatedSnapshot,
      issues: [...populatedSnapshot.issues, secondIssue],
      warnings: [],
    };
    const getSnapshot = vi
      .fn<BackgroundClient['getSnapshot']>()
      .mockResolvedValueOnce(populatedSnapshot)
      .mockResolvedValueOnce(updatedSnapshot);
    const subscription = createStorageSubscription();
    render(
      <DashboardApp
        client={createClient({ getSnapshot })}
        subscribeToChanges={subscription.subscribe}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Second saved issue' }),
    ).not.toBeInTheDocument();

    await act(async () => {
      subscription.emit(['contribflow.v1.issue.new']);
    });

    expect(
      await screen.findByRole('heading', { name: 'Second saved issue' }),
    ).toBeVisible();
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('ignores storage changes outside ContribFlow', async () => {
    const updatedSnapshot: StorageSnapshot = {
      ...populatedSnapshot,
      issues: [...populatedSnapshot.issues, secondIssue],
    };
    const getSnapshot = vi
      .fn<BackgroundClient['getSnapshot']>()
      .mockResolvedValueOnce(populatedSnapshot)
      .mockResolvedValueOnce(updatedSnapshot);
    const subscription = createStorageSubscription();
    render(
      <DashboardApp
        client={createClient({ getSnapshot })}
        subscribeToChanges={subscription.subscribe}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();

    await act(async () => {
      subscription.emit(['unrelated-key']);
    });
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('heading', { name: 'Second saved issue' }),
    ).not.toBeInTheDocument();

    await act(async () => {
      subscription.emit(['contribflow.v1.issue.new']);
    });
    expect(
      await screen.findByRole('heading', { name: 'Second saved issue' }),
    ).toBeVisible();
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('surfaces a live reload failure without hiding current data', async () => {
    const getSnapshot = vi
      .fn<BackgroundClient['getSnapshot']>()
      .mockResolvedValueOnce(populatedSnapshot)
      .mockRejectedValueOnce(
        new BackgroundClientError(
          'messaging-unavailable',
          'Could not reach the extension background.',
        ),
      );
    const subscription = createStorageSubscription();
    render(
      <DashboardApp
        client={createClient({ getSnapshot })}
        subscribeToChanges={subscription.subscribe}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();

    await act(async () => {
      subscription.emit(['contribflow.v1.issue.new']);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Saved data could not be updated: Could not reach the extension background.',
    );
    expect(screen.getByRole('heading', { name: issueTitle })).toBeVisible();
  });

  it('unsubscribes from storage changes on unmount', async () => {
    const unsubscribe = vi.fn();
    const subscribeToChanges = vi.fn(() => unsubscribe);
    const rendered = render(
      <DashboardApp
        client={createClient()}
        subscribeToChanges={subscribeToChanges}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: 'Your workspace is empty' }),
    ).toBeVisible();

    rendered.unmount();

    expect(subscribeToChanges).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
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

  it('renders the support development link', async () => {
    render(<DashboardApp client={createClient()} />);

    expect(
      await screen.findByRole('heading', { name: 'Your workspace is empty' }),
    ).toBeVisible();

    const supportLink = screen.getByRole('link', {
      name: 'Support development ☕',
    });
    expect(supportLink).toBeVisible();
    expect(supportLink).toHaveAttribute(
      'href',
      'https://buymeacoffee.com/rabindra789',
    );
    expect(supportLink).toHaveAttribute('target', '_blank');
    expect(supportLink).toHaveAttribute('rel', 'noopener noreferrer');
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
    expect(screen.getByText(note.body)).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: 'Edit note for Microsoft/TypeScript#12345',
      }),
    ).toBeVisible();

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

  it('renders orphan-note warning without deleting the note', async () => {
    const orphanNoteSnapshot: StorageSnapshot = {
      issues: [],
      pullRequests: [],
      notes: {
        'octocat/hello-world#999': {
          issueId: 'octocat/hello-world#999',
          body: 'Orphan note',
          createdAt: '2026-10-19T12:00:00.000Z',
          updatedAt: '2026-10-19T12:00:00.000Z',
        },
      },
      warnings: [
        {
          kind: 'orphan-note',
          issueId: 'octocat/hello-world#999',
        },
      ],
    };
    const client = createClient({
      getSnapshot: vi
        .fn<BackgroundClient['getSnapshot']>()
        .mockResolvedValue(orphanNoteSnapshot),
    });
    render(<DashboardApp client={client} />);

    expect(
      await screen.findByRole('heading', { name: 'Storage warnings' }),
    ).toBeVisible();
    expect(
      screen.getByText('Note for octocat/hello-world#999 has no saved issue and was skipped.'),
    ).toBeVisible();
    // The orphan note should remain in storage (not deleted). The snapshot still contains the note.
    // We can't directly inspect storage here, but the warning is shown without deleting the note.
    // The note is not displayed in the UI because its issue is missing.
    expect(screen.queryByText('Orphan note')).not.toBeInTheDocument();
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

  it('refreshes a tracked pull request and shows the updated state', async () => {
    const refreshedPullRequest: TrackedPullRequest = {
      ...pullRequest,
      state: 'merged',
      lastSyncedAt: '2026-10-20T12:10:00.000Z',
      lastSyncError: null,
    };
    const refreshPullRequest = vi
      .fn<BackgroundClient['refreshPullRequest']>()
      .mockResolvedValue({ pullRequest: refreshedPullRequest });
    render(
      <DashboardApp
        client={createClient({
          getSnapshot: vi
            .fn<BackgroundClient['getSnapshot']>()
            .mockResolvedValue(populatedSnapshot),
          refreshPullRequest,
        })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: pullRequestTitle }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Refresh Microsoft/TypeScript#54321 from GitHub',
      }),
    );

    expect(
      await screen.findByText('The pull request was refreshed from GitHub.'),
    ).toBeVisible();
    expect(refreshPullRequest).toHaveBeenCalledWith(pullRequest.url);
    expect(screen.getByText('Last known: Merged')).toBeVisible();
    expect(screen.getByText('2026-10-20 12:10 UTC')).toBeVisible();
  });

  it('keeps the last known PR state and surfaces refresh errors', async () => {
    const syncError =
      'GitHub rate limit reached. Try again in 60 seconds.';
    const failedSnapshot: StorageSnapshot = {
      ...populatedSnapshot,
      pullRequests: [{ ...pullRequest, lastSyncError: syncError }],
    };
    const getSnapshot = vi
      .fn<BackgroundClient['getSnapshot']>()
      .mockResolvedValueOnce(populatedSnapshot)
      .mockResolvedValueOnce(failedSnapshot);
    const refreshPullRequest = vi
      .fn<BackgroundClient['refreshPullRequest']>()
      .mockRejectedValue(
        new BackgroundClientError('command-failed', syncError, {
          code: 'rate-limited',
          message: syncError,
          status: 429,
          retryAfterSeconds: 60,
        }),
      );
    render(
      <DashboardApp
        client={createClient({ getSnapshot, refreshPullRequest })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: pullRequestTitle }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Refresh Microsoft/TypeScript#54321 from GitHub',
      }),
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`Refresh failed: ${syncError}`);
    expect(alert).toHaveTextContent('The last known state is still shown.');
    expect(screen.getByText('Last known: Draft')).toBeVisible();
    expect(screen.queryByText('Last known: Merged')).not.toBeInTheDocument();
    expect(screen.getAllByText('Last sync failed').length).toBeGreaterThan(0);
    expect(screen.getAllByText(syncError).length).toBeGreaterThan(0);
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('prevents duplicate PR refreshes while the request is pending', async () => {
    const pendingRefresh = deferred<
      Awaited<ReturnType<BackgroundClient['refreshPullRequest']>>
    >();
    const refreshPullRequest = vi
      .fn<BackgroundClient['refreshPullRequest']>()
      .mockReturnValue(pendingRefresh.promise);
    render(
      <DashboardApp
        client={createClient({
          getSnapshot: vi
            .fn<BackgroundClient['getSnapshot']>()
            .mockResolvedValue(populatedSnapshot),
          refreshPullRequest,
        })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: pullRequestTitle }),
    ).toBeVisible();
    const refreshButton = screen.getByRole('button', {
      name: 'Refresh Microsoft/TypeScript#54321 from GitHub',
    });
    fireEvent.click(refreshButton);
    fireEvent.click(refreshButton);

    expect(refreshPullRequest).toHaveBeenCalledTimes(1);
    expect(refreshButton).toBeDisabled();
    expect(refreshButton).toHaveTextContent('Refreshing...');

    await act(async () => {
      pendingRefresh.resolve({
        pullRequest: {
          ...pullRequest,
          state: 'merged',
          lastSyncedAt: '2026-10-20T12:10:00.000Z',
        },
      });
      await pendingRefresh.promise;
    });

    expect(
      await screen.findByText('The pull request was refreshed from GitHub.'),
    ).toBeVisible();
    expect(refreshPullRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Last known: Merged')).toBeVisible();
  });

  it('refreshes an issue and shows the updated state', async () => {
    const refreshedIssue: SavedIssue = {
      ...issue,
      title: 'Refreshed issue title',
      state: 'closed',
      lastSyncedAt: '2026-10-20T12:10:00.000Z',
      lastSyncError: null,
    };
    const refreshIssue = vi
      .fn<BackgroundClient['refreshIssue']>()
      .mockResolvedValue({ issue: refreshedIssue });
    render(
      <DashboardApp
        client={createClient({
          getSnapshot: vi
            .fn<BackgroundClient['getSnapshot']>()
            .mockResolvedValue(populatedSnapshot),
          refreshIssue,
        })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Refresh Microsoft/TypeScript#12345 from GitHub',
      }),
    );

    expect(
      await screen.findByText('The issue was refreshed from GitHub.'),
    ).toBeVisible();
    expect(refreshIssue).toHaveBeenCalledWith(issue.url);
    expect(screen.getByText('Last known: Closed')).toBeVisible();
    expect(screen.getByText('2026-10-20 12:10 UTC')).toBeVisible();
  });

  it('keeps the last known issue state and surfaces refresh errors', async () => {
    const syncError =
      'GitHub rate limit reached. Try again in 60 seconds.';
    const failedSnapshot: StorageSnapshot = {
      ...populatedSnapshot,
      issues: [{ ...issue, lastSyncError: syncError }],
    };
    const getSnapshot = vi
      .fn<BackgroundClient['getSnapshot']>()
      .mockResolvedValueOnce(populatedSnapshot)
      .mockResolvedValueOnce(failedSnapshot);
    const refreshIssue = vi
      .fn<BackgroundClient['refreshIssue']>()
      .mockRejectedValue(
        new BackgroundClientError('command-failed', syncError, {
          code: 'rate-limited',
          message: syncError,
          status: 429,
          retryAfterSeconds: 60,
        }),
      );
    render(
      <DashboardApp
        client={createClient({ getSnapshot, refreshIssue })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Refresh Microsoft/TypeScript#12345 from GitHub',
      }),
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`Refresh failed: ${syncError}`);
    expect(alert).toHaveTextContent('The last known state is still shown.');
    expect(screen.getByText('Last known: Open')).toBeVisible();
    expect(screen.queryByText('Last known: Closed')).not.toBeInTheDocument();
    expect(screen.getAllByText('Last sync failed').length).toBeGreaterThan(0);
    expect(screen.getAllByText(syncError).length).toBeGreaterThan(0);
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('clears a pre-existing lastSyncError on successful refresh', async () => {
    const issueWithError: SavedIssue = {
      ...issue,
      lastSyncError: 'Previous sync failed.',
    };
    const snapshotWithError: StorageSnapshot = {
      ...populatedSnapshot,
      issues: [issueWithError, unsyncedIssue],
    };
    const refreshedIssue: SavedIssue = {
      ...issueWithError,
      title: 'Refreshed issue title',
      state: 'closed',
      lastSyncedAt: '2026-10-20T12:10:00.000Z',
      lastSyncError: null,
    };
    const getSnapshot = vi
      .fn<BackgroundClient['getSnapshot']>()
      .mockResolvedValueOnce(snapshotWithError)
      .mockResolvedValueOnce({
        ...snapshotWithError,
        issues: [{ ...refreshedIssue }, unsyncedIssue],
      });
    const refreshIssue = vi
      .fn<BackgroundClient['refreshIssue']>()
      .mockResolvedValue({ issue: refreshedIssue });
    render(
      <DashboardApp
        client={createClient({ getSnapshot, refreshIssue })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();
    // Ensure the pre-existing error is present initially
    expect(screen.getByText('Previous sync failed.')).toBeVisible();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Refresh Microsoft/TypeScript#12345 from GitHub',
      }),
    );

    expect(
      await screen.findByText('The issue was refreshed from GitHub.'),
    ).toBeVisible();
    expect(screen.queryByText('Previous sync failed.')).not.toBeInTheDocument();
    // The unsynced issue still has its error, so one 'Last sync failed' remains
    expect(screen.getAllByText('Last sync failed').length).toBe(1);
    expect(screen.getByText('Last known: Closed')).toBeVisible();
    expect(screen.getByText('2026-10-20 12:10 UTC')).toBeVisible();
  });

  it('prevents duplicate issue refreshes while the request is pending', async () => {
    const pendingRefresh = deferred<
      Awaited<ReturnType<BackgroundClient['refreshIssue']>>
    >();
    const refreshIssue = vi
      .fn<BackgroundClient['refreshIssue']>()
      .mockReturnValue(pendingRefresh.promise);
    render(
      <DashboardApp
        client={createClient({
          getSnapshot: vi
            .fn<BackgroundClient['getSnapshot']>()
            .mockResolvedValue(populatedSnapshot),
          refreshIssue,
        })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();
    const refreshButton = screen.getByRole('button', {
      name: 'Refresh Microsoft/TypeScript#12345 from GitHub',
    });
    fireEvent.click(refreshButton);
    fireEvent.click(refreshButton);

    expect(refreshIssue).toHaveBeenCalledTimes(1);
    expect(refreshButton).toBeDisabled();
    expect(refreshButton).toHaveTextContent('Refreshing...');

    await act(async () => {
      pendingRefresh.resolve({
        issue: {
          ...issue,
          title: 'Refreshed issue title',
          state: 'closed',
          lastSyncedAt: '2026-10-20T12:10:00.000Z',
        },
      });
      await pendingRefresh.promise;
    });

    expect(
      await screen.findByText('The issue was refreshed from GitHub.'),
    ).toBeVisible();
    expect(refreshIssue).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Last known: Closed')).toBeVisible();
  });

  it('shows per-issue pending state during refresh', async () => {
    const pendingRefresh = deferred<
      Awaited<ReturnType<BackgroundClient['refreshIssue']>>
    >();
    const refreshIssue = vi
      .fn<BackgroundClient['refreshIssue']>()
      .mockReturnValue(pendingRefresh.promise);
    render(
      <DashboardApp
        client={createClient({
          getSnapshot: vi
            .fn<BackgroundClient['getSnapshot']>()
            .mockResolvedValue(populatedSnapshot),
          refreshIssue,
        })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();
    // The second issue (unsynced) also has a refresh button
    const secondRefreshButton = screen.getByRole('button', {
      name: 'Refresh octocat/Hello-World#42 from GitHub',
    });

    const firstRefreshButton = screen.getByRole('button', {
      name: 'Refresh Microsoft/TypeScript#12345 from GitHub',
    });
    fireEvent.click(firstRefreshButton);

    expect(firstRefreshButton).toHaveTextContent('Refreshing...');
    expect(secondRefreshButton).not.toHaveTextContent('Refreshing...');
    expect(secondRefreshButton).toHaveTextContent('Refresh');

    await act(async () => {
      pendingRefresh.resolve({
        issue: {
          ...issue,
          title: 'Refreshed issue title',
          state: 'closed',
          lastSyncedAt: '2026-10-20T12:10:00.000Z',
        },
      });
      await pendingRefresh.promise;
    });

    expect(
      await screen.findByText('The issue was refreshed from GitHub.'),
    ).toBeVisible();
  });

  it('adds a private note and displays it with the issue', async () => {
    const createdNote: IssueNote = {
      ...note,
      body: 'New private note',
      createdAt: '2026-10-20T12:00:00.000Z',
      updatedAt: '2026-10-20T12:00:00.000Z',
    };
    const saveNote = vi
      .fn<BackgroundClient['saveNote']>()
      .mockResolvedValue({ note: createdNote });
    render(
      <DashboardApp
        client={createClient({
          getSnapshot: vi
            .fn<BackgroundClient['getSnapshot']>()
            .mockResolvedValue({ ...emptySnapshot, issues: [issue] }),
          saveNote,
        })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Add note for Microsoft/TypeScript#12345',
      }),
    );

    const noteField = screen.getByLabelText('Note');
    const saveButton = screen.getByRole('button', { name: 'Save note' });
    expect(noteField).toHaveValue('');
    expect(saveButton).toBeDisabled();

    fireEvent.change(noteField, { target: { value: '   ' } });
    expect(saveButton).toBeDisabled();

    fireEvent.change(noteField, { target: { value: createdNote.body } });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    expect(
      await screen.findByText('The private note was added.'),
    ).toBeVisible();
    expect(saveNote).toHaveBeenCalledWith(issue.id, createdNote.body, null);
    expect(screen.getByText(createdNote.body)).toBeVisible();
    expect(screen.getByRole('group', { name: 'Private notes: 1' })).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: 'Edit note for Microsoft/TypeScript#12345',
      }),
    ).toBeVisible();
  });

  it('edits an existing note using its revision token', async () => {
    const updatedNote: IssueNote = {
      ...note,
      body: 'Updated private note',
      updatedAt: '2026-10-20T12:05:00.000Z',
    };
    const saveNote = vi
      .fn<BackgroundClient['saveNote']>()
      .mockResolvedValue({ note: updatedNote });
    render(
      <DashboardApp
        client={createClient({
          getSnapshot: vi
            .fn<BackgroundClient['getSnapshot']>()
            .mockResolvedValue(populatedSnapshot),
          saveNote,
        })}
      />,
    );

    expect(await screen.findByText(note.body)).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit note for Microsoft/TypeScript#12345',
      }),
    );
    const noteField = screen.getByLabelText('Note');
    expect(noteField).toHaveValue(note.body);

    fireEvent.change(noteField, { target: { value: updatedNote.body } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));

    expect(
      await screen.findByText('The private note was saved.'),
    ).toBeVisible();
    expect(saveNote).toHaveBeenCalledWith(
      issue.id,
      updatedNote.body,
      note.updatedAt,
    );
    expect(screen.getByText(updatedNote.body)).toBeVisible();
  });

  it('keeps an unsaved note draft when the write conflicts', async () => {
    const conflictMessage =
      'This note changed in another view. Refresh the collection before trying again.';
    const saveNote = vi
      .fn<BackgroundClient['saveNote']>()
      .mockRejectedValue(
        new BackgroundClientError('command-failed', conflictMessage, {
          code: 'note-conflict',
          message: conflictMessage,
        }),
      );
    render(
      <DashboardApp
        client={createClient({
          getSnapshot: vi
            .fn<BackgroundClient['getSnapshot']>()
            .mockResolvedValue(populatedSnapshot),
          saveNote,
        })}
      />,
    );

    expect(await screen.findByText(note.body)).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit note for Microsoft/TypeScript#12345',
      }),
    );
    const noteField = screen.getByLabelText('Note');
    fireEvent.change(noteField, { target: { value: 'My unsaved draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(conflictMessage);
    expect(screen.getByLabelText('Note')).toHaveValue('My unsaved draft');
    expect(screen.getByRole('button', { name: 'Save note' })).toBeEnabled();
    expect(screen.getByRole('group', { name: 'Private notes: 1' })).toBeVisible();
  });

  it('prevents duplicate note submissions while saving', async () => {
    const pendingSave = deferred<
      Awaited<ReturnType<BackgroundClient['saveNote']>>
    >();
    const saveNote = vi
      .fn<BackgroundClient['saveNote']>()
      .mockReturnValue(pendingSave.promise);
    render(
      <DashboardApp
        client={createClient({
          getSnapshot: vi
            .fn<BackgroundClient['getSnapshot']>()
            .mockResolvedValue({ ...emptySnapshot, issues: [issue] }),
          saveNote,
        })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Add note for Microsoft/TypeScript#12345',
      }),
    );
    fireEvent.change(screen.getByLabelText('Note'), {
      target: { value: 'Pending note' },
    });
    const saveButton = screen.getByRole('button', { name: 'Save note' });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();

    await act(async () => {
      pendingSave.resolve({ note: { ...note, body: 'Pending note' } });
      await pendingSave.promise;
    });

    expect(
      await screen.findByText('The private note was added.'),
    ).toBeVisible();
    expect(saveNote).toHaveBeenCalledTimes(1);
  });

  it('deletes a note after confirmation', async () => {
    const deleteNote = vi
      .fn<BackgroundClient['deleteNote']>()
      .mockResolvedValue({ issueId: issue.id });
    render(
      <DashboardApp
        client={createClient({
          getSnapshot: vi
            .fn<BackgroundClient['getSnapshot']>()
            .mockResolvedValue(populatedSnapshot),
          deleteNote,
        })}
      />,
    );

    expect(await screen.findByText(note.body)).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit note for Microsoft/TypeScript#12345',
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Delete note for Microsoft/TypeScript#12345',
      }),
    );
    expect(screen.getByText('Delete this private note?')).toBeVisible();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Confirm deleting note for Microsoft/TypeScript#12345',
      }),
    );

    expect(
      await screen.findByText('The private note was deleted.'),
    ).toBeVisible();
    expect(deleteNote).toHaveBeenCalledWith(issue.id, note.updatedAt);
    expect(screen.queryByText(note.body)).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Private notes: 0' })).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: 'Add note for Microsoft/TypeScript#12345',
      }),
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
