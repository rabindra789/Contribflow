import type { ReactNode } from 'react';

export type AppShellWidth = 'popup' | 'dashboard';

interface AppShellProps {
  width: AppShellWidth;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  logo?: ReactNode;
}

const widthClasses: Record<AppShellWidth, string> = {
  popup: 'w-[380px]',
  dashboard: 'mx-auto w-full max-w-[960px]',
};

export function AppShell({ width, title, subtitle, children, logo }: AppShellProps) {
  return (
    <div className={widthClasses[width]}>
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          {logo}
          <div>
            <h1 className="font-mono text-sm font-semibold tracking-tight text-ink">{title}</h1>
            {subtitle ? <p className="mt-1 text-xs text-muted">{subtitle}</p> : null}
          </div>
        </div>
      </header>
      <main className="px-4 py-4">{children}</main>
    </div>
  );
}
