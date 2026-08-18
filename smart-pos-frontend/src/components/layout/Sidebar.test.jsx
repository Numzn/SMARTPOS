import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LayoutDashboard, CreditCard } from 'lucide-react';
import Sidebar from './Sidebar';

function mockMatchMedia(matches) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

const dashboardItem = { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard };
const sections = [
  { id: 'operations', label: 'OPERATIONS', items: [{ name: 'Cashier', href: '/cashier', icon: CreditCard }] },
];

function renderSidebar(props = {}) {
  return render(
    <Sidebar
      dashboardItem={dashboardItem}
      sections={sections}
      activePath="/dashboard"
      onNavigate={vi.fn()}
      onClose={vi.fn()}
      zraStatus="connected"
      user={{ name: 'Michael K.', role: 'ADMIN', email: 'michael@example.com' }}
      onLogout={vi.fn()}
      {...props}
    />
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(true); // desktop by default
  });

  it('starts expanded and shows section labels and item text', () => {
    renderSidebar();
    expect(screen.getByText('OPERATIONS')).toBeInTheDocument();
    expect(screen.getByText('Cashier')).toBeInTheDocument();
  });

  it('toggling the rail-collapse button hides section labels and item text, and persists to localStorage', () => {
    renderSidebar();
    fireEvent.click(screen.getByLabelText('Collapse sidebar'));
    expect(localStorage.getItem('sidebar:collapsed')).toBe('true');
    expect(screen.queryByText('OPERATIONS')).not.toBeInTheDocument();
    expect(screen.queryByText('Cashier')).not.toBeInTheDocument();
  });

  it('restores a persisted collapsed state on mount', () => {
    localStorage.setItem('sidebar:collapsed', 'true');
    renderSidebar();
    expect(screen.queryByText('OPERATIONS')).not.toBeInTheDocument();
  });

  it('never visually collapses on mobile even if a collapsed preference is persisted — a rail is unusable as a tap drawer', () => {
    localStorage.setItem('sidebar:collapsed', 'true');
    mockMatchMedia(false); // below the lg breakpoint
    renderSidebar();
    expect(screen.getByText('OPERATIONS')).toBeInTheDocument();
    expect(screen.getByText('Cashier')).toBeInTheDocument();
  });

  it('a section that only appears once permissions/user finish loading async still starts expanded, not locked collapsed by the initial (empty) render', () => {
    // MainLayout computes `sections` from permissions that resolve async
    // (AuthContext), so Sidebar's very first mount can see an empty/partial
    // `sections` prop before a later re-render supplies the real list. The
    // expanded/collapsed map must not be permanently derived from whatever
    // `sections` happened to look like at that first render.
    const { rerender } = render(
      <Sidebar
        dashboardItem={dashboardItem}
        sections={[]}
        activePath="/dashboard"
        onNavigate={vi.fn()}
        onClose={vi.fn()}
        zraStatus="connected"
        user={{ name: 'Michael K.', role: 'ADMIN', email: 'michael@example.com' }}
        onLogout={vi.fn()}
      />
    );

    rerender(
      <Sidebar
        dashboardItem={dashboardItem}
        sections={sections}
        activePath="/dashboard"
        onNavigate={vi.fn()}
        onClose={vi.fn()}
        zraStatus="connected"
        user={{ name: 'Michael K.', role: 'ADMIN', email: 'michael@example.com' }}
        onLogout={vi.fn()}
      />
    );

    expect(screen.getByText('OPERATIONS')).toBeInTheDocument();
    expect(screen.getByText('Cashier')).toBeInTheDocument();
  });
});
