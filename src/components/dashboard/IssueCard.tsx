import { useId, useState } from 'react';
import type { SavedIssue } from '../../domain/models';
import { primaryButtonClass, quietButtonClass, secondaryButtonClass } from './button-classes';
import { StateBadge, SyncDetails } from './RecordBadges';

interface IssueCardProps {
  issue: SavedIssue;
  actionsDisabled: boolean;
  pending: boolean;
  onRemove(): Promise<boolean>;
}

export function IssueCard({
  issue,
  actionsDisabled,
  pending,
  onRemove,
}: IssueCardProps) {
  const headingId = useId();
  const [confirming, setConfirming] = useState(false);
  const reference = `${issue.owner}/${issue.repo}#${issue.number}`;

  async function confirmRemove(): Promise<void> {
    if (await onRemove()) {
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
            {issue.title ?? 'Title unavailable'}
          </h3>
        </div>
        <StateBadge state={issue.state} />
      </div>

      <SyncDetails
        lastSyncedAt={issue.lastSyncedAt}
        lastSyncError={issue.lastSyncError}
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <a
          href={issue.url}
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
              Remove this issue and its note?
            </span>
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={actionsDisabled}
              aria-label={`Cancel removing ${reference}`}
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
                pending ? 'Removing issue...' : `Confirm removing ${reference}`
              }
              onClick={() => {
                void confirmRemove();
              }}
            >
              {pending ? 'Removing...' : 'Remove permanently'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={quietButtonClass}
            disabled={actionsDisabled}
            aria-label={`Remove ${reference} and its note`}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Remove issue
          </button>
        )}
      </div>
    </article>
  );
}
