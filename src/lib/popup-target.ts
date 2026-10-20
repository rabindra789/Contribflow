import type { GitHubTarget, SavedIssue, TrackedPullRequest } from '../domain/models';
import type { StorageSnapshot } from '../storage/repository';

export type ResolvedTarget =
  | { kind: 'issue'; saved: false }
  | { kind: 'issue'; saved: true; issue: SavedIssue }
  | { kind: 'pull_request'; saved: false }
  | { kind: 'pull_request'; saved: true; pullRequest: TrackedPullRequest };

export function resolveTarget(
  target: GitHubTarget,
  snapshot: StorageSnapshot,
): ResolvedTarget {
  if (target.kind === 'issue') {
    const issue = snapshot.issues.find((candidate) => candidate.id === target.id);
    return issue === undefined
      ? { kind: 'issue', saved: false }
      : { kind: 'issue', saved: true, issue };
  }

  const pullRequest = snapshot.pullRequests.find(
    (candidate) => candidate.id === target.id,
  );
  return pullRequest === undefined
    ? { kind: 'pull_request', saved: false }
    : { kind: 'pull_request', saved: true, pullRequest };
}
