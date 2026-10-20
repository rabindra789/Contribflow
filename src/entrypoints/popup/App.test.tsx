import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type {
  GitHubTarget,
  SavedIssue,
  TrackedPullRequest,
} from '../../domain/models';
import type { ActiveTargetResult } from '../../lib/active-target';
import {
  UNSUPPORTED_ACTIVE_PAGE_MESSAGE,
} from '../../lib/active-target';
import {
  BackgroundClientError,
  type BackgroundClient,
} from '../../messaging/background-client';
import type { CommandError } from '../../messaging/contracts';
import type { StorageSnapshot } from '../../storage/repository';
import { PopupApp } from './App';

const issueTarget: GitHubTarget = {
  kind: 'issue',
  owner: 'Microsoft',
  repo: 'TypeScript',
  number: 12345,
  url: 'https://github.com/Microsoft/TypeScript/issues/12345',
  id: 'microsoft/typescript#12345',
};

const pullRequestTarget: GitHubTarget = {
  kind: 'pull_request',
  owner: 'Microsoft',
  repo: 'TypeScript',
  number: 54321,
  url: 'https://github.com/Microsoft/TypeScript/pull/54321',
  id: 'microsoft/typescript#54321',
};

const issueTitle = 'Improve inference for generic callbacks';

const issue: SavedIssue = {
  id: issueTarget.id,
  owner: issueTarget.owner,
  repo: issueTarget.repo,
  number: issueTarget.number,
  url: issueTarget.url,
  title: issueTitle,
  state: 'open',
  savedAt: '2026-10-19T09:15:00.000Z',
  lastSyncedAt: '2026-10-19T09:15:02.120Z',
  lastSyncError: null,
};

const unsyncedIssue: SavedIssue = {
  ...issue,
  title: null,
  state: 'unknown',
  lastSyncedAt: null,
  lastSyncError: 'GitHub metadata sync failed.',
};

const pullRequest: TrackedPullRequest = {
  id: pullRequestTarget.id,
  owner: pullRequestTarget.owner,
  repo: pullRequestTarget.repo,
  number: pullRequestTarget.number,
  url: pullRequestTarget.url,
  title: 'Fix callback inference',
  state: 'draft',
  addedAt: '2026-10-19T10:00:00.000Z',
  lastSyncedAt: '2026-10-19T10:00:01.000Z',
  lastSyncError: null,
};

const emptySnapshot: StorageSnapshot = {
  issues: [],
  pullRequests: [],
  notes: {},
  warnings: [],
};

const issueSnapshot: StorageSnapshot = {
  ...emptySnapshot,
  issues: [issue],
};

function supported(target: GitHubTarget): ActiveTargetResult {
  return { status: 'supported', target };
}

function createClient(overrides: Partial<BackgroundClient> = {}): BackgroundClient {
  return {
    getSnapshot: vi.fn<BackgroundClient['getSnapshot']>().mockResolvedValue(emptySnapshot),
    saveIssue: vi.fn<BackgroundClient['saveIssue']>(),
    refreshIssue: vi.fn<BackgroundClient['refreshIssue']>(),
    removeIssue: vi.fn<BackgroundClient['removeIssue']>(),
    trackPullRequest: vi.fn<BackgroundClient['trackPullRequest']>(),
    refreshPullRequest: vi.fn<BackgroundClient['refreshPullRequest']>(),
    removePullRequest: vi.fn<BackgroundClient['removePullRequest']>(),
    ...overrides,
  };
}

