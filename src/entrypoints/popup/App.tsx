import { browser } from 'wxt/browser';
import { AppShell } from '@/components/AppShell';
import type { SavedIssue, TrackedPullRequest } from '../../domain/models';
import {
  usePopupWorkflow,
  type PopupActionKind,
  type PopupNotice,
} from '../../hooks/usePopupWorkflow';
import type { ActiveTargetResult } from '../../lib/active-target';
import type { ResolvedTarget } from '../../lib/popup-target';
import type { BackgroundClient } from '../../messaging/background-client';
import type { StorageSnapshot } from '../../storage/repository';

const primaryButtonClass =
  'rounded border border-ink bg-ink px-3 py-1.5 text-xs font-medium text-canvas disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonClass =
  'rounded border border-line bg-canvas px-3 py-1.5 text-xs font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50';
const quietButtonClass =
  'rounded px-1 py-1 text-xs font-medium text-ink underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

function savedRecord(
  resolved: ResolvedTarget,
): SavedIssue | TrackedPullRequest | null {
  if (!resolved.saved) {
    return null;
  }
  return resolved.kind === 'issue' ? resolved.issue : resolved.pullRequest;
}

function stateLabel(value: string): string {
  switch (value) {
    case 'open':
      return 'Open';
    case 'closed':
      return 'Closed';
    case 'draft':
      return 'Draft';
    case 'merged':
      return 'Merged';
    default:
      return 'Unknown';
  }
}

function pendingLabel(
  pending: PopupActionKind | null,
  action: PopupActionKind,
  idle: string,
  busy: string,
): string {
  return pending === action ? busy : idle;
}

function Notice({ notice }: { notice: PopupNotice }) {
  const toneClass = notice.tone === 'error' ? 'border-ink font-medium' : 'border-line';
  return (
    <p
      className={`rounded border ${toneClass} bg-surface px-3 py-2 text-xs text-ink`}
      role={notice.tone === 'error' ? 'alert' : 'status'}
    >
      {notice.message}
    </p>
  );
}

function DashboardFooter({
  dashboardUrl,
  snapshot,
}: {
  dashboardUrl: string;
  snapshot: StorageSnapshot | null;
}) {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
      <a
        href={dashboardUrl}
        target="_blank"
        rel="noreferrer"
        className="text-xs font-medium text-ink underline underline-offset-2"
      >
        Open dashboard
      </a>
      {snapshot !== null ? (
        <p
          className="text-xs text-muted"
          aria-label="Saved and tracked items"
        >
          {snapshot.issues.length} saved{' '}
          {snapshot.issues.length === 1 ? 'issue' : 'issues'} ·{' '}
          {snapshot.pullRequests.length} tracked{' '}
          {snapshot.pullRequests.length === 1 ? 'PR' : 'PRs'}
        </p>
      ) : null}
    </footer>
  );
}

