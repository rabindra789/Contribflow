import { useEffect, useRef, useState } from 'react';
import type { IsoTimestamp } from '../domain/models';
import {
  BackgroundClientError,
  createBackgroundClient,
  type BackgroundClient,
} from '../messaging/background-client';
import type { StorageSnapshot } from '../storage/repository';

export type DashboardNoticeTone = 'success' | 'error';

export interface DashboardNotice {
  tone: DashboardNoticeTone;
  message: string;
}

export type DashboardViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; snapshot: StorageSnapshot };

export type DashboardActionKind =
  | 'remove-issue'
  | 'untrack-pull-request'
  | 'save-note'
  | 'delete-note';

export interface DashboardPendingAction {
  kind: DashboardActionKind;
  id: string;
}

export interface DashboardWorkflow {
  state: DashboardViewState;
  pending: DashboardPendingAction | null;
  refreshingCollection: boolean;
  notice: DashboardNotice | null;
  reload(): void;
  refreshCollection(): Promise<void>;
  removeIssue(issueId: string): Promise<boolean>;
  untrackPullRequest(pullRequestId: string): Promise<boolean>;
  saveNote(
    issueId: string,
    body: string,
    expectedUpdatedAt: IsoTimestamp | null,
  ): Promise<boolean>;
  deleteNote(
    issueId: string,
    expectedUpdatedAt: IsoTimestamp | null,
  ): Promise<boolean>;
}

export interface DashboardWorkflowOptions {
  client?: BackgroundClient;
}

const defaultClient = createBackgroundClient();

function errorMessage(error: unknown): string {
  if (error instanceof BackgroundClientError) {
    return error.message;
  }
  return 'Something went wrong. Try again.';
}

function removeIssueFromSnapshot(
  snapshot: StorageSnapshot,
  issueId: string,
): StorageSnapshot {
  const notes = { ...snapshot.notes };
  delete notes[issueId];
  return {
    ...snapshot,
    issues: snapshot.issues.filter((issue) => issue.id !== issueId),
    notes,
  };
}

function removePullRequestFromSnapshot(
  snapshot: StorageSnapshot,
  pullRequestId: string,
): StorageSnapshot {
  return {
    ...snapshot,
    pullRequests: snapshot.pullRequests.filter(
      (pullRequest) => pullRequest.id !== pullRequestId,
    ),
  };
}

