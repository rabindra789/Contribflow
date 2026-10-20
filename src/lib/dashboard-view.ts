import type {
  IssueState,
  PullRequestState,
  SavedIssue,
  TrackedPullRequest,
} from '../domain/models';
import type { StorageSnapshot } from '../storage/repository';

export type CollectionTypeFilter = 'all' | 'issue' | 'pull_request';
export type CollectionStateFilter = 'all' | IssueState | PullRequestState;

export interface DashboardFilters {
  query: string;
  type: CollectionTypeFilter;
  state: CollectionStateFilter;
}

export const DEFAULT_DASHBOARD_FILTERS: DashboardFilters = {
  query: '',
  type: 'all',
  state: 'all',
};

export interface DashboardCounts {
  issues: number;
  pullRequests: number;
  notes: number;
}

export interface StateFilterOption {
  value: CollectionStateFilter;
  label: string;
}

const BASE_STATE_OPTIONS: StateFilterOption[] = [
  { value: 'all', label: 'All states' },
  { value: 'open', label: 'Open' },
  { value: 'draft', label: 'Draft' },
  { value: 'closed', label: 'Closed' },
  { value: 'merged', label: 'Merged' },
  { value: 'unknown', label: 'Unknown' },
];

const ISSUE_STATE_OPTIONS = BASE_STATE_OPTIONS.filter(
  (option) => option.value !== 'draft' && option.value !== 'merged',
);

export function stateLabel(value: IssueState | PullRequestState): string {
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

export function formatDashboardTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return 'Unknown time';
  }
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function stateFilterOptions(
  type: CollectionTypeFilter,
): StateFilterOption[] {
  if (type === 'issue') {
    return ISSUE_STATE_OPTIONS;
  }
  return BASE_STATE_OPTIONS;
}

export function dashboardCounts(snapshot: StorageSnapshot): DashboardCounts {
  return {
    issues: snapshot.issues.length,
    pullRequests: snapshot.pullRequests.length,
    notes: Object.keys(snapshot.notes).length,
  };
}

export function hasActiveFilters(filters: DashboardFilters): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.type !== 'all' ||
    filters.state !== 'all'
  );
}

function queryTerms(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
}

function matchesQuery(
  record: SavedIssue | TrackedPullRequest,
  terms: string[],
): boolean {
  if (terms.length === 0) {
    return true;
  }
  const reference = `${record.owner}/${record.repo}#${record.number}`;
  const haystack = [
    record.owner,
    record.repo,
    reference,
    `#${record.number}`,
    String(record.number),
    record.title ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function byNewest<T extends SavedIssue | TrackedPullRequest>(
  left: T,
  right: T,
  timestamp: (record: T) => string,
): number {
  const difference = Date.parse(timestamp(right)) - Date.parse(timestamp(left));
  return difference === 0 ? left.id.localeCompare(right.id) : difference;
}

export function filterIssues(
  issues: SavedIssue[],
  filters: DashboardFilters,
): SavedIssue[] {
  if (filters.type === 'pull_request') {
    return [];
  }
  const terms = queryTerms(filters.query);
  return issues
    .filter(
      (issue) =>
        (filters.state === 'all' || issue.state === filters.state) &&
        matchesQuery(issue, terms),
    )
    .slice()
    .sort((left, right) => byNewest(left, right, (issue) => issue.savedAt));
}

export function filterPullRequests(
  pullRequests: TrackedPullRequest[],
  filters: DashboardFilters,
): TrackedPullRequest[] {
  if (filters.type === 'issue') {
    return [];
  }
  const terms = queryTerms(filters.query);
  return pullRequests
    .filter(
      (pullRequest) =>
        (filters.state === 'all' || pullRequest.state === filters.state) &&
        matchesQuery(pullRequest, terms),
    )
    .slice()
    .sort((left, right) =>
      byNewest(left, right, (pullRequest) => pullRequest.addedAt),
    );
}
