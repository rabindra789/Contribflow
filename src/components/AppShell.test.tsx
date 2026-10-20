import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('renders the title, subtitle, and children', () => {
    render(
      <AppShell width="popup" title="ContribFlow" subtitle="Local workspace">
        <p>Nothing saved yet</p>
      </AppShell>,
    );

    expect(screen.getByRole('heading', { name: 'ContribFlow' })).toBeVisible();
    expect(screen.getByText('Local workspace')).toBeVisible();
    expect(screen.getByText('Nothing saved yet')).toBeVisible();
  });
});
