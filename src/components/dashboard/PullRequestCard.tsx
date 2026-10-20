import { useId } from 'react';
import type { TrackedPullRequest } from '../../domain/models';
import { StateBadge, SyncDetails } from './RecordBadges';

export function PullRequestCard({
  pullRequest,
}: {
  pullRequest: TrackedPullRequest;
}) {
  const headingId = useId();
  const reference = `${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}`;

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

      <div className="mt-3 flex justify-end">
        <a
          href={pullRequest.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-ink underline underline-offset-2"
          aria-label={`Open ${reference} on GitHub`}
        >
          View on GitHub
        </a>
      </div>
    </article>
  );
}
