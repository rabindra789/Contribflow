import type { PullRequestState } from './models';
import type { ValidationResult } from './validation';

/**
 * Derives the stored pull request state from GitHub response fields.
 *
 * The order matches the data model: merged, then closed, then draft, then
 * open. An unknown state is not derived here; it means metadata has never
 * been fetched successfully.
 */
export function derivePullRequestState(
  state: unknown,
  draft: unknown,
  mergedAt: unknown,
): ValidationResult<PullRequestState> {
  if (mergedAt !== null && (typeof mergedAt !== 'string' || mergedAt.length === 0)) {
    return { ok: false, errors: ['mergedAt must be null or a non-empty string'] };
  }

  if (state !== 'open' && state !== 'closed') {
    return { ok: false, errors: ['state must be "open" or "closed"'] };
  }

  if (mergedAt !== null) {
    return { ok: true, value: 'merged' };
  }

  if (state === 'closed') {
    return { ok: true, value: 'closed' };
  }

  if (typeof draft !== 'boolean') {
    return { ok: false, errors: ['draft must be a boolean for an open pull request'] };
  }

  return { ok: true, value: draft ? 'draft' : 'open' };
}
