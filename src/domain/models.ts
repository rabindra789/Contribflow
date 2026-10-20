export type IsoTimestamp = string;

export type IssueState = 'open' | 'closed' | 'unknown';
export type PullRequestState = 'open' | 'draft' | 'closed' | 'merged' | 'unknown';
export type TargetKind = 'issue' | 'pull_request';

export const SCHEMA_VERSION = 1;
export const MAX_TARGET_NUMBER = 2_147_483_647;
export const MAX_TITLE_LENGTH = 512;
export const MAX_SYNC_ERROR_LENGTH = 300;
export const MAX_NOTE_BODY_LENGTH = 10_000;

export interface SavedIssue {
  id: string;
  owner: string;
  repo: string;
  number: number;
  url: string;
  title: string | null;
  state: IssueState;
  savedAt: IsoTimestamp;
  lastSyncedAt: IsoTimestamp | null;
  lastSyncError: string | null;
}

export interface TrackedPullRequest {
  id: string;
  owner: string;
  repo: string;
  number: number;
  url: string;
  title: string | null;
  state: PullRequestState;
  addedAt: IsoTimestamp;
  lastSyncedAt: IsoTimestamp | null;
  lastSyncError: string | null;
}

export interface IssueNote {
  issueId: string;
  body: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface StorageMeta {
  schemaVersion: 1;
}

export interface GitHubTarget {
  kind: TargetKind;
  owner: string;
  repo: string;
  number: number;
  url: string;
  id: string;
}

const OWNER_SYNTAX = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_SYNTAX = /^[A-Za-z0-9._-]{1,100}$/;
const TARGET_ID_SYNTAX = /^([^/#]+)\/([^#]+)#([1-9][0-9]*)$/;

export function canonicalTargetId(owner: string, repo: string, number: number): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}#${number}`;
}

export function canonicalIssueUrl(owner: string, repo: string, number: number): string {
  return `https://github.com/${owner}/${repo}/issues/${number}`;
}

export function canonicalPullRequestUrl(owner: string, repo: string, number: number): string {
  return `https://github.com/${owner}/${repo}/pull/${number}`;
}

export function isValidOwnerSyntax(value: unknown): value is string {
  return typeof value === 'string' && OWNER_SYNTAX.test(value);
}

export function isValidRepoSyntax(value: unknown): value is string {
  return typeof value === 'string' && REPO_SYNTAX.test(value) && value !== '.' && value !== '..';
}

export function isValidTargetNumber(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_TARGET_NUMBER
  );
}

export function isCanonicalTargetId(value: unknown): value is string {
  if (typeof value !== 'string' || value !== value.toLowerCase()) {
    return false;
  }

  const match = TARGET_ID_SYNTAX.exec(value);
  if (match === null) {
    return false;
  }

  const owner = match[1];
  const repo = match[2];
  const numberText = match[3];
  if (owner === undefined || repo === undefined || numberText === undefined) {
    return false;
  }

  if (!isValidOwnerSyntax(owner) || !isValidRepoSyntax(repo)) {
    return false;
  }

  const number = Number(numberText);
  return isValidTargetNumber(number) && numberText === String(number);
}