export function useDashboardWorkflow(
  options: DashboardWorkflowOptions = {},
): DashboardWorkflow {
  const client = options.client ?? defaultClient;

  const [state, setState] = useState<DashboardViewState>({ status: 'loading' });
  const [pending, setPending] = useState<DashboardPendingAction | null>(null);
  const [refreshingCollection, setRefreshingCollection] = useState(false);
  const [notice, setNotice] = useState<DashboardNotice | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const mountedRef = useRef(false);
  const busyRef = useRef(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    void (async () => {
      try {
        const snapshot = await client.getSnapshot();
        if (!mountedRef.current || requestId !== requestIdRef.current) {
          return;
        }
        setState({ status: 'ready', snapshot });
      } catch (error) {
        if (!mountedRef.current || requestId !== requestIdRef.current) {
          return;
        }
        setState({ status: 'error', message: errorMessage(error) });
      }
    })();

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [client, reloadToken]);

  function reload(): void {
    if (busyRef.current) {
      return;
    }
    setState({ status: 'loading' });
    setNotice(null);
    setReloadToken((value) => value + 1);
  }

  async function refreshCollection(): Promise<void> {
    if (busyRef.current || state.status !== 'ready') {
      return;
    }

    busyRef.current = true;
    setRefreshingCollection(true);
    setNotice(null);
    try {
      const snapshot = await client.getSnapshot();
      if (!mountedRef.current) {
        return;
      }
      setState({ status: 'ready', snapshot });
      setNotice({ tone: 'success', message: 'The collection was refreshed.' });
    } catch (error) {
      if (mountedRef.current) {
        setNotice({ tone: 'error', message: errorMessage(error) });
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) {
        setRefreshingCollection(false);
      }
    }
  }

  async function runAction(
    pendingAction: DashboardPendingAction,
    task: (
      snapshot: StorageSnapshot,
    ) => Promise<{ snapshot: StorageSnapshot; message: string }>,
  ): Promise<boolean> {
    if (busyRef.current || state.status !== 'ready') {
      return false;
    }

    const snapshot = state.snapshot;
    busyRef.current = true;
    setPending(pendingAction);
    setNotice(null);
    try {
      const outcome = await task(snapshot);
      if (mountedRef.current) {
        setState({ status: 'ready', snapshot: outcome.snapshot });
        setNotice({ tone: 'success', message: outcome.message });
      }
      return true;
    } catch (error) {
      if (mountedRef.current) {
        setNotice({ tone: 'error', message: errorMessage(error) });
      }
      return false;
    } finally {
      busyRef.current = false;
      if (mountedRef.current) {
        setPending(null);
      }
    }
  }

  function removeIssue(issueId: string): Promise<boolean> {
    if (
      state.status !== 'ready' ||
      !state.snapshot.issues.some((issue) => issue.id === issueId)
    ) {
      return Promise.resolve(false);
    }

    return runAction({ kind: 'remove-issue', id: issueId }, async (snapshot) => {
      await client.removeIssue(issueId);
      return {
        snapshot: removeIssueFromSnapshot(snapshot, issueId),
        message: 'The issue and any private note were removed.',
      };
    });
  }

  function untrackPullRequest(pullRequestId: string): Promise<boolean> {
    if (
      state.status !== 'ready' ||
      !state.snapshot.pullRequests.some(
        (pullRequest) => pullRequest.id === pullRequestId,
      )
    ) {
      return Promise.resolve(false);
    }

    return runAction(
      { kind: 'untrack-pull-request', id: pullRequestId },
      async (snapshot) => {
        await client.removePullRequest(pullRequestId);
        return {
          snapshot: removePullRequestFromSnapshot(snapshot, pullRequestId),
          message: 'The pull request was untracked.',
        };
      },
    );
  }

  function saveNote(
    issueId: string,
    body: string,
    expectedUpdatedAt: IsoTimestamp | null,
  ): Promise<boolean> {
    if (
      state.status !== 'ready' ||
      !state.snapshot.issues.some((issue) => issue.id === issueId)
    ) {
      return Promise.resolve(false);
    }
    const isNew = state.snapshot.notes[issueId] === undefined;

    return runAction({ kind: 'save-note', id: issueId }, async (snapshot) => {
      const result = await client.saveNote(
        issueId,
        body,
        expectedUpdatedAt,
      );
      return {
        snapshot: {
          ...snapshot,
          notes: { ...snapshot.notes, [issueId]: result.note },
        },
        message: isNew ? 'The private note was added.' : 'The private note was saved.',
      };
    });
  }

  function deleteNote(
    issueId: string,
    expectedUpdatedAt: IsoTimestamp | null,
  ): Promise<boolean> {
    if (
      state.status !== 'ready' ||
      !state.snapshot.issues.some((issue) => issue.id === issueId)
    ) {
      return Promise.resolve(false);
    }

    return runAction({ kind: 'delete-note', id: issueId }, async (snapshot) => {
      await client.deleteNote(issueId, expectedUpdatedAt);
      const notes = { ...snapshot.notes };
      delete notes[issueId];
      return {
        snapshot: { ...snapshot, notes },
        message: 'The private note was deleted.',
      };
    });
  }

  return {
    state,
    pending,
    refreshingCollection,
    notice,
    reload,
    refreshCollection,
    removeIssue,
    untrackPullRequest,
    saveNote,
    deleteNote,
  };
}