function TargetCard({
  target,
  resolved,
  pending,
  onSaveIssue,
  onRemoveIssue,
  onTrackPullRequest,
  onUntrackPullRequest,
  onRetryMetadata,
}: {
  target: {
    kind: 'issue' | 'pull_request';
    owner: string;
    repo: string;
    number: number;
    url: string;
  };
  resolved: ResolvedTarget;
  pending: PopupActionKind | null;
  onSaveIssue: () => void;
  onRemoveIssue: () => void;
  onTrackPullRequest: () => void;
  onUntrackPullRequest: () => void;
  onRetryMetadata: () => void;
}) {
  const record = savedRecord(resolved);
  const typeLabel = target.kind === 'issue' ? 'Issue' : 'Pull request';
  const savedLabel =
    target.kind === 'issue'
      ? resolved.saved
        ? 'Saved'
        : 'Not saved'
      : resolved.saved
        ? 'Tracked'
        : 'Not tracked';
  const title = record?.title ?? `${target.owner}/${target.repo}#${target.number}`;
  const needsRetry =
    record !== null && (record.state === 'unknown' || record.lastSyncError !== null);
  const disabled = pending !== null;

  return (
    <section
      aria-label="Current GitHub target"
      className="rounded border border-line p-3"
      aria-busy={disabled}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-wide text-muted">
            {typeLabel}
          </p>
          <h2 className="mt-1 break-words text-sm font-semibold text-ink">{title}</h2>
          <p className="mt-1 break-words font-mono text-xs text-muted">
            {target.owner}/{target.repo} · #{target.number}
          </p>
        </div>
        <span className="shrink-0 rounded border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-ink">
          {savedLabel}
        </span>
      </div>

      {record !== null ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-xs text-muted">
            State: <span className="font-medium text-ink">{stateLabel(record.state)}</span>
          </p>
          {record.lastSyncError !== null ? (
            <div className="mt-2 border-l-2 border-ink pl-2">
              <p className="text-xs font-medium text-ink">Metadata unavailable</p>
              <p className="mt-0.5 break-words text-xs text-muted">
                {record.lastSyncError}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {target.kind === 'issue' && resolved.saved ? (
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={disabled}
            onClick={onRemoveIssue}
          >
            {pendingLabel(pending, 'remove', 'Remove issue', 'Removing...')}
          </button>
        ) : null}

        {target.kind === 'issue' && !resolved.saved ? (
          <button
            type="button"
            className={primaryButtonClass}
            disabled={disabled}
            onClick={onSaveIssue}
          >
            {pendingLabel(pending, 'save', 'Save issue', 'Saving...')}
          </button>
        ) : null}

        {target.kind === 'pull_request' && resolved.saved ? (
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={disabled}
            onClick={onUntrackPullRequest}
          >
            {pendingLabel(
              pending,
              'untrack',
              'Untrack pull request',
              'Untracking...',
            )}
          </button>
        ) : null}

        {target.kind === 'pull_request' && !resolved.saved ? (
          <button
            type="button"
            className={primaryButtonClass}
            disabled={disabled}
            onClick={onTrackPullRequest}
          >
            {pendingLabel(pending, 'track', 'Track pull request', 'Tracking...')}
          </button>
        ) : null}

        {needsRetry ? (
          <button
            type="button"
            className={quietButtonClass}
            disabled={disabled}
            onClick={onRetryMetadata}
          >
            {pendingLabel(pending, 'refresh', 'Retry metadata', 'Refreshing...')}
          </button>
        ) : null}

        <a
          href={target.url}
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-xs font-medium text-ink underline underline-offset-2"
        >
          View on GitHub
        </a>
      </div>
    </section>
  );
}

export interface PopupAppProps {
  client?: BackgroundClient;
  detectTarget?: () => Promise<ActiveTargetResult>;
  dashboardUrl?: string;
}

export function PopupApp({ client, detectTarget, dashboardUrl }: PopupAppProps) {
  const workflow = usePopupWorkflow({ client, detectTarget });
  const { state, pending, notice } = workflow;
  const resolvedDashboardUrl =
    dashboardUrl ?? browser.runtime.getURL('/dashboard.html');

  return (
    <AppShell
      width="popup"
      title="ContribFlow"
      subtitle="Issues and pull requests you are working on"
    >
      <div className="max-h-[520px] space-y-3 overflow-y-auto">
        {state.status === 'loading' ? (
          <p className="text-sm text-muted" role="status">
            Checking the active tab...
          </p>
        ) : null}

        {state.status === 'missing' || state.status === 'unsupported' ? (
          <section aria-labelledby="empty-state-heading" className="space-y-2">
            <h2 id="empty-state-heading" className="text-sm font-semibold text-ink">
              No supported GitHub page
            </h2>
            <p className="text-sm text-muted">{state.message}</p>
            <p className="text-sm text-muted">
              Open a GitHub issue or pull request in this tab, then reopen ContribFlow.
            </p>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => void workflow.reload()}
            >
              Check again
            </button>
          </section>
        ) : null}

        {state.status === 'error' ? (
          <section aria-labelledby="error-state-heading" className="space-y-2">
            <h2 id="error-state-heading" className="text-sm font-semibold text-ink">
              Saved data unavailable
            </h2>
            <p className="text-sm text-muted" role="alert">
              {state.message}
            </p>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => void workflow.reload()}
            >
              Try again
            </button>
          </section>
        ) : null}

        {state.status === 'ready' ? (
          <>
            <TargetCard
              target={state.target}
              resolved={state.resolved}
              pending={pending}
              onSaveIssue={() => void workflow.saveIssue()}
              onRemoveIssue={() => void workflow.removeIssue()}
              onTrackPullRequest={() => void workflow.trackPullRequest()}
              onUntrackPullRequest={() => void workflow.untrackPullRequest()}
              onRetryMetadata={() => void workflow.retryMetadata()}
            />
            {notice !== null ? <Notice notice={notice} /> : null}
          </>
        ) : null}

        <DashboardFooter
          dashboardUrl={resolvedDashboardUrl}
          snapshot={state.status === 'ready' ? state.snapshot : null}
        />
      </div>
    </AppShell>
  );
}

export default function App() {
  return <PopupApp />;
}
