import { useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { DashboardFilters } from '@/components/dashboard/DashboardFilters';
import { IssueCard } from '@/components/dashboard/IssueCard';
import { PullRequestCard } from '@/components/dashboard/PullRequestCard';
import type { StorageSnapshot } from '../../storage/repository';
import type { StorageWarning } from '../../storage/warnings';
import {
  useDashboardWorkflow,
  type DashboardNotice,
} from '../../hooks/useDashboardWorkflow';
import {
  DEFAULT_DASHBOARD_FILTERS,
  dashboardCounts,
  filterIssues,
  filterPullRequests,
  hasActiveFilters,
  stateFilterOptions,
  type DashboardFilters as DashboardFiltersValue,
} from '../../lib/dashboard-view';
import type { BackgroundClient } from '../../messaging/background-client';

const secondaryButtonClass =
  'rounded border border-line bg-canvas px-3 py-1.5 text-xs font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50';

function warningText(warning: StorageWarning): string {
  if (warning.kind === 'orphan-note') {
    return `Note for ${warning.issueId} has no saved issue and was skipped.`;
  }
  return `${warning.storageKey}: ${warning.reason}`;
}

function Notice({ notice }: { notice: DashboardNotice }) {
  return (
    <p
      className={`rounded border bg-surface px-3 py-2 text-xs text-ink ${
        notice.tone === 'error' ? 'border-ink font-medium' : 'border-line'
      }`}
      role={notice.tone === 'error' ? 'alert' : 'status'}
    >
      {notice.message}
    </p>
  );
}

function Summary({ snapshot }: { snapshot: StorageSnapshot }) {
  const counts = dashboardCounts(snapshot);
  const items = [
    { label: 'Saved issues', value: counts.issues },
    { label: 'Tracked pull requests', value: counts.pullRequests },
    { label: 'Private notes', value: counts.notes },
  ];

  return (
    <section
      aria-label="Collection summary"
      className="grid gap-3 sm:grid-cols-3"
    >
      {items.map((item) => (
        <div
          key={item.label}
          role="group"
          aria-label={`${item.label}: ${item.value}`}
          className="rounded border border-line bg-surface px-3 py-2"
        >
          <p className="text-xs text-muted">{item.label}</p>
          <p className="mt-1 font-mono text-lg font-semibold text-ink">
            {item.value}
          </p>
        </div>
      ))}
    </section>
  );
}

function StorageWarnings({ warnings }: { warnings: StorageWarning[] }) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="storage-warnings-heading"
      className="rounded border border-ink bg-surface p-3"
    >
      <h2
        id="storage-warnings-heading"
        className="text-sm font-semibold text-ink"
      >
        Storage warnings
      </h2>
      <p className="mt-1 text-xs text-muted">
        Some stored records were skipped and left untouched.
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">
        {warnings.map((warning, index) => (
          <li key={`${index}-${warning.kind}`} className="break-words">
            {warningText(warning)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DashboardReady({
  snapshot,
  refreshing,
  notice,
  onRefresh,
}: {
  snapshot: StorageSnapshot;
  refreshing: boolean;
  notice: DashboardNotice | null;
  onRefresh: () => void;
}) {
  const [filters, setFilters] = useState<DashboardFiltersValue>(
    DEFAULT_DASHBOARD_FILTERS,
  );
  const filteredIssues = useMemo(
    () => filterIssues(snapshot.issues, filters),
    [snapshot.issues, filters],
  );
  const filteredPullRequests = useMemo(
    () => filterPullRequests(snapshot.pullRequests, filters),
    [snapshot.pullRequests, filters],
  );
  const filtersActive = hasActiveFilters(filters);
  const noMatches =
    filtersActive &&
    filteredIssues.length === 0 &&
    filteredPullRequests.length === 0;
  const showIssues = filters.type !== 'pull_request';
  const showPullRequests = filters.type !== 'issue';

  function updateFilters(next: DashboardFiltersValue): void {
    const stateIsAllowed = stateFilterOptions(next.type).some(
      (option) => option.value === next.state,
    );
    setFilters(stateIsAllowed ? next : { ...next, state: 'all' });
  }

  if (snapshot.issues.length === 0 && snapshot.pullRequests.length === 0) {
    return (
      <div className="space-y-4">
        <Summary snapshot={snapshot} />
        <section className="rounded border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">
            Your workspace is empty
          </h2>
          <p className="mt-1 text-sm text-muted">
            Save an issue or track a pull request from the ContribFlow popup.
          </p>
        </section>
        <StorageWarnings warnings={snapshot.warnings} />
        <div className="flex justify-end">
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={refreshing}
            onClick={onRefresh}
          >
            {refreshing ? 'Refreshing...' : 'Refresh collection'}
          </button>
        </div>
        {notice !== null ? <Notice notice={notice} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-xs text-muted">
          Statuses show the last successful sync. Stored data stays in this
          browser.
        </p>
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={refreshing}
          onClick={onRefresh}
        >
          {refreshing ? 'Refreshing...' : 'Refresh collection'}
        </button>
      </div>

      {notice !== null ? <Notice notice={notice} /> : null}
      <Summary snapshot={snapshot} />
      <StorageWarnings warnings={snapshot.warnings} />

      <DashboardFilters
        filters={filters}
        onChange={updateFilters}
        onClear={() => {
          setFilters(DEFAULT_DASHBOARD_FILTERS);
        }}
      />

      {noMatches ? (
        <section className="rounded border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">
            No items match your filters
          </h2>
          <p className="mt-1 text-sm text-muted">
            Try a different search, type, or state.
          </p>
          <button
            type="button"
            className={`${secondaryButtonClass} mt-3`}
            onClick={() => {
              setFilters(DEFAULT_DASHBOARD_FILTERS);
            }}
          >
            Clear filters
          </button>
        </section>
      ) : (
        <>
          {showIssues ? (
            <section aria-labelledby="issues-heading">
              <div className="flex items-baseline justify-between gap-3">
                <h2
                  id="issues-heading"
                  className="text-sm font-semibold text-ink"
                >
                  Issues
                </h2>
                <span className="font-mono text-xs text-muted">
                  {filtersActive
                    ? `${filteredIssues.length} of ${snapshot.issues.length}`
                    : snapshot.issues.length}
                </span>
              </div>
              {snapshot.issues.length === 0 ? (
                <p className="mt-2 rounded border border-line p-4 text-sm text-muted">
                  No saved issues yet. Save one from the ContribFlow popup.
                </p>
              ) : filteredIssues.length === 0 ? (
                <p className="mt-2 rounded border border-line p-4 text-sm text-muted">
                  No saved issues match these filters.
                </p>
              ) : (
                <div className="mt-2 grid gap-3">
                  {filteredIssues.map((issue) => (
                    <IssueCard key={issue.id} issue={issue} />
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {showPullRequests ? (
            <section aria-labelledby="pull-requests-heading">
              <div className="flex items-baseline justify-between gap-3">
                <h2
                  id="pull-requests-heading"
                  className="text-sm font-semibold text-ink"
                >
                  Pull requests
                </h2>
                <span className="font-mono text-xs text-muted">
                  {filtersActive
                    ? `${filteredPullRequests.length} of ${snapshot.pullRequests.length}`
                    : snapshot.pullRequests.length}
                </span>
              </div>
              {snapshot.pullRequests.length === 0 ? (
                <p className="mt-2 rounded border border-line p-4 text-sm text-muted">
                  No tracked pull requests yet. Track one from the ContribFlow
                  popup.
                </p>
              ) : filteredPullRequests.length === 0 ? (
                <p className="mt-2 rounded border border-line p-4 text-sm text-muted">
                  No tracked pull requests match these filters.
                </p>
              ) : (
                <div className="mt-2 grid gap-3">
                  {filteredPullRequests.map((pullRequest) => (
                    <PullRequestCard
                      key={pullRequest.id}
                      pullRequest={pullRequest}
                    />
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

export interface DashboardAppProps {
  client?: BackgroundClient;
}

export function DashboardApp({ client }: DashboardAppProps) {
  const workflow = useDashboardWorkflow(client ? { client } : {});

  return (
    <AppShell
      width="dashboard"
      title="ContribFlow Dashboard"
      subtitle="Saved issues, private notes, and tracked pull requests"
    >
      {workflow.state.status === 'loading' ? (
        <p className="text-sm text-muted" role="status">
          Loading your workspace...
        </p>
      ) : null}

      {workflow.state.status === 'error' ? (
        <section
          role="alert"
          className="rounded border border-ink bg-surface p-4"
        >
          <h2 className="text-sm font-semibold text-ink">
            Could not load your workspace
          </h2>
          <p className="mt-1 text-sm text-muted">{workflow.state.message}</p>
          <button
            type="button"
            className={`${secondaryButtonClass} mt-3`}
            onClick={workflow.reload}
          >
            Try again
          </button>
        </section>
      ) : null}

      {workflow.state.status === 'ready' ? (
        <DashboardReady
          snapshot={workflow.state.snapshot}
          refreshing={workflow.refreshingCollection}
          notice={workflow.notice}
          onRefresh={() => {
            void workflow.refreshCollection();
          }}
        />
      ) : null}
    </AppShell>
  );
}

export default function App() {
  return <DashboardApp />;
}
