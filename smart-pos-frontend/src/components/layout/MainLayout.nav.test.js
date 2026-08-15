import { describe, it, expect } from 'vitest';
import { NAV_ITEMS } from './navItems';

// Mirrors lib/permissions.js:DEFAULT_PERMISSIONS on the backend, run through
// the same canAccess derivation usePermissions.js does, but inlined here so
// this test doesn't need to render the AuthContext/usePermissions stack —
// NAV_ITEMS.show() only ever reads the canAccess shape and (for Dashboard)
// the role string.
function canAccessFor(permissions) {
  const has = (p) => permissions.includes(p);
  return {
    createSale: has('sales:write'),
    viewSales: has('sales:read'),
    refundSale: has('sales:refund'),
    viewProducts: has('products:read'),
    viewInventory: has('inventory:read'),
    viewCustomers: has('customers:read'),
    viewSuppliers: has('suppliers:read'),
    viewPurchasing: has('purchasing:read'),
    viewReports: has('reports:read'),
    viewUsers: has('users:read'),
    viewSettings: has('settings:read'),
    manageSettings: has('settings:write'),
    operateShift: has('shifts:operate'),
    reconcileShift: has('shifts:reconcile'),
    viewAllShifts: has('shifts:viewAll'),
    viewZRAPage: has('zra:read'),
    manageRoles: has('roles:manage'),
    viewAuditLog: has('audit:read'),
  };
}

function visibleItems(role, permissions) {
  const canAccess = canAccessFor(permissions);
  const user = { role };
  return NAV_ITEMS.filter((item) => item.show(canAccess, user)).map((item) => item.name);
}

describe('MainLayout NAV_ITEMS — sidebar matches the business role model', () => {
  it('CASHIER: exactly Cashier, Sales, Cash Register, Customers — no Dashboard', () => {
    const names = visibleItems('CASHIER', ['sales:read', 'sales:write', 'receipts:read', 'customers:read', 'customers:write', 'shifts:operate', 'zra:status']);
    expect(names).toEqual(['Cashier', 'Sales', 'Cash Register', 'Customers']);
  });

  it('SUPERVISOR: same four items plus Dashboard — reconciliation lives inside Cash Register, not a new nav item', () => {
    const names = visibleItems('SUPERVISOR', [
      'sales:read', 'sales:write', 'customers:read', 'customers:write',
      'shifts:operate', 'shifts:viewExpected', 'shifts:countCash', 'shifts:viewVariance', 'shifts:reconcile',
      'zra:status',
    ]);
    expect(names).toEqual(['Dashboard', 'Cashier', 'Sales', 'Cash Register', 'Customers']);
  });

  it('MANAGER: adds Products/Inventory/Suppliers/Purchasing/Reports', () => {
    const names = visibleItems('MANAGER', [
      'sales:read', 'sales:write', 'customers:read', 'shifts:operate', 'shifts:viewAll', 'shifts:reconcile',
      'products:read', 'inventory:read', 'suppliers:read', 'purchasing:read', 'reports:read', 'zra:status', 'zra:read',
    ]);
    expect(names).toEqual([
      'Dashboard', 'Cashier', 'Sales', 'Cash Register', 'Customers',
      'Products', 'Inventory', 'Suppliers', 'Purchasing', 'Reports', 'ZRA Sync',
    ]);
  });

  it('ADMIN: adds Users/Settings/Printers/Roles/Audit on top of Manager\'s set', () => {
    const names = visibleItems('ADMIN', [
      'sales:read', 'sales:write', 'customers:read', 'shifts:operate', 'shifts:viewAll', 'shifts:reconcile',
      'products:read', 'inventory:read', 'suppliers:read', 'purchasing:read', 'reports:read',
      'users:read', 'settings:read', 'settings:write', 'zra:status', 'zra:read', 'roles:manage', 'audit:read',
    ]);
    expect(names).toContain('Users');
    expect(names).toContain('Settings');
    expect(names).toContain('Roles');
    expect(names).toContain('Audit Log');
    expect(names).toContain('Dashboard');
  });

  it('a zra:status-only permission set never surfaces the ZRA Sync nav item', () => {
    const names = visibleItems('CASHIER', ['sales:read', 'sales:write', 'shifts:operate', 'zra:status']);
    expect(names).not.toContain('ZRA Sync');
  });
});
