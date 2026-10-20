import {
  hasActiveFilters,
  stateFilterOptions,
  type CollectionStateFilter,
  type CollectionTypeFilter,
  type DashboardFilters as DashboardFiltersValue,
} from '../../lib/dashboard-view';

const controlClass =
  'mt-1 w-full rounded border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink';
const labelClass = 'text-xs font-medium text-ink';

export function DashboardFilters({
  filters,
  onChange,
  onClear,
}: {
  filters: DashboardFiltersValue;
  onChange: (filters: DashboardFiltersValue) => void;
  onClear: () => void;
}) {
  return (
    <form
      role="search"
      aria-label="Filter saved items"
      className="rounded border border-line bg-surface p-3"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <div>
          <label htmlFor="dashboard-search" className={labelClass}>
            Search
          </label>
          <input
            id="dashboard-search"
            type="search"
            className={controlClass}
            placeholder="Repository, number, or title"
            value={filters.query}
            onChange={(event) => {
              onChange({ ...filters, query: event.target.value });
            }}
          />
        </div>

        <div>
          <label htmlFor="dashboard-type" className={labelClass}>
            Type
          </label>
          <select
            id="dashboard-type"
            className={controlClass}
            value={filters.type}
            onChange={(event) => {
              onChange({
                ...filters,
                type: event.target.value as CollectionTypeFilter,
              });
            }}
          >
            <option value="all">Everything</option>
            <option value="issue">Issues</option>
            <option value="pull_request">Pull requests</option>
          </select>
        </div>

        <div>
          <label htmlFor="dashboard-state" className={labelClass}>
            State
          </label>
          <select
            id="dashboard-state"
            className={controlClass}
            value={filters.state}
            onChange={(event) => {
              onChange({
                ...filters,
                state: event.target.value as CollectionStateFilter,
              });
            }}
          >
            {stateFilterOptions(filters.type).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className="rounded border border-line bg-canvas px-3 py-1.5 text-xs font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!hasActiveFilters(filters)}
          onClick={onClear}
        >
          Clear filters
        </button>
      </div>
    </form>
  );
}
