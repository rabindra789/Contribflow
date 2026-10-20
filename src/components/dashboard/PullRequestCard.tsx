import { useId, useState } from 'react';
import type { TrackedPullRequest } from '../../domain/models';
import { primaryButtonClass, quietButtonClass, secondaryButtonClass } from './button-classes';
import { StateBadge, SyncDetails } from './RecordBadges';

interface PullRequestCardProps {
  pullRequest: TrackedPullRequest;
  actionsDisabled: boolean;
  pending: boolean;
  onUntrack(): Promise<boolean>;
}

export function PullRequestCard({
  pullRequest,
  actionsDisabled,
  pending,
  onUntrack,
}: PullRequestCardProps) {
  const headingId = useId();
  const [confirming, setConfirming] = useState(false);
  const reference = `${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}`;

  async function confirmUntrack(): Promise<void> {
    if (await onUntrack()) {
      setConfirming(false);
    }
  }

  return (
    <article
      aria-labelledby={headingId}
      className="rounded border border-line bg-canvas p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-mono text-xs text-muted">{reference}</p>
          <h3
            id={headingId}
            className="mt-1 break-words text-sm font-semibold text-ink"
          >
            {pullRequest.title ?? 'Title unavailable'}
          </h3>
        </div>
        <StateBadge state={pullRequest.state} />
      </div>

      <SyncDetails
        lastSyncedAt={pullRequest.lastSyncedAt}
        lastSyncError={pullRequest.lastSyncError}
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <a
          href={pullRequest.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-ink underline underline-offset-2"
          aria-label={`Open ${reference} on GitHub`}
        >
          View on GitHub
        </a>

        {confirming ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs text-muted">
              Untrack this pull request?
            </span>
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={actionsDisabled}
              aria-label={`Cancel untracking ${reference}`}
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              disabled={actionsDisabled}
              aria-label={
                pending ? 'Untracking pull request...' : `Confirm untracking ${reference}`
              }
              onClick={() => {
                void confirmUntrack();
              }}
            >
              {pending ? 'Untracking...' : 'Untrack'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={quietButtonClass}
            disabled={actionsDisabled}
            aria-label={`Untrack ${reference}`}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Untrack
          </button>
        )}
      </div>
    </article>
  );
}
