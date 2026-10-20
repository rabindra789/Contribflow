import {
  MAX_TARGET_NUMBER,
  canonicalIssueUrl,
  canonicalPullRequestUrl,
  canonicalTargetId,
  isValidOwnerSyntax,
  isValidRepoSyntax,
  type GitHubTarget,
  type TargetKind,
} from './models';

export type GitHubUrlRejectionReason =
  | 'invalid-url'
  | 'unsupported-scheme'
  | 'unsupported-host'
  | 'credentials-not-allowed'
  | 'port-not-allowed'
  | 'invalid-path'
  | 'unsupported-target-kind'
  | 'reserved-path'
  | 'invalid-owner'
  | 'invalid-repo'
  | 'invalid-number';

export type ParseGitHubUrlResult =
  | { ok: true; target: GitHubTarget }
  | { ok: false; reason: GitHubUrlRejectionReason; message: string };

const NUMBER_SYNTAX = /^[1-9][0-9]*$/;

function reject(reason: GitHubUrlRejectionReason, message: string): ParseGitHubUrlResult {
  return { ok: false, reason, message };
}

/**
 * Parses a GitHub issue or pull request URL into a canonical target.
 *
 * Callers must pass the final URL of the active tab, after any browser
 * redirect. GitHub redirects `/issues/<number>` to `/pull/<number>` when the
 * number belongs to a pull request, so an `/issues/` URL is always classified
 * as an issue here; the page actually shown decides the kind.
 *
 * The parser never touches the network, the DOM, or Chrome APIs.
 */
export function parseGitHubUrl(input: unknown): ParseGitHubUrlResult {
  if (typeof input !== 'string') {
    return reject('invalid-url', 'URL must be a string');
  }

  const trimmed = input.trim();
  if (trimmed === '') {
    return reject('invalid-url', 'URL must not be empty');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return reject('invalid-url', 'URL is malformed');
  }

  if (url.protocol !== 'https:') {
    return reject('unsupported-scheme', 'Only HTTPS URLs are supported');
  }

  if (url.hostname !== 'github.com') {
    return reject('unsupported-host', 'Only URLs on github.com are supported');
  }

  if (url.username !== '' || url.password !== '') {
    return reject('credentials-not-allowed', 'URLs with credentials are not supported');
  }

  if (url.port !== '') {
    return reject('port-not-allowed', 'URLs with a non-default port are not supported');
  }

  const pathname = url.pathname.replace(/\/+$/, '');
  const segments = pathname.split('/').slice(1);
  if (segments.length < 4 || segments.some((segment) => segment === '')) {
    return reject('invalid-path', 'URL path must contain an owner, repository, kind, and number');
  }

  const owner = segments[0];
  const repo = segments[1];
  const kindSegment = segments[2];
  const numberSegment = segments[3];
  if (
    owner === undefined ||
    repo === undefined ||
    kindSegment === undefined ||
    numberSegment === undefined
  ) {
    return reject('invalid-path', 'URL path is incomplete');
  }

  if (!isValidOwnerSyntax(owner)) {
    return reject('invalid-owner', `Invalid GitHub owner: ${owner}`);
  }

  if (!isValidRepoSyntax(repo)) {
    return reject('invalid-repo', `Invalid GitHub repository: ${repo}`);
  }

  let kind: TargetKind;
  if (kindSegment === 'issues') {
    kind = 'issue';
  } else if (kindSegment === 'pull') {
    kind = 'pull_request';
  } else {
    return reject('unsupported-target-kind', `Unsupported GitHub URL path: ${kindSegment}`);
  }

  if (numberSegment.toLowerCase() === 'new') {
    return reject('reserved-path', 'GitHub creation pages are not supported');
  }

  if (!NUMBER_SYNTAX.test(numberSegment)) {
    return reject('invalid-number', `Invalid GitHub number: ${numberSegment}`);
  }

  const number = Number(numberSegment);
  if (!Number.isSafeInteger(number) || number > MAX_TARGET_NUMBER) {
    return reject('invalid-number', `GitHub number is outside 1..${MAX_TARGET_NUMBER}`);
  }

  const id = canonicalTargetId(owner, repo, number);
  const canonicalUrl =
    kind === 'issue'
      ? canonicalIssueUrl(owner, repo, number)
      : canonicalPullRequestUrl(owner, repo, number);

  return {
    ok: true,
    target: { kind, owner, repo, number, url: canonicalUrl, id },
  };
}
