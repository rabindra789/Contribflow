import { AppShell } from '@/components/AppShell';

export default function App() {
  return (
    <AppShell
      width="dashboard"
      title="ContribFlow Dashboard"
      subtitle="Saved issues, private notes, and tracked pull requests"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <section aria-label="Saved issues" className="rounded border border-line p-4">
          <h2 className="text-sm font-semibold text-ink">Issues</h2>
          <p className="mt-2 text-sm text-muted">
            Nothing saved yet. Save an issue from the popup.
          </p>
        </section>
        <section aria-label="Tracked pull requests" className="rounded border border-line p-4">
          <h2 className="text-sm font-semibold text-ink">Pull requests</h2>
          <p className="mt-2 text-sm text-muted">
            Nothing tracked yet. Track a pull request from the popup.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
