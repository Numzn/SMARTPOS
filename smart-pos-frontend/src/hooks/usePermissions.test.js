import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

let mockUser = null;
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

// Imported after the mock so usePermissions picks up the mocked useAuth.
const { usePermissions } = await import('./usePermissions');

describe('usePermissions', () => {
  it('grants nothing when logged out', () => {
    mockUser = null;
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasPermission('sales:read')).toBe(false);
  });

  it('CASHIER: has operational baseline, not drawer-financial or management permissions', () => {
    mockUser = { role: 'CASHIER', permissions: ['sales:read', 'sales:write', 'shifts:recordMovement', 'zra:status'] };
    const { result } = renderHook(() => usePermissions());
    const { canAccess } = result.current;

    expect(canAccess.createSale).toBe(true);
    expect(canAccess.recordCashMovement).toBe(true);
    expect(canAccess.viewZRAStatus).toBe(true);

    expect(canAccess.operateShift).toBe(false); // cannot open/end a shift
    expect(canAccess.viewExpectedCash).toBe(false);
    expect(canAccess.reconcileShift).toBe(false);
    expect(canAccess.viewZRAPage).toBe(false);
    expect(canAccess.viewProducts).toBe(false);
  });

  it('ADMIN has NO hard-coded bypass — access is purely user.permissions, exactly like every other role', () => {
    // An "ADMIN" whose permissions array (as the backend would send it after
    // an admin revokes something via /api/settings/roles) does not include
    // roles:manage must be denied it here too — proving there is no
    // `if (role === 'ADMIN') return true` shortcut left in this hook.
    mockUser = { role: 'ADMIN', permissions: ['sales:read'] };
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasPermission('roles:manage')).toBe(false);
    expect(result.current.hasPermission('sales:read')).toBe(true);
  });

  it('SUPERVISOR: full reconciliation baseline without store-wide oversight', () => {
    mockUser = {
      role: 'SUPERVISOR',
      permissions: ['sales:read', 'sales:write', 'shifts:operate', 'shifts:viewExpected', 'shifts:countCash', 'shifts:viewVariance', 'shifts:reconcile', 'zra:status'],
    };
    const { result } = renderHook(() => usePermissions());
    const { canAccess } = result.current;
    expect(canAccess.reconcileShift).toBe(true);
    expect(canAccess.viewAllShifts).toBe(false);
    expect(canAccess.viewReports).toBe(false);
  });
});
