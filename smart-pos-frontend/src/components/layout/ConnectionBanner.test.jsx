import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

let offlineSession = false;
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ offlineSession }),
}));

import ConnectionBanner from './ConnectionBanner';
import { reportReachable, reportNetworkFailure, __resetConnectivityForTests } from '../../lib/connectivity';

beforeEach(() => {
  offlineSession = false;
  __resetConnectivityForTests();
});

describe('ConnectionBanner', () => {
  it('renders nothing while the server is reachable or not yet observed', () => {
    const { container } = render(<ConnectionBanner />);
    expect(container).toBeEmptyDOMElement();
    act(() => reportReachable());
    expect(container).toBeEmptyDOMElement();
  });

  it('when offline: says so honestly (cannot complete sales, cart kept) and offers a retry', () => {
    render(<ConnectionBanner />);
    act(() => {
      reportNetworkFailure();
      reportNetworkFailure();
    });
    const banner = screen.getByTestId('connection-banner');
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner.textContent).toMatch(/Can.t reach the server/);
    expect(banner.textContent).toMatch(/Sales can.t be completed/);
    expect(banner.textContent).toMatch(/cart is kept/);
    expect(screen.getByRole('button', { name: /check the connection now/i })).toBeInTheDocument();
  });

  it('when unstable: a softer notice, no claim that selling is blocked', () => {
    render(<ConnectionBanner />);
    act(() => reportNetworkFailure());
    const banner = screen.getByTestId('connection-banner');
    expect(banner.textContent).toMatch(/unstable/i);
    expect(banner.textContent).not.toMatch(/can.t be completed/);
  });

  it('shows the saved-sign-in notice for an offline session even if the connection looks fine', () => {
    offlineSession = true;
    render(<ConnectionBanner />);
    expect(screen.getByTestId('connection-banner').textContent).toMatch(/saved sign-in/i);
  });

  it('disappears by itself when the connection returns', () => {
    render(<ConnectionBanner />);
    act(() => {
      reportNetworkFailure();
      reportNetworkFailure();
    });
    expect(screen.queryByTestId('connection-banner')).toBeInTheDocument();
    act(() => reportReachable());
    expect(screen.queryByTestId('connection-banner')).not.toBeInTheDocument();
  });

  it('the retry button is clickable without a running monitor (no crash)', () => {
    render(<ConnectionBanner />);
    act(() => {
      reportNetworkFailure();
      reportNetworkFailure();
    });
    expect(() => fireEvent.click(screen.getByRole('button', { name: /check the connection now/i }))).not.toThrow();
  });
});
