import { describe, it, expect } from 'vitest';
import { DASHBOARD_ITEM, NAV_SECTIONS } from './navItems';

// Mirrors lib/permissions.js:DEFAULT_PERMISSIONS on the backend, run through
// the same canAccess derivation usePermissions.js does, but inlined here so
// this test doesn't need to render the AuthContext/usePermissions stack —
// each item's show() only ever reads the canAccess shape and (for Dashboard)
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
    recordCashMovement: has('shifts:recordMovement'),
    reconcileShift: has('shifts:reconcile'),
    viewAllShifts: has('shifts:viewAll'),
    viewZRAPage: has('zra:read'),
    manageRoles: has('roles:manage'),
    viewAuditLog: has('audit:read'),
  };
}

// Mirrors the visibleSections/dashboardVisible computation in
// MainLayout.jsx — a section with zero visible items is dropped entirely,
// header included.
function visibleSectionsFor(role, permissions) {
  const canAccess = canAccessFor(permissions);
  const user = { role };
  return NAV_SECTIONS
    .map((s) => ({ ...s, items: s.items.filter((item) => item.show(canAccess, user)) }))
    .filter((s) => s.items.length > 0);
}

function visibleItems(role, permissions) {
  const canAccess = canAccessFor(permissions);
  const user = { role };
  const dashboard = DASHBOARD_ITEM.show(canAccess, user) ? [DASHBOARD_ITEM.name] : [];
  const sectioned = visibleSectionsFor(role, permissions).flatMap((s) => s.items.map((item) => item.name));
  return [...dashboard, ...sectioned];
}

describe('MainLayout navigation — sidebar matches the business role model', () => {
  it('CASHIER: exactly Cashier, Sales, Customers — no Dashboard, no Cash Register (back-office-only page)', () => {
    const names = visibleItems('CASHIER', ['sales:read', 'sales:write', 'receipts:read', 'customers:read', 'customers:write', 'shifts:operate', 'zra:status']);
    expect(names).toEqual(['Cashier', 'Sales', 'Customers']);
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
      'Dashboard', 'Cashier', 'Sales', 'Cash Register', 'Products', 'Inventory', 'Customers',
      'Purchasing', 'Suppliers', 'Reports', 'ZRA Sync',
    ]);
  });

  it("ADMIN: adds Users/Settings/Printers/Roles & Permissions/Audit on top of Manager's set", () => {
    const names = visibleItems('ADMIN', [
      'sales:read', 'sales:write', 'customers:read', 'shifts:operate', 'shifts:viewAll', 'shifts:reconcile',
      'products:read', 'inventory:read', 'suppliers:read', 'purchasing:read', 'reports:read',
      'users:read', 'settings:read', 'settings:write', 'zra:status', 'zra:read', 'roles:manage', 'audit:read',
    ]);
    expect(names).toContain('Users');
    expect(names).toContain('Settings');
    expect(names).toContain('Roles & Permissions');
    expect(names).toContain('Audit Log');
    expect(names).toContain('Dashboard');
  });

  it('a zra:status-only permission set never surfaces the ZRA Sync nav item', () => {
    const names = visibleItems('CASHIER', ['sales:read', 'sales:write', 'shifts:recordMovement', 'zra:status']);
    expect(names).not.toContain('ZRA Sync');
  });

  it('a role with no SUPPLY-domain permissions gets no SUPPLY section at all, header included', () => {
    const sections = visibleSectionsFor('CASHIER', ['sales:read', 'sales:write', 'customers:read', 'shifts:operate', 'zra:status']);
    expect(sections.find((s) => s.id === 'supply')).toBeUndefined();
  });

  it('MANAGER sees a SUPPLY section with both Purchasing and Suppliers once granted those permissions', () => {
    const sections = visibleSectionsFor('MANAGER', ['sales:read', 'shifts:operate', 'suppliers:read', 'purchasing:read']);
    const supply = sections.find((s) => s.id === 'supply');
    expect(supply.items.map((i) => i.name)).toEqual(['Purchasing', 'Suppliers']);
  });
});
