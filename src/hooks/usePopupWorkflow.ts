import { useEffect, useRef, useState } from 'react';
import type { GitHubTarget, SavedIssue, TrackedPullRequest } from '../domain/models';
import { detectActiveTarget, type ActiveTargetResult } from '../lib/active-target';
import { resolveTarget, type ResolvedTarget } from '../lib/popup-target';
import {
  BackgroundClientError,
  createBackgroundClient,
  type BackgroundClient,
} from '../messaging/background-client';
import type { StorageSnapshot } from '../storage/repository';

export type PopupActionKind = 'save' | 'track' | 'remove' | 'untrack' | 'refresh';
export type PopupNoticeTone = 'success' | 'warning' | 'error';

export interface PopupNotice {
  tone: PopupNoticeTone;
  message: string;
}

export type PopupViewState =
  | { status: 'loading' }
  | { status: 'missing'; message: string }
  | { status: 'unsupported'; message: string }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      target: GitHubTarget;
      snapshot: StorageSnapshot;
      resolved: ResolvedTarget;
    };

export interface PopupWorkflow {
  state: PopupViewState;
  pending: PopupActionKind | null;
  notice: PopupNotice | null;
  reload(): void;
  saveIssue(): Promise<void>;
  trackPullRequest(): Promise<void>;
  removeIssue(): Promise<void>;
  untrackPullRequest(): Promise<void>;
  retryMetadata(): Promise<void>;
}

export interface PopupWorkflowOptions {
  client?: BackgroundClient;
  detectTarget?: () => Promise<ActiveTargetResult>;
}

const defaultClient = createBackgroundClient();

function readyState(target: GitHubTarget, snapshot: StorageSnapshot): PopupViewState {
  return {
    status: 'ready',
    target,
    snapshot,
    resolved: resolveTarget(target, snapshot),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof BackgroundClientError) {
    return error.message;
  }
  return 'Something went wrong. Try again.';
}

