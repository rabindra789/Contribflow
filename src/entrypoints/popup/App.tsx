import { AppShell } from '@/components/AppShell';

export default function App() {
  return (
    <AppShell
      width="popup"
      title="ContribFlow"
      subtitle="Issues and pull requests you are working on"
    >
      <p className="text-sm text-muted">
        Nothing to show yet. Open a GitHub issue or pull request to save it here.
      </p>
    </AppShell>
  );
}
