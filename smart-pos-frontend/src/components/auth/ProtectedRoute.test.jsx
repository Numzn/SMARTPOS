import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

let mockAuth = { isAuthenticated: true, loading: false, user: { role: 'CASHIER', permissions: [] } };
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

const ProtectedRoute = (await import('./ProtectedRoute')).default;

function renderAt(path, element) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={element} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  it('redirects to /login when not authenticated', () => {
    mockAuth = { isAuthenticated: false, loading: false, user: null };
    renderAt('/zra-sync', <ProtectedRoute requiredPermission="zra:read"><div>ZRA Sync</div></ProtectedRoute>);
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('denies a zra:status-only user (e.g. a Cashier) access to a zra:read-gated route — the direct fix for zra:status never implying page access', () => {
    mockAuth = { isAuthenticated: true, loading: false, user: { role: 'CASHIER', permissions: ['zra:status'] } };
    renderAt('/zra-sync', <ProtectedRoute requiredPermission="zra:read"><div>ZRA Sync</div></ProtectedRoute>);
    expect(screen.getByText('Access Denied')).toBeInTheDocument();
    expect(screen.queryByText('ZRA Sync')).not.toBeInTheDocument();
  });

  it('allows a manager (zra:read) onto the same route', () => {
    mockAuth = { isAuthenticated: true, loading: false, user: { role: 'MANAGER', permissions: ['zra:read'] } };
    renderAt('/zra-sync', <ProtectedRoute requiredPermission="zra:read"><div>ZRA Sync</div></ProtectedRoute>);
    expect(screen.getByText('ZRA Sync')).toBeInTheDocument();
  });

  it('requiredPermission as an array is any-of', () => {
    mockAuth = { isAuthenticated: true, loading: false, user: { role: 'CASHIER', permissions: ['sales:read'] } };
    renderAt('/sales', <ProtectedRoute requiredPermission={['sales:read', 'sales:refund']}><div>Sales</div></ProtectedRoute>);
    expect(screen.getByText('Sales')).toBeInTheDocument();
  });

  it('requiredRole as an array denies a role not in the list — CASHIER cannot reach /dashboard directly', () => {
    mockAuth = { isAuthenticated: true, loading: false, user: { role: 'CASHIER', permissions: [] } };
    renderAt('/dashboard', <ProtectedRoute requiredRole={['SUPERVISOR', 'MANAGER', 'ADMIN', 'VIEWER']}><div>Dashboard</div></ProtectedRoute>);
    expect(screen.getByText('Access Denied')).toBeInTheDocument();
  });

  it('requiredRole as an array allows a role in the list', () => {
    mockAuth = { isAuthenticated: true, loading: false, user: { role: 'MANAGER', permissions: [] } };
    renderAt('/dashboard', <ProtectedRoute requiredRole={['SUPERVISOR', 'MANAGER', 'ADMIN', 'VIEWER']}><div>Dashboard</div></ProtectedRoute>);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });
});
