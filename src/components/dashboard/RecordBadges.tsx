import type {
  IsoTimestamp,
  IssueState,
  PullRequestState,
} from '../../domain/models';
import { formatDashboardTimestamp, stateLabel } from '../../lib/dashboard-view';

export function StateBadge({
  state,
}: {
  state: IssueState | PullRequestState;
}) {
  const label = stateLabel(state);
  return (
    <span className="shrink-0 rounded border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-ink">
      Last known: {label}
    </span>
  );
}

export function SyncDetails({
  lastSyncedAt,
  lastSyncError,
}: {
  lastSyncedAt: IsoTimestamp | null;
  lastSyncError: string | null;
}) {
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-xs text-muted">
        Last synced:{' '}
        {lastSyncedAt === null ? (
          'Never'
        ) : (
          <time dateTime={lastSyncedAt}>
            {formatDashboardTimestamp(lastSyncedAt)}
          </time>
        )}
      </p>
      {lastSyncError !== null ? (
        <div className="mt-2 border-l-2 border-ink pl-2">
          <p className="text-xs font-medium text-ink">Last sync failed</p>
          <p className="mt-0.5 break-words text-xs text-muted">{lastSyncError}</p>
        </div>
      ) : null}
    </div>
  );
}