function renderPopup(
  detection: ActiveTargetResult,
  client: BackgroundClient,
): ReturnType<typeof vi.fn<() => Promise<ActiveTargetResult>>> {
  const detectTarget = vi
    .fn<() => Promise<ActiveTargetResult>>()
    .mockResolvedValue(detection);
  render(<PopupApp client={client} detectTarget={detectTarget} />);
  return detectTarget;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function commandError(message: string): CommandError {
  return { code: 'network', message };
}

describe('popup workflow', () => {
  it('shows a loading state until the active target is resolved', async () => {
    const pendingDetection = deferred<ActiveTargetResult>();
    const client = createClient();
    const detectTarget = vi
      .fn<() => Promise<ActiveTargetResult>>()
      .mockReturnValue(pendingDetection.promise);

    render(<PopupApp client={client} detectTarget={detectTarget} />);

    expect(screen.getByText('Checking the active tab...')).toBeVisible();

    await act(async () => {
      pendingDetection.resolve(supported(issueTarget));
      await pendingDetection.promise;
    });

    expect(
      await screen.findByRole('heading', {
        name: 'Microsoft/TypeScript#12345',
      }),
    ).toBeVisible();
    expect(screen.queryByText('Checking the active tab...')).not.toBeInTheDocument();
  });

  it('shows guidance without reading storage on an unsupported page', async () => {
    const client = createClient();
    const detectTarget = renderPopup(
      { status: 'unsupported', message: UNSUPPORTED_ACTIVE_PAGE_MESSAGE },
      client,
    );

    expect(
      await screen.findByRole('heading', { name: 'No supported GitHub page' }),
    ).toBeVisible();
    expect(screen.getByText(UNSUPPORTED_ACTIVE_PAGE_MESSAGE)).toBeVisible();
    expect(client.getSnapshot).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));

    expect(screen.getByText('Checking the active tab...')).toBeVisible();
    await waitFor(() => expect(detectTarget).toHaveBeenCalledTimes(2));
  });

  it('shows the missing-tab message', async () => {
    const message = 'No active tab URL is available.';
    renderPopup({ status: 'missing', message }, createClient());

    expect(await screen.findByText(message)).toBeVisible();
    expect(
      screen.getByText(
        'Open a GitHub issue or pull request in this tab, then reopen ContribFlow.',
      ),
    ).toBeVisible();
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
    renderPopup(supported(issueTarget), client);

    expect(
      await screen.findByRole('heading', { name: 'Saved data unavailable' }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The extension returned an unexpected response.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByRole('heading', {
        name: 'Microsoft/TypeScript#12345',
      }),
    ).toBeVisible();
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('saves an unsaved issue and updates the popup state', async () => {
    const saveIssue = vi
      .fn<BackgroundClient['saveIssue']>()
      .mockResolvedValue({ issue, created: true, syncError: null });
    const client = createClient({ saveIssue });
    renderPopup(supported(issueTarget), client);

    expect(await screen.findByText('Not saved')).toBeVisible();
    const link = screen.getByRole('link', { name: 'View on GitHub' });
    expect(link).toHaveAttribute('href', issueTarget.url);
    expect(link).toHaveAttribute('rel', 'noreferrer');

    fireEvent.click(screen.getByRole('button', { name: 'Save issue' }));

    expect(await screen.findByText('The issue was saved.')).toBeVisible();
    expect(saveIssue).toHaveBeenCalledWith(issueTarget.url);
    expect(screen.getByText('Saved')).toBeVisible();
    expect(screen.getByText(issueTitle)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove issue' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save issue' })).not.toBeInTheDocument();
  });

  it('tracks an untracked pull request and untracks it', async () => {
    const trackPullRequest = vi
      .fn<BackgroundClient['trackPullRequest']>()
      .mockResolvedValue({ pullRequest, created: true, syncError: null });
    const removePullRequest = vi
      .fn<BackgroundClient['removePullRequest']>()
      .mockResolvedValue({ pullRequestId: pullRequest.id });
    const client = createClient({ trackPullRequest, removePullRequest });
    renderPopup(supported(pullRequestTarget), client);

    expect(await screen.findByText('Not tracked')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Track pull request' }));

    expect(await screen.findByText('The pull request was tracked.')).toBeVisible();
    expect(trackPullRequest).toHaveBeenCalledWith(pullRequestTarget.url);
    expect(screen.getByText('Tracked')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Untrack pull request' }));

    expect(await screen.findByText('The pull request was untracked.')).toBeVisible();
    expect(removePullRequest).toHaveBeenCalledWith(pullRequest.id);
    expect(screen.getByText('Not tracked')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Track pull request' }),
    ).toBeVisible();
  });

  it('removes a saved issue from storage and the local view', async () => {
    const removeIssue = vi
      .fn<BackgroundClient['removeIssue']>()
      .mockResolvedValue({ issueId: issue.id });
    const client = createClient({
      getSnapshot: vi
        .fn<BackgroundClient['getSnapshot']>()
        .mockResolvedValue(issueSnapshot),
      removeIssue,
    });
    renderPopup(supported(issueTarget), client);

    expect(
      await screen.findByRole('heading', { name: issueTitle }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove issue' }));

    expect(await screen.findByText('The issue was removed.')).toBeVisible();
    expect(removeIssue).toHaveBeenCalledWith(issue.id);
    expect(screen.getByText('Not saved')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save issue' })).toBeVisible();
  });

  it('shows a saved record when GitHub metadata is unavailable and retries it', async () => {
    const refreshIssue = vi.fn<BackgroundClient['refreshIssue']>().mockResolvedValue({
      issue,
    });
    const client = createClient({
      getSnapshot: vi
        .fn<BackgroundClient['getSnapshot']>()
        .mockResolvedValue({ ...emptySnapshot, issues: [unsyncedIssue] }),
      refreshIssue,
    });
    renderPopup(supported(issueTarget), client);

    expect(await screen.findByText('Metadata unavailable')).toBeVisible();
    expect(screen.getByText(unsyncedIssue.lastSyncError ?? '')).toBeVisible();
    expect(screen.getByText('Unknown')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Retry metadata' }));

    expect(await screen.findByText('GitHub metadata was refreshed.')).toBeVisible();
    expect(refreshIssue).toHaveBeenCalledWith(issueTarget.url);
    expect(screen.getByRole('heading', { name: issueTitle })).toBeVisible();
    expect(screen.queryByText('Metadata unavailable')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry metadata' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the saved reference and shows an error when a mutation fails', async () => {
    const error = new BackgroundClientError(
      'command-failed',
      'GitHub is temporarily unavailable.',
      commandError('GitHub is temporarily unavailable.'),
    );
    const saveIssue = vi
      .fn<BackgroundClient['saveIssue']>()
      .mockRejectedValue(error);
    const client = createClient({ saveIssue });
    renderPopup(supported(issueTarget), client);

    expect(await screen.findByText('Not saved')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save issue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'GitHub is temporarily unavailable.',
    );
    expect(screen.getByText('Not saved')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save issue' })).toBeEnabled();
  });

  it('prevents duplicate submissions while a request is pending', async () => {
    const pendingSave = deferred<Awaited<ReturnType<BackgroundClient['saveIssue']>>>();
    const saveIssue = vi
      .fn<BackgroundClient['saveIssue']>()
      .mockReturnValue(pendingSave.promise);
    const client = createClient({ saveIssue });
    renderPopup(supported(issueTarget), client);

    const saveButton = await screen.findByRole('button', { name: 'Save issue' });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(saveIssue).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();

    await act(async () => {
      pendingSave.resolve({ issue, created: true, syncError: null });
      await pendingSave.promise;
    });

    expect(await screen.findByText('The issue was saved.')).toBeVisible();
    expect(saveIssue).toHaveBeenCalledTimes(1);
  });

  it('shows a warning when a reference is saved but metadata sync fails', async () => {
    const saveIssue = vi.fn<BackgroundClient['saveIssue']>().mockResolvedValue({
      issue: unsyncedIssue,
      created: true,
      syncError: commandError('GitHub metadata sync failed.'),
    });
    const client = createClient({ saveIssue });
    renderPopup(supported(issueTarget), client);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Save issue' }),
    );

    expect(
      await screen.findByText(
        'The issue was saved, but GitHub metadata could not be fetched.',
      ),
    ).toBeVisible();
    expect(screen.getByText('Metadata unavailable')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry metadata' })).toBeVisible();
    expect(screen.getByText('Saved')).toBeVisible();
  });

  it('loads once under React Strict Mode', async () => {
    const getSnapshot = vi
      .fn<BackgroundClient['getSnapshot']>()
      .mockResolvedValue(emptySnapshot);
    const client = createClient({ getSnapshot });
    const detectTarget = vi
      .fn<() => Promise<ActiveTargetResult>>()
      .mockResolvedValue(supported(issueTarget));

    render(
      <StrictMode>
        <PopupApp client={client} detectTarget={detectTarget} />
      </StrictMode>,
    );

    expect(
      await screen.findByRole('heading', {
        name: 'Microsoft/TypeScript#12345',
      }),
    ).toBeVisible();
    expect(getSnapshot).toHaveBeenCalledTimes(1);
  });
});