function upsertIssue(snapshot: StorageSnapshot, issue: SavedIssue): StorageSnapshot {
  const exists = snapshot.issues.some((candidate) => candidate.id === issue.id);
  const issues = exists
    ? snapshot.issues.map((candidate) => (candidate.id === issue.id ? issue : candidate))
    : [...snapshot.issues, issue];
  return { ...snapshot, issues };
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

function upsertPullRequest(
  snapshot: StorageSnapshot,
  pullRequest: TrackedPullRequest,
): StorageSnapshot {
  const exists = snapshot.pullRequests.some(
    (candidate) => candidate.id === pullRequest.id,
  );
  const pullRequests = exists
    ? snapshot.pullRequests.map((candidate) =>
        candidate.id === pullRequest.id ? pullRequest : candidate,
      )
    : [...snapshot.pullRequests, pullRequest];
  return { ...snapshot, pullRequests };
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

function saveNotice(
  result: { created: boolean; syncError: { message: string } | null },
  subject: 'issue' | 'pull request',
): PopupNotice {
  const verb = subject === 'issue' ? 'saved' : 'tracked';
  if (!result.created) {
    return { tone: 'success', message: `This ${subject} is already ${verb}.` };
  }
  if (result.syncError !== null) {
    return {
      tone: 'warning',
      message: `The ${subject} was ${verb}, but GitHub metadata could not be fetched.`,
    };
  }
  return { tone: 'success', message: `The ${subject} was ${verb}.` };
}

export function usePopupWorkflow(options: PopupWorkflowOptions = {}): PopupWorkflow {
  const client = options.client ?? defaultClient;
  const detectTarget = options.detectTarget ?? detectActiveTarget;

  const [state, setState] = useState<PopupViewState>({ status: 'loading' });
  const [pending, setPending] = useState<PopupActionKind | null>(null);
  const [notice, setNotice] = useState<PopupNotice | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const mountedRef = useRef(false);
  const busyRef = useRef(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    void (async () => {
      let detection: ActiveTargetResult;
      try {
        detection = await detectTarget();
      } catch {
        if (!mountedRef.current || requestId !== requestIdRef.current) {
          return;
        }
        setState({
          status: 'error',
          message: 'Could not inspect the active tab. Try again.',
        });
        return;
      }

      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return;
      }
      if (detection.status !== 'supported') {
        setState({ status: detection.status, message: detection.message });
        return;
      }

      try {
        const snapshot = await client.getSnapshot();
        if (!mountedRef.current || requestId !== requestIdRef.current) {
          return;
        }
        setState(readyState(detection.target, snapshot));
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
  }, [client, detectTarget, reloadToken]);

  function reload(): void {
    setState({ status: 'loading' });
    setNotice(null);
    setReloadToken((value) => value + 1);
  }

  async function runAction(kind: PopupActionKind, task: () => Promise<void>): Promise<void> {
    if (busyRef.current || state.status !== 'ready') {
      return;
    }

    busyRef.current = true;
    setPending(kind);
    setNotice(null);
    try {
      await task();
    } catch (error) {
      if (mountedRef.current) {
        setNotice({ tone: 'error', message: errorMessage(error) });
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) {
        setPending(null);
      }
    }
  }

  function saveIssue(): Promise<void> {
    if (
      state.status !== 'ready' ||
      state.resolved.kind !== 'issue' ||
      state.resolved.saved
    ) {
      return Promise.resolve();
    }
    const { target, snapshot } = state;

    return runAction('save', async () => {
      const result = await client.saveIssue(target.url);
      if (!mountedRef.current) {
        return;
      }
      const updated = upsertIssue(snapshot, result.issue);
      setState(readyState(target, updated));
      setNotice(saveNotice(result, 'issue'));
    });
  }

  function removeIssue(): Promise<void> {
    if (
      state.status !== 'ready' ||
      state.resolved.kind !== 'issue' ||
      !state.resolved.saved
    ) {
      return Promise.resolve();
    }
    const { target, snapshot } = state;

    return runAction('remove', async () => {
      await client.removeIssue(target.id);
      if (!mountedRef.current) {
        return;
      }
      const updated = removeIssueFromSnapshot(snapshot, target.id);
      setState(readyState(target, updated));
      setNotice({ tone: 'success', message: 'The issue was removed.' });
    });
  }

  function trackPullRequest(): Promise<void> {
    if (
      state.status !== 'ready' ||
      state.resolved.kind !== 'pull_request' ||
      state.resolved.saved
    ) {
      return Promise.resolve();
    }
    const { target, snapshot } = state;

    return runAction('track', async () => {
      const result = await client.trackPullRequest(target.url);
      if (!mountedRef.current) {
        return;
      }
      const updated = upsertPullRequest(snapshot, result.pullRequest);
      setState(readyState(target, updated));
      setNotice(saveNotice(result, 'pull request'));
    });
  }

  function untrackPullRequest(): Promise<void> {
    if (
      state.status !== 'ready' ||
      state.resolved.kind !== 'pull_request' ||
      !state.resolved.saved
    ) {
      return Promise.resolve();
    }
    const { target, snapshot } = state;

    return runAction('untrack', async () => {
      await client.removePullRequest(target.id);
      if (!mountedRef.current) {
        return;
      }
      const updated = removePullRequestFromSnapshot(snapshot, target.id);
      setState(readyState(target, updated));
      setNotice({ tone: 'success', message: 'The pull request was untracked.' });
    });
  }

  function retryMetadata(): Promise<void> {
    if (state.status !== 'ready' || !state.resolved.saved) {
      return Promise.resolve();
    }
    const { target, snapshot } = state;
    if (state.resolved.kind === 'issue') {
      return runAction('refresh', async () => {
        const result = await client.refreshIssue(target.url);
        if (!mountedRef.current) {
          return;
        }
        const updated = upsertIssue(snapshot, result.issue);
        setState(readyState(target, updated));
        setNotice({ tone: 'success', message: 'GitHub metadata was refreshed.' });
      });
    }

    return runAction('refresh', async () => {
      const result = await client.refreshPullRequest(target.url);
      if (!mountedRef.current) {
        return;
      }
      const updated = upsertPullRequest(snapshot, result.pullRequest);
      setState(readyState(target, updated));
      setNotice({ tone: 'success', message: 'GitHub metadata was refreshed.' });
    });
  }

  return {
    state,
    pending,
    notice,
    reload,
    saveIssue,
    trackPullRequest,
    removeIssue,
    untrackPullRequest,
    retryMetadata,
  };
}
