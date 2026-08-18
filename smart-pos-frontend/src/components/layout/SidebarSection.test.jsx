import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreditCard } from 'lucide-react';
import SidebarSection from './SidebarSection';

const items = [{ name: 'Cashier', href: '/cashier', icon: CreditCard }];

describe('SidebarSection', () => {
  it('renders nothing for an empty items array, defensively, even though the caller is expected to pre-filter', () => {
    const { container } = render(
      <SidebarSection id="ops" label="OPERATIONS" items={[]} activePath="/" collapsed={false} expanded onToggleExpand={vi.fn()} onNavigate={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows items when the accordion is expanded and hides them when collapsed, keeping the header visible either way', () => {
    const { rerender } = render(
      <SidebarSection id="ops" label="OPERATIONS" items={items} activePath="/" collapsed={false} expanded onToggleExpand={vi.fn()} onNavigate={vi.fn()} />
    );
    expect(screen.getByText('Cashier')).toBeInTheDocument();

    rerender(
      <SidebarSection id="ops" label="OPERATIONS" items={items} activePath="/" collapsed={false} expanded={false} onToggleExpand={vi.fn()} onNavigate={vi.fn()} />
    );
    expect(screen.queryByText('Cashier')).not.toBeInTheDocument();
    expect(screen.getByText('OPERATIONS')).toBeInTheDocument();
  });

  it('calls onToggleExpand with the section id when the header is clicked', () => {
    const onToggleExpand = vi.fn();
    render(
      <SidebarSection id="ops" label="OPERATIONS" items={items} activePath="/" collapsed={false} expanded onToggleExpand={onToggleExpand} onNavigate={vi.fn()} />
    );
    fireEvent.click(screen.getByText('OPERATIONS'));
    expect(onToggleExpand).toHaveBeenCalledWith('ops');
  });

  it('rail-collapsed mode always shows every item regardless of the accordion expanded flag, with no section header', () => {
    render(
      <SidebarSection id="ops" label="OPERATIONS" items={items} activePath="/" collapsed expanded={false} onToggleExpand={vi.fn()} onNavigate={vi.fn()} />
    );
    expect(screen.queryByText('OPERATIONS')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Cashier')).toBeInTheDocument();
  });
});
